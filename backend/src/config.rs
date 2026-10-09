use std::{env, path::PathBuf};

/// 运行时配置。默认数据根目录为进程工作目录；可用 `FIELDNOTE_DATA_DIR` 覆盖。
#[derive(Clone, Debug)]
pub struct AppConfig {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub uploads_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub case_progress_path: PathBuf,
    pub agent_workspace: PathBuf,
    pub port: u16,
    pub max_upload_bytes: usize,
    pub session_ttl_secs: i64,
}

const DEFAULT_PORT: u16 = 8081;
const DEFAULT_MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;
const DEFAULT_SESSION_TTL_SECS: i64 = 7 * 24 * 60 * 60;

impl AppConfig {
    pub fn from_env() -> Self {
        let root = env::var_os("FIELDNOTE_DATA_DIR")
            .map(PathBuf::from)
            .or_else(|| env::current_dir().ok())
            .unwrap_or_else(|| PathBuf::from("."));
        Self::for_root(root)
    }

    pub fn for_root(root: PathBuf) -> Self {
        let data_dir = root.join("data");
        let port = env::var("FIELDNOTE_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT);
        let max_upload_bytes = env::var("FIELDNOTE_MAX_UPLOAD_BYTES")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_MAX_UPLOAD_BYTES);
        let session_ttl_secs = env::var("FIELDNOTE_SESSION_TTL_SECS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_SESSION_TTL_SECS);

        Self {
            db_path: data_dir.join("fieldnote.db"),
            uploads_dir: data_dir.join("uploads"),
            backups_dir: data_dir.join("backups"),
            logs_dir: data_dir.join("logs"),
            case_progress_path: data_dir.join("case-progress.json"),
            agent_workspace: root.join(".runtime").join("agent-workspace"),
            data_dir,
            port,
            max_upload_bytes,
            session_ttl_secs,
        }
    }
}
