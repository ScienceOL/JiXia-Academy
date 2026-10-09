//! 阶段 E：对话与课题空间接口（本地模拟回复，不访问外网、不执行工具）。

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    agent::run_a3s_chat,
    auth::current_user,
    error::ApiError,
    models::{Conversation, MessageRecord},
    routes::subjects::subject_for_owner,
    state::AppState,
    tools,
    util,
};

const MAX_MESSAGE_CHARS: usize = 4000;
const MAX_TITLE_CHARS: usize = 60;
const MAX_MODEL_CHARS: usize = 64;

// ---------------------------------------------------------------------------
// 用量摘要
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct WorkspaceSummary {
    pub subjects: i64,
    pub documents: i64,
    pub conversations: i64,
    pub messages: i64,
    pub runs: i64,
    pub storage_bytes: i64,
}

pub async fn workspace_summary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<WorkspaceSummary>, ApiError> {
    let user = current_user(&state, &headers)?;
    let summary = state.db.with(|conn| {
        let subjects = scalar_i64(conn, "SELECT COUNT(*) FROM subjects WHERE owner_id = ?1", user.id)?;
        let documents =
            scalar_i64(conn, "SELECT COUNT(*) FROM documents WHERE owner_id = ?1", user.id)?;
        let conversations =
            scalar_i64(conn, "SELECT COUNT(*) FROM conversations WHERE owner_id = ?1", user.id)?;
        let messages = scalar_i64(
            conn,
            "SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE c.owner_id = ?1",
            user.id,
        )?;
        let runs = scalar_i64(conn, "SELECT COUNT(*) FROM runs WHERE owner_id = ?1", user.id)?;
        let storage_bytes: i64 = conn.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM documents WHERE owner_id = ?1",
            params![user.id],
            |row| row.get(0),
        )?;
        Ok(WorkspaceSummary {
            subjects,
            documents,
            conversations,
            messages,
            runs,
            storage_bytes,
        })
    })?;
    Ok(Json(summary))
}

// ---------------------------------------------------------------------------
// 会话
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ConversationSummary {
    pub id: i64,
    pub subject_id: i64,
    pub subject_name: String,
    pub title: String,
    pub mode: String,
    pub model: String,
    pub message_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Deserialize)]
pub struct ConversationInput {
    pub subject_id: i64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Serialize)]
pub struct ConversationDetail {
    pub conversation: Conversation,
    pub subject_name: String,
    pub messages: Vec<MessageRecord>,
}

pub async fn list_conversations(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<ConversationSummary>>, ApiError> {
    let user = current_user(&state, &headers)?;
    let items = state.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.subject_id, s.name AS subject_name, c.title, c.mode, c.model,
                    c.created_at, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
             FROM conversations c JOIN subjects s ON s.id = c.subject_id
             WHERE c.owner_id = ?1
             ORDER BY c.updated_at DESC, c.id DESC",
        )?;
        let rows = stmt
            .query_map(params![user.id], |row| {
                Ok(ConversationSummary {
                    id: row.get("id")?,
                    subject_id: row.get("subject_id")?,
                    subject_name: row.get("subject_name")?,
                    title: row.get("title")?,
                    mode: row.get("mode")?,
                    model: row.get("model")?,
                    message_count: row.get("message_count")?,
                    created_at: row.get("created_at")?,
                    updated_at: row.get("updated_at")?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(Json(items))
}

pub async fn create_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<ConversationInput>,
) -> Result<(StatusCode, Json<Conversation>), ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, body.subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let mode = normalize_mode(&body.mode)?;
    let model = normalize_model(&body.model)?;
    let title = normalize_title(&body.title);
    let now = util::now();
    let conversation = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO conversations (subject_id, owner_id, title, mode, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
            params![subject.id, user.id, title, mode, model, now],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT * FROM conversations WHERE id = ?1",
            params![id],
            Conversation::from_row,
        )
    })?;
    state.audit(
        Some(user.id),
        "conversation.created",
        &conversation.title,
        "success",
        json!({ "conversation_id": conversation.id, "subject_id": subject.id }),
    );
    Ok((StatusCode::CREATED, Json(conversation)))
}

pub async fn get_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<ConversationDetail>, ApiError> {
    let user = current_user(&state, &headers)?;
    let conversation = conversation_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("对话不存在"))?;
    let subject = subject_for_owner(&state, conversation.subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let messages = state.db.with(|conn| {
        let mut stmt =
            conn.prepare("SELECT * FROM messages WHERE conversation_id = ?1 ORDER BY id ASC")?;
        let rows = stmt
            .query_map(params![conversation.id], MessageRecord::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(Json(ConversationDetail {
        conversation,
        subject_name: subject.name,
        messages,
    }))
}

pub async fn delete_conversation(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let user = current_user(&state, &headers)?;
    let conversation = conversation_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("对话不存在"))?;
    state.db.with(|conn| {
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1 AND owner_id = ?2",
            params![conversation.id, user.id],
        )?;
        Ok(())
    })?;
    state.audit(
        Some(user.id),
        "conversation.deleted",
        &conversation.title,
        "success",
        json!({ "conversation_id": conversation.id }),
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// 发送消息（本地模拟回复）
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct MessageInput {
    pub content: String,
}

#[derive(Serialize)]
pub struct ChatMeta {
    pub runtime: String,
    pub version: String,
    pub model_source: String,
    pub fixture_calls: usize,
    pub tool_requests: usize,
    pub tool_executions: usize,
    pub network_used: bool,
    pub events: Vec<String>,
    pub simulated: bool,
}

#[derive(Serialize)]
pub struct MessageExchange {
    pub conversation_id: i64,
    pub title: String,
    pub user_message: MessageRecord,
    pub assistant_message: MessageRecord,
    pub meta: ChatMeta,
}

pub async fn post_message(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<MessageInput>,
) -> Result<(StatusCode, Json<MessageExchange>), ApiError> {
    let user = current_user(&state, &headers)?;
    let conversation = conversation_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("对话不存在"))?;

    let content = body.content.trim();
    if content.is_empty() {
        return Err(ApiError::bad_request("消息内容不能为空"));
    }
    if content.chars().count() > MAX_MESSAGE_CHARS {
        return Err(ApiError::bad_request("消息内容不能超过 4000 个字符"));
    }

    let subject = subject_for_owner(&state, conversation.subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let documents: Vec<String> = state.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT original_name FROM documents WHERE subject_id = ?1 ORDER BY id DESC LIMIT 20",
        )?;
        let rows = stmt
            .query_map(params![subject.id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;

    let now = util::now();
    let user_message = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at)
             VALUES (?1, 'user', ?2, ?3)",
            params![conversation.id, content, now],
        )?;
        let message_id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT * FROM messages WHERE id = ?1",
            params![message_id],
            MessageRecord::from_row,
        )
    })?;

    // 首条消息回填标题。
    let message_count = state.db.with(|conn| {
        scalar_i64(
            conn,
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            conversation.id,
        )
    })?;
    let title = if message_count == 1 {
        derive_title(content)
    } else {
        conversation.title.clone()
    };

    let prompt = compose_prompt(content, &subject.name, &conversation.mode, &documents);
    let reply = run_a3s_chat(&state.config.agent_workspace, &prompt).await?;

    let assistant_message = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at)
             VALUES (?1, 'assistant', ?2, ?3)",
            params![conversation.id, reply.output, now],
        )?;
        let message_id = conn.last_insert_rowid();
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, conversation.id],
        )?;
        conn.query_row(
            "SELECT * FROM messages WHERE id = ?1",
            params![message_id],
            MessageRecord::from_row,
        )
    })?;

    let meta = ChatMeta {
        runtime: reply.runtime.to_string(),
        version: reply.version.to_string(),
        model_source: "本地固定响应模型 · 非 AI 推理".to_string(),
        fixture_calls: reply.fixture_calls,
        tool_requests: reply.tool_requests,
        tool_executions: reply.tool_executions,
        network_used: reply.network_used,
        events: reply.events.clone(),
        simulated: true,
    };
    let input_json = json!({
        "conversation_id": conversation.id,
        "subject_id": subject.id,
        "mode": conversation.mode,
        "model": conversation.model,
        "content": content,
    })
    .to_string();
    let output_json = json!({
        "runtime": meta.runtime,
        "version": meta.version,
        "model_source": meta.model_source,
        "fixture_calls": meta.fixture_calls,
        "tool_requests": meta.tool_requests,
        "tool_executions": meta.tool_executions,
        "network_used": meta.network_used,
        "events": meta.events,
        "simulated": true,
    })
    .to_string();

    state.db.with(|conn| {
        conn.execute(
            "INSERT INTO runs (subject_id, owner_id, kind, status, input_json, output_json, created_at, updated_at)
             VALUES (?1, ?2, 'a3s.chat', 'succeeded', ?3, ?4, ?5, ?5)",
            params![subject.id, user.id, input_json, output_json, now],
        )?;
        let run_id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO evidence (run_id, subject_id, kind, label, detail, created_at)
             VALUES (?1, ?2, 'chat.reply', '本地模拟回复', ?3, ?4)",
            params![run_id, subject.id, output_json, now],
        )?;
        Ok(())
    })?;

    state.audit(
        Some(user.id),
        "conversation.message",
        &title,
        "success",
        json!({ "conversation_id": conversation.id, "run_kind": "a3s.chat" }),
    );

    Ok((
        StatusCode::CREATED,
        Json(MessageExchange {
            conversation_id: conversation.id,
            title,
            user_message,
            assistant_message,
            meta,
        }),
    ))
}

// ---------------------------------------------------------------------------
// 工具目录与课题关联
// ---------------------------------------------------------------------------

#[derive(Deserialize, Default)]
pub struct ToolQuery {
    pub kind: Option<String>,
    pub q: Option<String>,
    pub field: Option<String>,
    pub purpose: Option<String>,
    pub sort: Option<String>,
}

#[derive(Serialize)]
pub struct ToolListResponse {
    pub total: usize,
    pub items: Vec<tools::ToolItem>,
    pub fields: Vec<&'static str>,
    pub purposes: Vec<&'static str>,
}

pub async fn list_tools(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<ToolQuery>,
) -> Result<Json<ToolListResponse>, ApiError> {
    let _user = current_user(&state, &headers)?;
    let mut items = tools::filter(
        query.kind.as_deref(),
        query.field.as_deref(),
        query.purpose.as_deref(),
        query.q.as_deref(),
    );
    tools::sort_items(&mut items, query.sort.as_deref());
    Ok(Json(ToolListResponse {
        total: items.len(),
        items,
        fields: tools::fields(),
        purposes: tools::purposes(),
    }))
}

#[derive(Serialize)]
pub struct SubjectToolItem {
    pub tool_id: String,
    pub added_at: i64,
    pub tool: Option<tools::ToolItem>,
}

#[derive(Deserialize)]
pub struct SubjectToolInput {
    pub tool_id: String,
}

pub async fn list_subject_tools(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(subject_id): Path<i64>,
) -> Result<Json<Vec<SubjectToolItem>>, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let rows = state.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT tool_id, added_at FROM subject_tools WHERE subject_id = ?1
             ORDER BY added_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map(params![subject.id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    let items = rows
        .into_iter()
        .map(|(tool_id, added_at)| SubjectToolItem {
            tool: tools::find(&tool_id),
            tool_id,
            added_at,
        })
        .collect();
    Ok(Json(items))
}

pub async fn add_subject_tool(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(subject_id): Path<i64>,
    Json(body): Json<SubjectToolInput>,
) -> Result<(StatusCode, Json<SubjectToolItem>), ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let tool = tools::find(body.tool_id.trim())
        .ok_or_else(|| ApiError::bad_request("工具不在目录中"))?;
    let now = util::now();
    let (created, added_at) = state.db.with(|conn| {
        conn.execute(
            "INSERT OR IGNORE INTO subject_tools (subject_id, tool_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![subject.id, tool.id, now],
        )?;
        let created = conn.changes() > 0;
        let added_at: i64 = conn.query_row(
            "SELECT added_at FROM subject_tools WHERE subject_id = ?1 AND tool_id = ?2",
            params![subject.id, tool.id],
            |row| row.get(0),
        )?;
        Ok((created, added_at))
    })?;
    if created {
        state.audit(
            Some(user.id),
            "subject.tool_added",
            tool.name,
            "success",
            json!({ "subject_id": subject.id, "tool_id": tool.id }),
        );
    }
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((
        status,
        Json(SubjectToolItem {
            tool_id: tool.id.to_string(),
            added_at,
            tool: Some(tool),
        }),
    ))
}

pub async fn remove_subject_tool(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((subject_id, tool_id)): Path<(i64, String)>,
) -> Result<StatusCode, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    state.db.with(|conn| {
        conn.execute(
            "DELETE FROM subject_tools WHERE subject_id = ?1 AND tool_id = ?2",
            params![subject.id, tool_id],
        )?;
        Ok(())
    })?;
    state.audit(
        Some(user.id),
        "subject.tool_removed",
        &tool_id,
        "success",
        json!({ "subject_id": subject.id, "tool_id": tool_id }),
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

pub fn conversation_for_owner(
    state: &AppState,
    id: i64,
    owner_id: i64,
) -> Result<Option<Conversation>, ApiError> {
    Ok(state.db.with(|conn| {
        conn.query_row(
            "SELECT * FROM conversations WHERE id = ?1 AND owner_id = ?2",
            params![id, owner_id],
            Conversation::from_row,
        )
        .optional()
    })?)
}

fn scalar_i64(conn: &rusqlite::Connection, sql: &str, value: i64) -> rusqlite::Result<i64> {
    conn.query_row(sql, params![value], |row| row.get(0))
}

fn normalize_mode(raw: &str) -> Result<String, ApiError> {
    match raw.trim() {
        "" | "quick" => Ok("quick".to_string()),
        "deep" => Ok("deep".to_string()),
        _ => Err(ApiError::bad_request("mode 只能是 quick 或 deep")),
    }
}

fn normalize_model(raw: &str) -> Result<String, ApiError> {
    let value = raw.trim();
    let value = if value.is_empty() { "auto" } else { value };
    if value.chars().count() > MAX_MODEL_CHARS {
        return Err(ApiError::bad_request("模型标识过长"));
    }
    Ok(value.to_string())
}

fn normalize_title(raw: &str) -> String {
    let value = raw.trim();
    if value.is_empty() {
        "新对话".to_string()
    } else {
        value.chars().take(MAX_TITLE_CHARS).collect()
    }
}

/// 由首条消息推导标题：折叠空白后取前 24 个字符。
fn derive_title(content: &str) -> String {
    let compact = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let title: String = compact.chars().take(24).collect();
    if title.is_empty() {
        "新对话".to_string()
    } else {
        title
    }
}

/// 组合送入本地固定响应模型的提示词：课题、模式、附件名与用户问题。
fn compose_prompt(content: &str, subject_name: &str, mode: &str, documents: &[String]) -> String {
    let mode_label = if mode == "deep" { "深度" } else { "快速" };
    let attachments = if documents.is_empty() {
        "暂无附件".to_string()
    } else {
        documents.join("、")
    };
    format!(
        "【课题】{subject_name}\n【模式】{mode_label}\n【知识库附件】{attachments}\n\n【用户问题】{content}"
    )
}
