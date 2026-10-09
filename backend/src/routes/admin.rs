use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use serde_json::json;

use crate::{
    auth::current_user,
    error::ApiError,
    state::AppState,
    util::{now, sha256_hex},
};

#[derive(Serialize)]
pub struct BackupResponse {
    /// 相对数据根目录的备份路径（正斜杠分隔）。
    pub file: String,
    pub byte_size: u64,
    pub sha256: String,
    pub created_at: i64,
}

/// 生成数据库一致性备份快照（需认证）。文件写入 `<data>/backups/`，返回相对路径与 SHA-256。
pub async fn create_backup(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<(StatusCode, Json<BackupResponse>), ApiError> {
    let user = current_user(&state, &headers)?;

    let created_at = now();
    let (path, file) = unique_backup_path(&state)?;
    state.db.backup_to(&path)?;

    let bytes = tokio::fs::read(&path).await?;
    let sha256 = sha256_hex(&bytes);
    let byte_size = bytes.len() as u64;

    state.audit(
        Some(user.id),
        "backup.created",
        &file,
        "success",
        json!({ "byte_size": byte_size, "sha256": sha256 }),
    );

    Ok((
        StatusCode::CREATED,
        Json(BackupResponse {
            file,
            byte_size,
            sha256,
            created_at,
        }),
    ))
}

/// 在同一秒内重复触发备份时通过序号后缀避让，避免 `VACUUM INTO` 目标已存在而失败。
/// 返回磁盘绝对路径与相对数据根目录的展示路径。
fn unique_backup_path(state: &AppState) -> Result<(std::path::PathBuf, String), ApiError> {
    let stamp = now();
    for attempt in 0..1000 {
        let file_name = if attempt == 0 {
            format!("backup-{stamp}.db")
        } else {
            format!("backup-{stamp}-{attempt}.db")
        };
        let path = state.config.backups_dir.join(&file_name);
        if !path.exists() {
            let relative = path
                .strip_prefix(&state.config.data_dir)
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| file_name.clone());
            return Ok((path, relative));
        }
    }
    Err(ApiError::conflict("备份命名冲突，请稍后重试"))
}
