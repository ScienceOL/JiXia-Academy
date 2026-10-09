use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    auth::{create_session, current_user, hash_password, session_token_hash, verify_password},
    error::ApiError,
    models::User,
    state::AppState,
    util::now,
};

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub display_name: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub expires_at: i64,
    pub user: User,
}

/// 注册：邮箱唯一，密码长度 ≥8。
pub async fn register(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), ApiError> {
    let email = normalize_email(&body.email)?;
    validate_password(&body.password)?;
    let display_name = body.display_name.trim().to_string();
    if display_name.is_empty() {
        return Err(ApiError::bad_request("显示名称不能为空"));
    }
    if display_name.chars().count() > 60 {
        return Err(ApiError::bad_request("显示名称过长"));
    }

    let password_hash = hash_password(&body.password)?;
    let created_at = now();
    let insert = state.db.with(|conn| {
        conn.execute(
            "INSERT INTO users (email, display_name, password_hash, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![email, display_name, password_hash, created_at],
        )?;
        Ok(conn.last_insert_rowid())
    });

    let user_id = match insert {
        Ok(id) => id,
        Err(error) if is_unique_violation(&error) => {
            state.audit(None, "auth.register", &email, "failure", json!({ "reason": "duplicate_email" }));
            return Err(ApiError::conflict("该邮箱已被注册"));
        }
        Err(error) => return Err(error.into()),
    };

    let (token, expires_at) = create_session(&state, user_id)?;
    state.audit(Some(user_id), "auth.register", &email, "success", json!({}));
    let user = fetch_user(&state, user_id)?;
    Ok((
        StatusCode::CREATED,
        Json(AuthResponse {
            token,
            expires_at,
            user,
        }),
    ))
}

/// 登录：失败时统一返回同一错误，不区分邮箱是否存在。
pub async fn login(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let email = normalize_email(&body.email)?;
    let found = state.db.with(|conn| {
        conn.query_row(
            "SELECT id, password_hash FROM users WHERE email = ?1",
            params![email],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
    })?;

    let Some((user_id, password_hash)) = found else {
        state.audit(None, "auth.login", &email, "failure", json!({ "reason": "unknown_email" }));
        return Err(ApiError::unauthorized("邮箱或密码不正确"));
    };

    if !verify_password(&body.password, &password_hash) {
        state.audit(Some(user_id), "auth.login", &email, "failure", json!({ "reason": "bad_password" }));
        return Err(ApiError::unauthorized("邮箱或密码不正确"));
    }

    let (token, expires_at) = create_session(&state, user_id)?;
    state.audit(Some(user_id), "auth.login", &email, "success", json!({}));
    let user = fetch_user(&state, user_id)?;
    Ok(Json(AuthResponse {
        token,
        expires_at,
        user,
    }))
}

/// 注销：吊销当前会话。
pub async fn logout(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    let user = current_user(&state, &headers)?;
    let token_hash = session_token_hash(&headers)?;
    state.db.with(|conn| {
        conn.execute("DELETE FROM sessions WHERE token_hash = ?1", params![token_hash])?;
        Ok(())
    })?;
    state.audit(Some(user.id), "auth.logout", &user.email, "success", json!({}));
    Ok(StatusCode::NO_CONTENT)
}

/// 当前用户。
pub async fn me(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<User>, ApiError> {
    Ok(Json(current_user(&state, &headers)?))
}

pub fn normalize_email(raw: &str) -> Result<String, ApiError> {
    let email = raw.trim().to_ascii_lowercase();
    if email.is_empty() || email.len() > 254 || !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err(ApiError::bad_request("邮箱格式不正确"));
    }
    Ok(email)
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    let len = password.chars().count();
    if len < 8 {
        return Err(ApiError::bad_request("密码长度至少 8 位"));
    }
    if len > 128 {
        return Err(ApiError::bad_request("密码过长"));
    }
    Ok(())
}

fn fetch_user(state: &AppState, id: i64) -> Result<User, ApiError> {
    state
        .db
        .with(|conn| {
            conn.query_row(
                "SELECT id, email, display_name, created_at FROM users WHERE id = ?1",
                params![id],
                User::from_row,
            )
            .optional()
        })?
        .ok_or_else(|| ApiError::not_found("用户不存在"))
}

fn is_unique_violation(error: &rusqlite::Error) -> bool {
    match error {
        rusqlite::Error::SqliteFailure(code, _) => {
            code.code == rusqlite::ErrorCode::ConstraintViolation
        }
        _ => false,
    }
}
