use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
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
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, Mutex};
use tokio_util::sync::CancellationToken;

const AGENT_ACL: &str = r#"
default_model = "openai/offline-fixture"
providers "openai" {
  api_key = "local-only-fixture"
  base_url = "http://127.0.0.1:9/v1"
  models "offline-fixture" { name = "Offline Fixture" }
}
"#;

#[derive(Clone, Serialize)]
struct Stage {
    id: &'static str,
    index: usize,
    title: &'static str,
    eyebrow: &'static str,
    summary: &'static str,
    output: &'static str,
    state: &'static str,
}

fn stages() -> Vec<Stage> {
    [
        (
            "question",
            "01",
            "定义科学问题",
            "RESEARCH BRIEF",
            "围绕 AmeR 蛋白质研究目标，明确候选突变的功能假设与评价尺度。",
            "问题定义 · 研究目标 · 约束条件",
            "ready",
        ),
        (
            "evidence",
            "02",
            "深度研究",
            "EVIDENCE REVIEW",
            "整理示意文献、作用机制线索、已有案例与待验证假设。",
            "模拟文献集 · 证据摘要 · 未知项",
            "ready",
        ),
        (
            "route",
            "03",
            "专家选择路线",
            "ROUTE SELECTION",
            "比较候选策略的预期收益、实验成本和证据强度，形成可解释的路线建议。",
            "路线对比 · 选择理由 · 评审记录",
            "ready",
        ),
        (
            "risk",
            "04",
            "风险评审",
            "RISK REVIEW",
            "审视表达、稳定性、测定偏差和资源约束，为下一步计算标记风险与缓解方式。",
            "风险清单 · 影响等级 · 缓解措施",
            "ready",
        ),
        (
            "simulation",
            "05",
            "分子动力学模拟",
            "MD SIMULATION",
            "查看预置的示意稳定性曲线、构象指标和候选排序；此处不执行真实计算。",
            "模拟轨迹 · 稳定性指标 · 候选排序",
            "simulated",
        ),
        (
            "evidence-chain",
            "06",
            "可信科研证据链",
            "PROVENANCE",
            "把问题、模拟工具输入、评审结论和产物连成可追溯的演示记录。",
            "事件记录 · 产物索引 · 来源标签",
            "simulated",
        ),
        (
            "experiment",
            "07",
            "湿实验任务与监测",
            "LAB TASK · MOCK",
            "浏览虚构的实验任务和历史监测画面；没有实验室设备或控制接口连接。",
            "模拟任务卡 · 只读状态 · 回放画面",
            "simulated",
        ),
        (
            "feedback",
            "08",
            "结果回流与迭代",
            "ITERATION",
            "将模拟实验结果回收到下一轮研究记录，呈现假设更新和迭代关系。",
            "模拟结果 · 假设变化 · 下一轮建议",
            "simulated",
        ),
    ]
    .into_iter()
    .enumerate()
    .map(
        |(index, (id, _number, title, eyebrow, summary, output, state))| Stage {
            id,
            index,
            title,
            eyebrow,
            summary,
            output,
            state,
        },
    )
    .collect()
}

#[derive(Clone, Serialize, Deserialize)]
struct AuditEvent {
    id: u64,
    at: u64,
    kind: String,
    title: String,
    detail: String,
    stage: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
struct CaseProgress {
    current_stage: usize,
    completed: Vec<usize>,
    finished: bool,
    next_event_id: u64,
    events: Vec<AuditEvent>,
}

impl Default for CaseProgress {
    fn default() -> Self {
        Self {
            current_stage: 0,
            completed: Vec::new(),
            finished: false,
            next_event_id: 2,
            events: vec![AuditEvent {
                id: 1,
                at: now(),
                kind: "case.created".into(),
                title: "演示案例已载入".into(),
                detail: "AmeR 蛋白质定向进化 · 全部科研数据为模拟内容".into(),
                stage: Some(0),
            }],
        }
    }
}

#[derive(Serialize)]
struct CaseResponse {
    id: &'static str,
    title: &'static str,
    subtitle: &'static str,
    data_label: &'static str,
    current_stage: usize,
    completed: Vec<usize>,
    finished: bool,
    stages: Vec<Stage>,
    events: Vec<AuditEvent>,
}

struct AppState {
    progress: Mutex<CaseProgress>,
    progress_path: PathBuf,
    agent_workspace: PathBuf,
}

impl AppState {
    async fn open(root: PathBuf) -> std::io::Result<Self> {
        let data_dir = root.join("data");
        let agent_workspace = root.join(".runtime").join("agent-workspace");
        tokio::fs::create_dir_all(&data_dir).await?;
        tokio::fs::create_dir_all(&agent_workspace).await?;
        let progress_path = data_dir.join("case-progress.json");
        let progress = match tokio::fs::read(&progress_path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => CaseProgress::default(),
            Err(error) => return Err(error),
        };
        let state = Self {
            progress: Mutex::new(progress),
            progress_path,
            agent_workspace,
        };
        {
            let progress = state.progress.lock().await;
            state.persist(&progress).await?;
        }
        Ok(state)
    }

    async fn persist(&self, progress: &CaseProgress) -> std::io::Result<()> {
        let bytes = serde_json::to_vec_pretty(progress)?;
        tokio::fs::write(&self.progress_path, bytes).await
    }
}

#[derive(Debug)]
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn response(progress: &CaseProgress) -> CaseResponse {
    CaseResponse {
        id: "amer-protein-evolution",
        title: "AmeR 蛋白质定向进化",
        subtitle: "从科学假设到实验反馈的可追溯研究流程",
        data_label: "演示数据 · 非真实研究结论",
        current_stage: progress.current_stage,
        completed: progress.completed.clone(),
        finished: progress.finished,
        stages: stages(),
        events: progress.events.clone(),
    }
}

async fn get_case(State(state): State<Arc<AppState>>) -> Json<CaseResponse> {
    let progress = state.progress.lock().await;
    Json(response(&progress))
}

async fn get_events(State(state): State<Arc<AppState>>) -> Json<Vec<AuditEvent>> {
    Json(state.progress.lock().await.events.clone())
}

async fn advance_case(State(state): State<Arc<AppState>>) -> Result<Json<CaseResponse>, ApiError> {
    let mut progress = state.progress.lock().await;
    if progress.finished {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "案例全部阶段已完成，请重置后重新演示".into(),
        ));
    }

    let current = progress.current_stage;
    if !progress.completed.contains(&current) {
        progress.completed.push(current);
    }
    if current + 1 == stages().len() {
        progress.finished = true;
    } else {
        progress.current_stage += 1;
    }
    push_event(
        &mut progress,
        "stage.completed",
        "阶段已完成",
        &format!("{} · 已保存本地演示进度", stages()[current].title),
        Some(current),
    );
    state.persist(&progress).await.map_err(internal_error)?;
    Ok(Json(response(&progress)))
}

async fn reset_case(State(state): State<Arc<AppState>>) -> Result<Json<CaseResponse>, ApiError> {
    let mut current = state.progress.lock().await;
    let mut progress = CaseProgress::default();
    push_event(
        &mut progress,
        "case.reset",
        "演示已重置",
        "已从问题定义阶段重新开始",
        Some(0),
    );
    state.persist(&progress).await.map_err(internal_error)?;
    let result = response(&progress);
    *current = progress;
    Ok(Json(result))
}

#[derive(Serialize)]
struct AgentProbe {
    runtime: &'static str,
    version: &'static str,
    command: &'static str,
    model_source: &'static str,
    events: Vec<String>,
    output: String,
    fixture_calls: usize,
    tool_requests: usize,
    tool_executions: usize,
    network_used: bool,
}

const FIXTURE_RECOMMENDATION: &str = "本地固定响应模型建议：先完成小规模计算与文献复核，不直接指定可执行突变。请核验结合位点与保守性、表达/溶解性风险及测定条件；当前输入和建议均为模拟示例，不构成生物学结论。";

#[derive(Clone, Default)]
struct FixtureLlmClient {
    calls: Arc<AtomicUsize>,
}

impl FixtureLlmClient {
    fn response(&self) -> LlmResponse {
        let text = FIXTURE_RECOMMENDATION.to_string();
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
        _messages: &[Message],
        _system: Option<&str>,
        _tools: &[ToolDefinition],
    ) -> AnyResult<LlmResponse> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        Ok(self.response())
    }

    async fn complete_streaming(
        &self,
        _messages: &[Message],
        _system: Option<&str>,
        _tools: &[ToolDefinition],
        _cancel_token: CancellationToken,
    ) -> AnyResult<mpsc::Receiver<StreamEvent>> {
        self.calls.fetch_add(1, Ordering::Relaxed);
        let response = self.response();
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

async fn run_a3s_probe(workspace: &PathBuf) -> Result<AgentProbe, ApiError> {
    let agent = Agent::new(AGENT_ACL)
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let fixture = FixtureLlmClient::default();
    let options = SessionOptions::new()
        .with_permission_policy(default_agent_permissions())
        .with_planning_mode(PlanningMode::Disabled)
        .with_llm_client(Arc::new(fixture.clone()));
    let session = agent
        .session_async(workspace.to_string_lossy().to_string(), Some(options))
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let (mut receiver, worker) = session
        .stream(
            "请针对 AmeR 蛋白质定向进化案例给出下一步路线建议，并说明风险边界。",
            None,
        )
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    let mut event_names = Vec::new();
    let mut output = String::new();
    let mut tool_requests = 0;
    let mut tool_executions = 0;
    let mut ended = false;
    while let Some(event) = receiver.recv().await {
        match event {
            AgentEvent::TextDelta { text } => {
                output.push_str(&text);
                event_names.push("text_delta".to_string());
            }
            AgentEvent::End { .. } => {
                ended = true;
                event_names.push("agent_end".to_string());
            }
            AgentEvent::ToolStart { .. } => {
                tool_requests += 1;
                event_names.push("tool_start".to_string());
            }
            AgentEvent::ToolExecutionStart { .. } => {
                tool_executions += 1;
                event_names.push("tool_execution_start".to_string());
            }
            AgentEvent::Error { message } => {
                return Err(ApiError(StatusCode::BAD_GATEWAY, message));
            }
            _ => event_names.push("runtime_event".to_string()),
        }
    }
    worker
        .await
        .map_err(|error| ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let fixture_calls = fixture.calls.load(Ordering::Relaxed);
    if !ended || output.trim().is_empty() || fixture_calls == 0 {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "A3S 未完成本地固定响应模型会话".into(),
        ));
    }

    Ok(AgentProbe {
        runtime: "A3S Code Core",
        version: "9.1.1",
        command: "AmeR 路线建议（模拟输入）",
        model_source: "本地固定响应模型 · 非 AI 推理",
        events: event_names,
        output,
        fixture_calls,
        tool_requests,
        tool_executions,
        network_used: false,
    })
}

fn default_agent_permissions() -> PermissionPolicy {
    let mut permissions = PermissionPolicy::new();
    permissions.default_decision = PermissionDecision::Deny;
    permissions
}

async fn a3s_probe(State(state): State<Arc<AppState>>) -> Result<Json<AgentProbe>, ApiError> {
    let probe = run_a3s_probe(&state.agent_workspace).await?;
    let mut progress = state.progress.lock().await;
    let detail = format!(
        "{} · 本地固定响应模型调用 {} 次 · {} 个事件 · 未访问外网",
        probe.runtime,
        probe.fixture_calls,
        probe.events.len()
    );
    push_event(
        &mut progress,
        "a3s.fixture_session",
        "A3S 本地模拟模型链路验证",
        &detail,
        None,
    );
    state.persist(&progress).await.map_err(internal_error)?;
    Ok(Json(probe))
}

fn push_event(
    progress: &mut CaseProgress,
    kind: &str,
    title: &str,
    detail: &str,
    stage: Option<usize>,
) {
    let id = progress.next_event_id;
    progress.next_event_id += 1;
    progress.events.push(AuditEvent {
        id,
        at: now(),
        kind: kind.into(),
        title: title.into(),
        detail: detail.into(),
        stage,
    });
}

fn internal_error(error: std::io::Error) -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("无法保存本地演示状态：{error}"),
    )
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "product": "Fieldnote Research Studio",
        "data": "simulated"
    }))
}

fn app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/case", get(get_case))
        .route("/api/events", get(get_events))
        .route("/api/case/advance", post(advance_case))
        .route("/api/case/reset", post(reset_case))
        .route("/api/agent/probe", post(a3s_probe))
        .with_state(state)
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let root = env::current_dir()?;
    let root = env::var_os("FIELDNOTE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(root);
    let state = Arc::new(AppState::open(root).await?);
    let address = SocketAddr::from(([127, 0, 0, 1], 8081));
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Fieldnote API listening at http://{address}");
    axum::serve(listener, app(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn case_progress_persists_and_resumes() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState::open(root.path().to_path_buf()).await.unwrap();
        {
            let mut progress = state.progress.lock().await;
            progress.completed.push(0);
            progress.current_stage = 1;
            push_event(
                &mut progress,
                "stage.completed",
                "阶段已完成",
                "问题定义",
                Some(0),
            );
            state.persist(&progress).await.unwrap();
        }

        let reopened = AppState::open(root.path().to_path_buf()).await.unwrap();
        let progress = reopened.progress.lock().await;
        assert_eq!(progress.current_stage, 1);
        assert_eq!(progress.completed, vec![0]);
        assert!(progress
            .events
            .iter()
            .any(|event| event.kind == "stage.completed"));
    }

    #[tokio::test]
    async fn a3s_session_calls_local_fixture_and_emits_stream_events() {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("agent-workspace");
        tokio::fs::create_dir_all(&workspace).await.unwrap();
        let probe = run_a3s_probe(&workspace).await.unwrap();
        assert_eq!(probe.runtime, "A3S Code Core");
        assert_eq!(probe.version, "9.1.1");
        assert!(!probe.events.is_empty());
        assert!(probe.events.contains(&"text_delta".to_string()));
        assert!(probe.events.contains(&"agent_end".to_string()));
        assert_eq!(probe.output, FIXTURE_RECOMMENDATION);
        assert!(probe.fixture_calls >= 1);
        assert!(probe.model_source.contains("非 AI 推理"));
        assert_eq!(probe.tool_requests, 0);
        assert_eq!(probe.tool_executions, 0);
        assert!(!probe.network_used);
    }

    #[test]
    fn agent_policy_denies_unlisted_tools() {
        let policy = default_agent_permissions();
        for tool in ["shell", "write_file", "web_search", "hardware_control"] {
            assert_eq!(
                policy.check(tool, &serde_json::json!({})),
                PermissionDecision::Deny,
                "{tool} should be denied by the default policy"
            );
        }
    }
}
