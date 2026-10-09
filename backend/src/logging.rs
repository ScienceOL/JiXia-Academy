use std::{fs::OpenOptions, io::Write, path::PathBuf, sync::Arc};

use crate::util::now;

/// 极简结构化日志：每条记录为单行 JSON，输出到 stderr 并追加写入日志文件。
#[derive(Clone)]
pub struct Logger {
    path: Arc<PathBuf>,
}

impl Logger {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path: Arc::new(path),
        }
    }

    pub fn log(&self, level: &str, event: &str, msg: &str, fields: serde_json::Value) {
        let line = serde_json::json!({
            "ts": now(),
            "level": level,
            "event": event,
            "msg": msg,
            "fields": fields,
        })
        .to_string();
        eprintln!("{line}");
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.path.as_ref())
        {
            let _ = writeln!(file, "{line}");
        }
    }

    pub fn info(&self, event: &str, msg: &str, fields: serde_json::Value) {
        self.log("info", event, msg, fields);
    }

    pub fn warn(&self, event: &str, msg: &str, fields: serde_json::Value) {
        self.log("warn", event, msg, fields);
    }

    pub fn error(&self, event: &str, msg: &str, fields: serde_json::Value) {
        self.log("error", event, msg, fields);
    }
}
