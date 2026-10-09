use serde::{Deserialize, Serialize};

/// 用户公开信息（不包含密码哈希）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub created_at: i64,
}

impl User {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            email: row.get("email")?,
            display_name: row.get("display_name")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// 课题。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Subject {
    pub id: i64,
    pub owner_id: i64,
    pub name: String,
    pub field: String,
    pub description: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Subject {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            owner_id: row.get("owner_id")?,
            name: row.get("name")?,
            field: row.get("field")?,
            description: row.get("description")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// 课题创建/更新请求体。
#[derive(Clone, Debug, Deserialize)]
pub struct SubjectInput {
    pub name: String,
    #[serde(default)]
    pub field: String,
    #[serde(default)]
    pub description: String,
}

/// 课题知识库文档元数据。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: i64,
    pub subject_id: i64,
    pub owner_id: i64,
    pub original_name: String,
    pub byte_size: i64,
    pub sha256: String,
    pub content_type: String,
    pub created_at: i64,
}

impl Document {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            subject_id: row.get("subject_id")?,
            owner_id: row.get("owner_id")?,
            original_name: row.get("original_name")?,
            byte_size: row.get("byte_size")?,
            sha256: row.get("sha256")?,
            content_type: row.get("content_type")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// 运行记录（阶段 C 仅建表与只读列表，写入接口留待阶段 E）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunRecord {
    pub id: i64,
    pub subject_id: Option<i64>,
    pub owner_id: i64,
    pub kind: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RunRecord {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            subject_id: row.get("subject_id")?,
            owner_id: row.get("owner_id")?,
            kind: row.get("kind")?,
            status: row.get("status")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// 对话会话（阶段 E 使用）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Conversation {
    pub id: i64,
    pub subject_id: i64,
    pub owner_id: i64,
    pub title: String,
    pub mode: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Conversation {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            subject_id: row.get("subject_id")?,
            owner_id: row.get("owner_id")?,
            title: row.get("title")?,
            mode: row.get("mode")?,
            model: row.get("model")?,
            created_at: row.get("created_at")?,
            updated_at: row.get("updated_at")?,
        })
    }
}

/// 对话消息（阶段 E 使用）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

impl MessageRecord {
    pub fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get("id")?,
            conversation_id: row.get("conversation_id")?,
            role: row.get("role")?,
            content: row.get("content")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// 证据条目（阶段 E 使用）。
#[allow(dead_code)]
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Evidence {
    pub id: i64,
    pub run_id: Option<i64>,
    pub subject_id: Option<i64>,
    pub kind: String,
    pub label: String,
    pub detail: String,
    pub created_at: i64,
}
