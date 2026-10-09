use std::sync::Arc;

use axum::{extract::State, Json};

use crate::{
    case::{push_event, response, stages, AuditEvent, CaseProgress, CaseResponse},
    error::ApiError,
    state::AppState,
};

pub async fn get_case(State(state): State<Arc<AppState>>) -> Json<CaseResponse> {
    let progress = state.case.lock().await;
    Json(response(&progress))
}

pub async fn get_events(State(state): State<Arc<AppState>>) -> Json<Vec<AuditEvent>> {
    Json(state.case.lock().await.events.clone())
}

pub async fn advance_case(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CaseResponse>, ApiError> {
    let mut progress = state.case.lock().await;
    if progress.finished {
        return Err(ApiError::conflict(
            "案例全部阶段已完成，请重置后重新演示",
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
    state
        .persist_case(&progress)
        .await
        .map_err(|error| ApiError::internal(format!("无法保存本地演示状态：{error}")))?;
    Ok(Json(response(&progress)))
}

pub async fn reset_case(
    State(state): State<Arc<AppState>>,
) -> Result<Json<CaseResponse>, ApiError> {
    let mut current = state.case.lock().await;
    let mut progress = CaseProgress::default();
    push_event(
        &mut progress,
        "case.reset",
        "演示已重置",
        "已从问题定义阶段重新开始",
        Some(0),
    );
    state
        .persist_case(&progress)
        .await
        .map_err(|error| ApiError::internal(format!("无法保存本地演示状态：{error}")))?;
    let result = response(&progress);
    *current = progress;
    Ok(Json(result))
}
