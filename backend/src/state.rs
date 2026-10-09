use std::{io, sync::Arc};

use serde_json::json;
use tokio::sync::Mutex;

use crate::{
    case::CaseProgress,
    config::AppConfig,
    db::Db,
    logging::Logger,
    util::now,
};

/// 进程级共享状态。
pub struct AppState {
    pub config: AppConfig,
    pub db: Db,
    pub logger: Logger,
    /// 阶段 A 演示案例进度（本地 JSON 持久化，保持不变）。
    pub case: Mutex<CaseProgress>,
}

impl AppState {
    pub async fn open(config: AppConfig) -> io::Result<Arc<Self>> {
        for dir in [
            &config.data_dir,
            &config.uploads_dir,
            &config.backups_dir,
            &config.logs_dir,
            &config.agent_workspace,
        ] {
            tokio::fs::create_dir_all(dir).await?;
        }

        let logger = Logger::new(config.logs_dir.join("app.log"));
        let db = Db::open(&config.db_path).map_err(io::Error::other)?;
        let applied = db.migrate().map_err(io::Error::other)?;
        if applied > 0 {
            logger.info(
                "migration.applied",
                "数据库迁移已应用",
                json!({ "applied": applied, "schema_version": db.schema_version().unwrap_or(-1) }),
            );
        }

        let progress = match tokio::fs::read(&config.case_progress_path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => CaseProgress::default(),
            Err(error) => return Err(error),
        };

        let state = Arc::new(Self {
            config,
            db,
            logger,
            case: Mutex::new(progress),
        });
        {
            let progress = state.case.lock().await;
            state.persist_case(&progress).await?;
        }
        Ok(state)
    }

    pub async fn persist_case(&self, progress: &CaseProgress) -> io::Result<()> {
        let bytes = serde_json::to_vec_pretty(progress)?;
        tokio::fs::write(&self.config.case_progress_path, bytes).await
    }

    /// 记录结构化审计事件：写入 `audit_events` 表并输出 JSON 日志（尽力而为，不阻断请求）。
    pub fn audit(
        &self,
        actor_id: Option<i64>,
        action: &str,
        target: &str,
        outcome: &str,
        detail: serde_json::Value,
    ) {
        let detail_json = detail.to_string();
        let result = self.db.with(|conn| {
            conn.execute(
                "INSERT INTO audit_events (at, actor_id, action, target, outcome, detail_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![now(), actor_id, action, target, outcome, detail_json],
            )?;
            Ok(())
        });
        let fields = json!({
            "actor_id": actor_id,
            "action": action,
            "target": target,
            "outcome": outcome,
            "detail": detail,
        });
        match result {
            Ok(()) => self.logger.info(action, "审计事件已记录", fields),
            Err(error) => self
                .logger
                .error("audit.failed", &format!("审计写入失败：{error}"), fields),
        }
    }
}
