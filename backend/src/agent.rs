use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

use a3s_code_core::{
    llm::{LlmClient, StreamEvent, ToolDefinition},
    permissions::{PermissionDecision, PermissionPolicy},
    Agent, AgentEvent, ContentBlock, LlmResponse, Message, PlanningMode, SessionOptions,
    TokenUsage,
};
use anyhow::Result as AnyResult;
use async_trait::async_trait;
use axum::http::StatusCode;
use serde::Serialize;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::error::ApiError;

const AGENT_ACL: &str = r#"
default_model = "openai/offline-fixture"
providers "openai" {
  api_key = "local-only-fixture"
  base_url = "http://127.0.0.1:9/v1"
  models "offline-fixture" { name = "Offline Fixture" }
}
"#;

pub const FIXTURE_RECOMMENDATION: &str = "本地固定响应模型建议：先完成小规模计算与文献复核，不直接指定可执行突变。请核验结合位点与保守性、表达/溶解性风险及测定条件；当前输入和建议均为模拟示例，不构成生物学结论。";

const PROBE_PROMPT: &str = "请针对 AmeR 蛋白质定向进化案例给出下一步路线建议，并说明风险边界。";

#[derive(Serialize)]
pub struct AgentProbe {
    pub runtime: &'static str,
    pub version: &'static str,
    pub command: &'static str,
    pub model_source: &'static str,
    pub events: Vec<String>,
    pub output: String,
    pub fixture_calls: usize,
    pub tool_requests: usize,
    pub tool_executions: usize,
    pub network_used: bool,
}

/// 阶段 E 对话回复结果（本地固定响应模型，不访问外网、不执行工具）。
#[derive(Serialize)]
pub struct ChatReply {
    pub runtime: &'static str,
    pub version: &'static str,
    pub events: Vec<String>,
    pub output: String,
    pub fixture_calls: usize,
    pub tool_requests: usize,
    pub tool_executions: usize,
    pub network_used: bool,
}

/// 本地固定响应模型的两种来源：固定文本（阶段 A 探针）或按提示词生成模板（阶段 E 对话）。
#[derive(Clone)]
struct FixtureLlmClient {
    calls: Arc<AtomicUsize>,
    fixed: Option<&'static str>,
}

impl FixtureLlmClient {
    fn fixed(text: &'static str) -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            fixed: Some(text),
        }
    }

    fn prompt_aware() -> Self {
        Self {
            calls: Arc::new(AtomicUsize::new(0)),
            fixed: None,
        }
    }

    fn response(&self, messages: &[Message]) -> LlmResponse {
        let text = match self.fixed {
            Some(text) => text.to_string(),
            None => fixture_reply(&last_user_text(messages)),
        };
        LlmResponse {
            message: Message {
                role: "assistant".into(),
                content: vec![ContentBlock::Text { text }],
                reasoning_content: None,
                transcript_text: None,
                transcript_visibility: Default::default(),
            },
            usage: TokenUsage::default(),
            stop_reason: Some("end_turn".into()),
            token_logprobs: Vec::new(),
            meta: None,
        }
    }
}

#[async_trait]
impl LlmClient for FixtureLlmClient {
    async fn complete(
        &self,
        messages: &[Message],
        _system: Option<&str>,
        _tools: &[ToolDefinition],
    ) -> AnyResult<LlmResponse> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(self.response(messages))
    }

    async fn complete_streaming(
        &self,
        messages: &[Message],
        _system: Option<&str>,
        _tools: &[ToolDefinition],
        _cancel_token: CancellationToken,
    ) -> AnyResult<mpsc::Receiver<StreamEvent>> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let response = self.response(messages);
        let text = response.text();
        let (sender, receiver) = mpsc::channel(8);
        tokio::spawn(async move {
            if !text.is_empty() {
                let _ = sender.send(StreamEvent::TextDelta(text)).await;
            }
            let _ = sender.send(StreamEvent::Done(response)).await;
        });
        Ok(receiver)
    }
}

/// 提取最后一条用户消息的纯文本。
fn last_user_text(messages: &[Message]) -> String {
    for message in messages.iter().rev() {
        if message.role != "user" {
            continue;
        }
        let mut out = String::new();
        for block in &message.content {
            if let ContentBlock::Text { text } = block {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(text);
            }
        }
        if !out.trim().is_empty() {
            return out;
        }
    }
    String::new()
}

/// 提示词感知的本地模板回复：固定免责声明 + 提问截断回显 + 建议路径。
fn fixture_reply(prompt: &str) -> String {
    let trimmed = prompt.trim();
    let excerpt: String = if trimmed.is_empty() {
        "（未收到有效问题内容）".to_string()
    } else {
        trimmed.chars().take(160).collect()
    };
    format!(
        "【本地模拟回复】当前未接入真实模型，以下内容由本地固定响应模型按模板生成，不构成科研结论。\n\n\
         收到的问题：{excerpt}\n\n\
         建议路径：\n\
         1. 先明确可测量的判据与最小验证实验，避免直接给出结论；\n\
         2. 对照公开文献梳理已知约束与相互冲突的证据；\n\
         3. 记录失败条件与边界，明确哪些部分必须留待真实模型或实验验证。\n\n\
         本轮未使用网络、未执行任何工具；这是一条模拟回复。"
    )
}

/// 一次受限 A3S 会话的原始结果。
struct SessionOutcome {
    events: Vec<String>,
    output: String,
    tool_requests: usize,
    tool_executions: usize,
    ended: bool,
}

/// 运行一次受限 A3S 会话（默认拒绝工具、禁用规划），注入给定的固定响应模型客户端。
async fn run_restricted_session(
    workspace: &Path,
    prompt: &str,
    fixture: &FixtureLlmClient,
) -> Result<SessionOutcome, ApiError> {
    let agent = Agent::new(AGENT_ACL)
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let options = SessionOptions::new()
        .with_permission_policy(default_agent_permissions())
        .with_planning_mode(PlanningMode::Disabled)
        .with_llm_client(Arc::new(fixture.clone()));
    let session = agent
        .session_async(workspace.to_string_lossy().to_string(), Some(options))
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let (mut receiver, worker) = session
        .stream(prompt, None)
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut events = Vec::new();
    let mut output = String::new();
    let mut tool_requests = 0;
    let mut tool_executions = 0;
    let mut ended = false;
    while let Some(event) = receiver.recv().await {
        match event {
            AgentEvent::TextDelta { text } => {
                output.push_str(&text);
                events.push("text_delta".to_string());
            }
            AgentEvent::End { .. } => {
                ended = true;
                events.push("agent_end".to_string());
            }
            AgentEvent::ToolStart { .. } => {
                tool_requests += 1;
                events.push("tool_start".to_string());
            }
            AgentEvent::ToolExecutionStart { .. } => {
                tool_executions += 1;
                events.push("tool_execution_start".to_string());
            }
            AgentEvent::Error { message } => {
                return Err(ApiError::new(StatusCode::BAD_GATEWAY, message));
            }
            _ => events.push("runtime_event".to_string()),
        }
    }
    worker
        .await
        .map_err(|error| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    Ok(SessionOutcome {
        events,
        output,
        tool_requests,
        tool_executions,
        ended,
    })
}

/// 运行一次受控的 A3S 会话，使用本地固定响应模型（不访问外网、不执行工具）。
pub async fn run_a3s_probe(workspace: &PathBuf) -> Result<AgentProbe, ApiError> {
    let fixture = FixtureLlmClient::fixed(FIXTURE_RECOMMENDATION);
    let outcome = run_restricted_session(workspace, PROBE_PROMPT, &fixture).await?;
    let fixture_calls = fixture.calls.load(Ordering::Relaxed);
    if !outcome.ended || outcome.output.trim().is_empty() || fixture_calls == 0 {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "A3S 未完成本地固定响应模型会话",
        ));
    }

    Ok(AgentProbe {
        runtime: "A3S Code Core",
        version: "9.1.1",
        command: "AmeR 路线建议（模拟输入）",
        model_source: "本地固定响应模型 · 非 AI 推理",
        events: outcome.events,
        output: outcome.output,
        fixture_calls,
        tool_requests: outcome.tool_requests,
        tool_executions: outcome.tool_executions,
        network_used: false,
    })
}

/// 运行一次对话回复：本地固定响应模型按提示词生成模板回复（不访问外网、不执行工具）。
pub async fn run_a3s_chat(workspace: &Path, prompt: &str) -> Result<ChatReply, ApiError> {
    let fixture = FixtureLlmClient::prompt_aware();
    let outcome = run_restricted_session(workspace, prompt, &fixture).await?;
    let fixture_calls = fixture.calls.load(Ordering::Relaxed);
    if !outcome.ended || outcome.output.trim().is_empty() || fixture_calls == 0 {
        return Err(ApiError::new(
            StatusCode::BAD_GATEWAY,
            "A3S 未完成本地固定响应模型会话",
        ));
    }

    Ok(ChatReply {
        runtime: "A3S Code Core",
        version: "9.1.1",
        events: outcome.events,
        output: outcome.output,
        fixture_calls,
        tool_requests: outcome.tool_requests,
        tool_executions: outcome.tool_executions,
        network_used: false,
    })
}

/// 默认工具权限：拒绝一切未显式列入白名单的工具。
pub fn default_agent_permissions() -> PermissionPolicy {
    let mut permissions = PermissionPolicy::new();
    permissions.default_decision = PermissionDecision::Deny;
    permissions
}
