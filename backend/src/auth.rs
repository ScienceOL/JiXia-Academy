use argon2::{
    password_hash::{PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use axum::http::{HeaderMap, header::AUTHORIZATION};
use rand::RngCore;
use rusqlite::{params, OptionalExtension};

use crate::{
    error::ApiError,
    models::User,
    state::AppState,
    util::{now, random_hex, sha256_hex},
};

/// 用 Argon2id + 随机盐哈希密码。
pub fn hash_password(password: &str) -> Result<String, ApiError> {
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)
        .map_err(|error| ApiError::internal(format!("无法生成密码盐：{error}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| ApiError::internal(format!("无法哈希密码：{error}")))
}

/// 校验密码与已存哈希是否匹配。
pub fn verify_password(password: &str, stored: &str) -> bool {
    match PasswordHash::new(stored) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// 生成新的会话令牌（明文仅返回给客户端一次）。
pub fn new_token() -> String {
    random_hex(32)
}

/// 会话令牌的不可逆摘要，数据库只保存该摘要。
pub fn hash_token(token: &str) -> String {
    sha256_hex(token.as_bytes())
}

/// 创建会话并返回明文令牌与过期时间。
pub fn create_session(
    state: &AppState,
    user_id: i64,
) -> Result<(String, i64), ApiError> {
    let token = new_token();
    let token_hash = hash_token(&token);
    let created_at = now();
    let expires_at = created_at + state.config.session_ttl_secs;
    state.db.with(|conn| {
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
            params![token_hash, user_id, created_at, expires_at],
        )?;
        Ok(())
    })?;
    Ok((token, expires_at))
}

/// 依据请求头解析当前登录用户；失败返回 401。
pub fn current_user(state: &AppState, headers: &HeaderMap) -> Result<User, ApiError> {
    let token = bearer_token(headers)?;
    let token_hash = hash_token(&token);
    let now = now();
    let user = state
        .db
        .with(|conn| {
            conn.query_row(
                "SELECT u.id, u.email, u.display_name, u.created_at
                 FROM sessions s JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?1 AND s.expires_at > ?2",
                params![token_hash, now],
                User::from_row,
            )
            .optional()
        })?
        .ok_or_else(|| ApiError::unauthorized("会话无效或已过期"))?;
    Ok(user)
}

/// 从请求头解析并返回会话令牌摘要（供注销使用）。
pub fn session_token_hash(headers: &HeaderMap) -> Result<String, ApiError> {
    Ok(hash_token(&bearer_token(headers)?))
}

fn bearer_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let raw = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::unauthorized("缺少访问令牌"))?;
    let token = raw
        .strip_prefix("Bearer ")
        .ok_or_else(|| ApiError::unauthorized("访问令牌格式不正确"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(ApiError::unauthorized("访问令牌为空"));
    }
    Ok(token)
}
