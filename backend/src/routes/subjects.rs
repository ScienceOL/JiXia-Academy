use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::{Multipart, Path, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde_json::json;

use crate::{
    auth::current_user,
    error::ApiError,
    models::{Document, RunRecord, Subject, SubjectInput},
    state::AppState,
    storage, util,
};

// ---------------------------------------------------------------------------
// 课题
// ---------------------------------------------------------------------------

pub async fn list_subjects(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<Subject>>, ApiError> {
    let user = current_user(&state, &headers)?;
    let subjects = state.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT * FROM subjects WHERE owner_id = ?1 ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = stmt
            .query_map(params![user.id], Subject::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(Json(subjects))
}

pub async fn create_subject(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SubjectInput>,
) -> Result<(StatusCode, Json<Subject>), ApiError> {
    let user = current_user(&state, &headers)?;
    validate_subject_input(&body)?;
    let now = util::now();
    let subject = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO subjects (owner_id, name, field, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![
                user.id,
                body.name.trim(),
                body.field.trim(),
                body.description.trim(),
                now
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row("SELECT * FROM subjects WHERE id = ?1", params![id], Subject::from_row)
    })?;
    state.audit(
        Some(user.id),
        "subject.created",
        &subject.name,
        "success",
        json!({ "subject_id": subject.id }),
    );
    Ok((StatusCode::CREATED, Json(subject)))
}

pub async fn get_subject(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Subject>, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    Ok(Json(subject))
}

pub async fn update_subject(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<SubjectInput>,
) -> Result<Json<Subject>, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    validate_subject_input(&body)?;
    let now = util::now();
    let updated = state.db.with(|conn| {
        conn.execute(
            "UPDATE subjects SET name = ?1, field = ?2, description = ?3, updated_at = ?4
             WHERE id = ?5 AND owner_id = ?6",
            params![
                body.name.trim(),
                body.field.trim(),
                body.description.trim(),
                now,
                subject.id,
                user.id
            ],
        )?;
        conn.query_row("SELECT * FROM subjects WHERE id = ?1", params![subject.id], Subject::from_row)
    })?;
    state.audit(
        Some(user.id),
        "subject.updated",
        &updated.name,
        "success",
        json!({ "subject_id": updated.id }),
    );
    Ok(Json(updated))
}

pub async fn delete_subject(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;

    let stored: Vec<String> = state.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT stored_name FROM documents WHERE subject_id = ?1")?;
        let rows = stmt
            .query_map(params![subject.id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    let dir = storage::subject_dir(&state.config.uploads_dir, subject.id);
    for name in stored {
        let _ = tokio::fs::remove_file(dir.join(name)).await;
    }
    let _ = tokio::fs::remove_dir_all(&dir).await;

    state.db.with(|conn| {
        conn.execute(
            "DELETE FROM subjects WHERE id = ?1 AND owner_id = ?2",
            params![subject.id, user.id],
        )?;
        Ok(())
    })?;
    state.audit(
        Some(user.id),
        "subject.deleted",
        &subject.name,
        "success",
        json!({ "subject_id": subject.id }),
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// 课题知识库文档
// ---------------------------------------------------------------------------

pub async fn list_documents(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(subject_id): Path<i64>,
) -> Result<Json<Vec<Document>>, ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;
    let documents = state.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, subject_id, owner_id, original_name, byte_size, sha256, content_type, created_at
             FROM documents WHERE subject_id = ?1 ORDER BY id DESC",
        )?;
        let rows = stmt
            .query_map(params![subject.id], Document::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(Json(documents))
}

pub async fn upload_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(subject_id): Path<i64>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Document>), ApiError> {
    let user = current_user(&state, &headers)?;
    let subject = subject_for_owner(&state, subject_id, user.id)?
        .ok_or_else(|| ApiError::not_found("课题不存在"))?;

    let mut uploaded: Option<(String, Bytes)> = None;
    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
        if field.name() != Some("file") {
            continue;
        }
        let file_name = field.file_name().unwrap_or_default().to_string();
        let bytes = field.bytes().await.map_err(multipart_error)?;
        uploaded = Some((file_name, bytes));
        break;
    }

    let (raw_name, bytes) = uploaded.ok_or_else(|| ApiError::bad_request("缺少 file 字段"))?;
    let original_name = storage::validate_original_name(&raw_name)?;
    let ext = storage::extension_of(&original_name)?;
    if bytes.is_empty() {
        return Err(ApiError::bad_request("文件内容为空"));
    }
    if bytes.len() > state.config.max_upload_bytes {
        return Err(ApiError::payload_too_large(format!(
            "文件超过大小上限（{} 字节）",
            state.config.max_upload_bytes
        )));
    }

    let stored_name = storage::new_stored_name(&ext);
    let dir = storage::ensure_subject_dir(&state.config.uploads_dir, subject.id)?;
    let path = dir.join(&stored_name);
    tokio::fs::write(&path, &bytes).await?;

    let sha256 = util::sha256_hex(&bytes);
    let content_type = storage::content_type_for(&ext).to_string();
    let byte_size = bytes.len() as i64;
    let created_at = util::now();

    let insert = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO documents
             (subject_id, owner_id, original_name, stored_name, byte_size, sha256, content_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                subject.id,
                user.id,
                original_name,
                stored_name,
                byte_size,
                sha256,
                content_type,
                created_at
            ],
        )?;
        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, subject_id, owner_id, original_name, byte_size, sha256, content_type, created_at
             FROM documents WHERE id = ?1",
            params![id],
            Document::from_row,
        )
    });

    match insert {
        Ok(document) => {
            state.audit(
                Some(user.id),
                "document.uploaded",
                &document.original_name,
                "success",
                json!({
                    "document_id": document.id,
                    "subject_id": subject.id,
                    "byte_size": document.byte_size,
                    "sha256": document.sha256,
                }),
            );
            Ok((StatusCode::CREATED, Json(document)))
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&path).await;
            Err(error.into())
        }
    }
}

pub async fn get_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Json<Document>, ApiError> {
    let user = current_user(&state, &headers)?;
    let document = document_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("文档不存在"))?;
    Ok(Json(document))
}

pub async fn download_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<Response, ApiError> {
    let user = current_user(&state, &headers)?;
    let document = document_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("文档不存在"))?;
    let stored_name = stored_name_for(&state, document.id)?;
    let path = storage::subject_dir(&state.config.uploads_dir, document.subject_id).join(stored_name);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|error| ApiError::internal(format!("无法读取文件：{error}")))?;

    let mut out = HeaderMap::new();
    out.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&document.content_type)
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    out.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "attachment; filename*=UTF-8''{}",
            percent_encode(&document.original_name)
        ))
        .unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    out.insert(
        header::HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    Ok((out, bytes).into_response())
}

pub async fn delete_document(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    let user = current_user(&state, &headers)?;
    let document = document_for_owner(&state, id, user.id)?
        .ok_or_else(|| ApiError::not_found("文档不存在"))?;
    let stored_name = stored_name_for(&state, document.id)?;
    let path = storage::subject_dir(&state.config.uploads_dir, document.subject_id).join(stored_name);
    if let Err(error) = tokio::fs::remove_file(&path).await {
        if error.kind() != std::io::ErrorKind::NotFound {
            state.logger.warn(
                "document.file_remove_failed",
                "删除磁盘文件失败",
                json!({ "document_id": document.id, "error": error.to_string() }),
            );
        }
    }
    state.db.with(|conn| {
        conn.execute(
            "DELETE FROM documents WHERE id = ?1 AND owner_id = ?2",
            params![document.id, user.id],
        )?;
        Ok(())
    })?;
    state.audit(
        Some(user.id),
        "document.deleted",
        &document.original_name,
        "success",
        json!({ "document_id": document.id }),
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// 运行记录（只读；写入接口留待阶段 E）
// ---------------------------------------------------------------------------

pub async fn list_runs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<RunRecord>>, ApiError> {
    let user = current_user(&state, &headers)?;
    let runs = state.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT * FROM runs WHERE owner_id = ?1 ORDER BY id DESC")?;
        let rows = stmt
            .query_map(params![user.id], RunRecord::from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(Json(runs))
}

// ---------------------------------------------------------------------------
// 内部辅助（供路由与测试复用）
// ---------------------------------------------------------------------------

pub fn subject_for_owner(
    state: &AppState,
    id: i64,
    owner_id: i64,
) -> Result<Option<Subject>, ApiError> {
    Ok(state.db.with(|conn| {
        conn.query_row(
            "SELECT * FROM subjects WHERE id = ?1 AND owner_id = ?2",
            params![id, owner_id],
            Subject::from_row,
        )
        .optional()
    })?)
}

pub fn document_for_owner(
    state: &AppState,
    id: i64,
    owner_id: i64,
) -> Result<Option<Document>, ApiError> {
    Ok(state.db.with(|conn| {
        conn.query_row(
            "SELECT id, subject_id, owner_id, original_name, byte_size, sha256, content_type, created_at
             FROM documents WHERE id = ?1 AND owner_id = ?2",
            params![id, owner_id],
            Document::from_row,
        )
        .optional()
    })?)
}

fn stored_name_for(state: &AppState, id: i64) -> Result<String, ApiError> {
    Ok(state
        .db
        .with(|conn| {
            conn.query_row(
                "SELECT stored_name FROM documents WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
        })?
        .ok_or_else(|| ApiError::not_found("文档不存在"))?)
}

/// 将 multipart 解析错误映射为对应状态码（大小超限为 413，其余为 400）。
fn multipart_error(error: axum::extract::multipart::MultipartError) -> ApiError {
    ApiError::new(error.status(), error.body_text())
}

fn validate_subject_input(input: &SubjectInput) -> Result<(), ApiError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("课题名称不能为空"));
    }
    if name.chars().count() > 50 {
        return Err(ApiError::bad_request("课题名称不能超过 50 个字符"));
    }
    if input.field.chars().count() > 50 {
        return Err(ApiError::bad_request("领域不能超过 50 个字符"));
    }
    if input.description.chars().count() > 200 {
        return Err(ApiError::bad_request("描述不能超过 200 个字符"));
    }
    Ok(())
}

fn percent_encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' | b'~' => {
                out.push(*byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}
