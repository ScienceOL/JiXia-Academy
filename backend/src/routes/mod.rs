pub mod admin;
pub mod agent;
pub mod auth;
pub mod case;
pub mod conversations;
pub mod subjects;

use std::sync::Arc;

use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post},
    Json, Router,
};

use crate::state::AppState;

pub fn router(state: Arc<AppState>) -> Router {
    // 传输层限制略高于单文件上限，为 multipart 边界与头部留出余量；
    // 单文件的精确上限由上传处理器校验（超限返回 413）。
    let max_body = state.config.max_upload_bytes.saturating_add(1024 * 1024);
    Router::new()
        .route("/api/health", get(health))
        .route("/api/case", get(case::get_case))
        .route("/api/events", get(case::get_events))
        .route("/api/case/advance", post(case::advance_case))
        .route("/api/case/reset", post(case::reset_case))
        .route("/api/agent/probe", post(agent::a3s_probe))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::me))
        .route(
            "/api/subjects",
            get(subjects::list_subjects).post(subjects::create_subject),
        )
        .route(
            "/api/subjects/{id}",
            get(subjects::get_subject)
                .patch(subjects::update_subject)
                .delete(subjects::delete_subject),
        )
        .route(
            "/api/subjects/{id}/documents",
            get(subjects::list_documents).post(subjects::upload_document),
        )
        .route(
            "/api/documents/{id}",
            get(subjects::get_document).delete(subjects::delete_document),
        )
        .route("/api/documents/{id}/content", get(subjects::download_document))
        .route("/api/runs", get(subjects::list_runs))
        .route("/api/workspace/summary", get(conversations::workspace_summary))
        .route(
            "/api/conversations",
            get(conversations::list_conversations).post(conversations::create_conversation),
        )
        .route(
            "/api/conversations/{id}",
            get(conversations::get_conversation).delete(conversations::delete_conversation),
        )
        .route(
            "/api/conversations/{id}/messages",
            post(conversations::post_message),
        )
        .route("/api/tools", get(conversations::list_tools))
        .route(
            "/api/subjects/{id}/tools",
            get(conversations::list_subject_tools).post(conversations::add_subject_tool),
        )
        .route(
            "/api/subjects/{id}/tools/{tool_id}",
            delete(conversations::remove_subject_tool),
        )
        .route("/api/admin/backup", post(admin::create_backup))
        .layer(DefaultBodyLimit::max(max_body))
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "product": "Fieldnote Research Studio",
        "data": "simulated"
    }))
}
