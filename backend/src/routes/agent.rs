use std::sync::Arc;

use axum::{extract::State, Json};

use crate::{agent::run_a3s_probe, case::push_event, error::ApiError, state::AppState};

pub async fn a3s_probe(
    State(state): State<Arc<AppState>>,
) -> Result<Json<crate::agent::AgentProbe>, ApiError> {
    let probe = run_a3s_probe(&state.config.agent_workspace).await?;
    {
        let mut progress = state.case.lock().await;
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
        state
            .persist_case(&progress)
            .await
            .map_err(|error| ApiError::internal(format!("无法保存本地演示状态：{error}")))?;
    }
    state.audit(
        None,
        "agent.probe",
        "",
        "success",
        serde_json::json!({ "fixture_calls": probe.fixture_calls, "network_used": probe.network_used }),
    );
    Ok(Json(probe))
}
