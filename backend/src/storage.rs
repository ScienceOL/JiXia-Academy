use std::path::{Path, PathBuf};

use crate::error::ApiError;

/// 允许上传的文件扩展名白名单（小写）。
pub const ALLOWED_EXTENSIONS: &[&str] = &["pdf", "txt", "md", "csv", "json"];

/// 校验展示用原始文件名：非空、长度受限、且不得包含路径分隔符或上级目录片段。
pub fn validate_original_name(name: &str) -> Result<String, ApiError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(ApiError::bad_request("文件名不能为空"));
    }
    if trimmed.chars().count() > 255 {
        return Err(ApiError::bad_request("文件名过长"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(ApiError::bad_request("文件名不得包含路径分隔符或路径回溯"));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(ApiError::bad_request("文件名包含非法控制字符"));
    }
    Ok(trimmed.to_string())
}

/// 取小写扩展名并校验白名单。
pub fn extension_of(name: &str) -> Result<String, ApiError> {
    let ext = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(ApiError::bad_request(format!(
            "不支持的文件类型：.{ext}；允许：{}",
            ALLOWED_EXTENSIONS.join("、")
        )));
    }
    Ok(ext)
}

/// 服务端生成的落盘文件名：随机十六进制 + 白名单扩展名。绝不使用用户提供的名称。
pub fn new_stored_name(ext: &str) -> String {
    format!("{}.{}", crate::util::random_hex(16), ext)
}

/// 依据扩展名映射内容类型（忽略客户端上报值，避免伪造）。
pub fn content_type_for(ext: &str) -> &'static str {
    match ext {
        "pdf" => "application/pdf",
        "txt" => "text/plain; charset=utf-8",
        "md" => "text/markdown; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// 课题上传目录：`<uploads>/<subject_id>/`。
pub fn subject_dir(uploads_dir: &Path, subject_id: i64) -> PathBuf {
    uploads_dir.join(subject_id.to_string())
}

/// 确保课题上传目录存在。
pub fn ensure_subject_dir(uploads_dir: &Path, subject_id: i64) -> std::io::Result<PathBuf> {
    let dir = subject_dir(uploads_dir, subject_id);
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
