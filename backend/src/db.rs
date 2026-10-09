use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use rusqlite::Connection;

/// 有序迁移列表。索引 + 1 即目标 `PRAGMA user_version`；只允许追加，不得修改已发布条目。
const MIGRATIONS: &[&str] = &[
    // 001_initial：用户 / 会话 / 课题 / 文档 / 对话 / 消息 / 运行 / 证据 / 审计
    r#"
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE subjects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    field       TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_subjects_owner ON subjects(owner_id);

CREATE TABLE documents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id    INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT    NOT NULL,
    stored_name   TEXT    NOT NULL UNIQUE,
    byte_size     INTEGER NOT NULL,
    sha256        TEXT    NOT NULL,
    content_type  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE INDEX idx_documents_subject ON documents(subject_id);
CREATE INDEX idx_documents_owner ON documents(owner_id);

CREATE TABLE conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_conversations_subject ON conversations(subject_id);

CREATE TABLE messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);

CREATE TABLE runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id  INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    input_json  TEXT    NOT NULL DEFAULT '{}',
    output_json TEXT    NOT NULL DEFAULT '{}',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_runs_owner ON runs(owner_id);
CREATE INDEX idx_runs_subject ON runs(subject_id);

CREATE TABLE evidence (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id     INTEGER REFERENCES runs(id) ON DELETE CASCADE,
    subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
    kind       TEXT    NOT NULL,
    label      TEXT    NOT NULL,
    detail     TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_evidence_run ON evidence(run_id);

CREATE TABLE audit_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    at          INTEGER NOT NULL,
    actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      TEXT    NOT NULL,
    target      TEXT    NOT NULL DEFAULT '',
    outcome     TEXT    NOT NULL,
    detail_json TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_actor ON audit_events(actor_id);
CREATE INDEX idx_audit_action ON audit_events(action);
"#,
    // 002_conversation_loop：对话活动时间 / 模式 / 模型 + 课题工具关联（仅追加列与新增表）
    r#"
ALTER TABLE conversations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'quick';
ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE subject_tools (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    tool_id    TEXT    NOT NULL,
    added_at   INTEGER NOT NULL,
    UNIQUE(subject_id, tool_id)
);
CREATE INDEX idx_subject_tools_subject ON subject_tools(subject_id);
"#,
];

/// SQLite 连接封装。所有访问通过内部互斥锁串行化；仅用于同步操作，调用方不得在持锁期间 await。
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        // WAL 提升本地并发读性能；返回值忽略。
        let _ = conn.query_row("PRAGMA journal_mode=WAL", [], |row| row.get::<_, String>(0));
        let db = Self {
            conn: Mutex::new(conn),
        };
        Ok(db)
    }

    /// 应用尚未执行的迁移，返回本次应用的迁移条数。
    pub fn migrate(&self) -> rusqlite::Result<usize> {
        let mut conn = self.lock();
        let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let mut applied = 0usize;
        for (index, sql) in MIGRATIONS.iter().enumerate() {
            let target = (index + 1) as i64;
            if target <= current {
                continue;
            }
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", target)?;
            tx.commit()?;
            applied += 1;
        }
        Ok(applied)
    }

    pub fn schema_version(&self) -> rusqlite::Result<i64> {
        let conn = self.lock();
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
    }

    /// 在持有连接锁的前提下执行一段只读/写操作。
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
        let conn = self.lock();
        f(&conn)
    }

    /// 使用 `VACUUM INTO` 生成一致性备份快照。目标文件必须不存在。
    pub fn backup_to(&self, path: &Path) -> rusqlite::Result<()> {
        let conn = self.lock();
        conn.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])?;
        Ok(())
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// 迁移条数（用于测试断言与版本校验）。
#[allow(dead_code)]
pub fn migration_count() -> usize {
    MIGRATIONS.len()
}
