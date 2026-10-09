mod agent;
mod auth;
mod case;
mod config;
mod db;
mod error;
mod logging;
mod models;
mod routes;
mod state;
mod storage;
mod tools;
mod util;

use std::net::SocketAddr;

use config::AppConfig;
use state::AppState;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let config = AppConfig::from_env();
    let port = config.port;
    let state = AppState::open(config).await?;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    state.logger.info(
        "server.started",
        "Fieldnote API 已启动",
        serde_json::json!({ "address": address.to_string() }),
    );
    println!("Fieldnote API listening at http://{address}");
    axum::serve(listener, routes::router(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::Arc;

    use axum::{
        body::Body,
        http::{header, Method, Request, StatusCode},
        Router,
    };
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::{
        agent::{default_agent_permissions, run_a3s_probe, FIXTURE_RECOMMENDATION},
        case::push_event,
    };

    const BOUNDARY: &str = "FIELDNOTE-TEST-BOUNDARY-0001";

    struct TestApp {
        _dir: tempfile::TempDir,
        state: Arc<AppState>,
        app: Router,
    }

    impl TestApp {
        async fn new() -> Self {
            Self::with_max_upload(20 * 1024 * 1024).await
        }

        async fn with_max_upload(max_upload_bytes: usize) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let mut config = AppConfig::for_root(dir.path().to_path_buf());
            config.max_upload_bytes = max_upload_bytes;
            let state = AppState::open(config).await.unwrap();
            let app = routes::router(state.clone());
            Self {
                _dir: dir,
                state,
                app,
            }
        }
    }

    async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 8 * 1024 * 1024)
            .await
            .unwrap();
        let value = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or(Value::Null)
        };
        (status, value)
    }

    fn json_req(method: Method, uri: &str, token: Option<&str>, body: Value) -> Request<Body> {
        let mut builder = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        builder.body(Body::from(body.to_string())).unwrap()
    }

    fn multipart_req(uri: &str, token: &str, file_name: &str, content: &[u8]) -> Request<Body> {
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(content);
        body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
        Request::builder()
            .method(Method::POST)
            .uri(uri)
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::from(body))
            .unwrap()
    }

    async fn register(app: &Router, email: &str, password: &str) -> String {
        let request = json_req(
            Method::POST,
            "/api/auth/register",
            None,
            json!({ "email": email, "display_name": "测试用户", "password": password }),
        );
        let (status, value) = send(app, request).await;
        assert_eq!(status, StatusCode::CREATED, "注册失败：{value}");
        value["token"].as_str().unwrap().to_string()
    }

    async fn create_subject(app: &Router, token: &str, name: &str) -> i64 {
        let request = json_req(
            Method::POST,
            "/api/subjects",
            Some(token),
            json!({ "name": name, "field": "蛋白质工程", "description": "演示课题" }),
        );
        let (status, value) = send(app, request).await;
        assert_eq!(status, StatusCode::CREATED, "创建课题失败：{value}");
        value["id"].as_i64().unwrap()
    }

    async fn create_conversation(app: &Router, token: &str, subject_id: i64) -> i64 {
        let request = json_req(
            Method::POST,
            "/api/conversations",
            Some(token),
            json!({ "subject_id": subject_id, "mode": "quick" }),
        );
        let (status, value) = send(app, request).await;
        assert_eq!(status, StatusCode::CREATED, "创建对话失败：{value}");
        value["id"].as_i64().unwrap()
    }

    // -----------------------------------------------------------------------
    // 迁移
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn migrations_apply_once_and_are_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        let state = AppState::open(AppConfig::for_root(root.clone())).await.unwrap();
        let expected = db::migration_count() as i64;
        assert!(expected >= 1);
        assert_eq!(state.db.schema_version().unwrap(), expected);
        drop(state);

        let reopened = AppState::open(AppConfig::for_root(root)).await.unwrap();
        assert_eq!(reopened.db.schema_version().unwrap(), expected);
        // 第二次启动不应再应用任何迁移。
        assert_eq!(reopened.db.migrate().unwrap(), 0);
    }

    // -----------------------------------------------------------------------
    // 认证
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn register_login_me_and_logout_flow() {
        let test = TestApp::new().await;
        let token = register(&test.app, "Alice@Example.com", "password123").await;

        // /me 使用注册返回的令牌可用。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/auth/me", Some(&token), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["email"], "alice@example.com");

        // 无令牌 401。
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, "/api/auth/me", None, Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // 重复邮箱注册冲突。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/auth/register",
                None,
                json!({ "email": "alice@example.com", "display_name": "重复", "password": "password123" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT);

        // 错误密码登录失败。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/auth/login",
                None,
                json!({ "email": "alice@example.com", "password": "wrong-password" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // 正确密码登录成功。
        let (status, value) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/auth/login",
                None,
                json!({ "email": "alice@example.com", "password": "password123" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let login_token = value["token"].as_str().unwrap().to_string();

        // 注销后令牌失效。
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, "/api/auth/logout", Some(&login_token), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, "/api/auth/me", Some(&login_token), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        // 注册时的令牌仍独立有效。
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, "/api/auth/me", Some(&token), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn invalid_registration_is_rejected() {
        let test = TestApp::new().await;
        // 密码过短。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/auth/register",
                None,
                json!({ "email": "bob@example.com", "display_name": "Bob", "password": "short" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // 邮箱格式不正确。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/auth/register",
                None,
                json!({ "email": "not-an-email", "display_name": "Bob", "password": "password123" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    // -----------------------------------------------------------------------
    // 归属隔离
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn subjects_are_isolated_by_owner() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let bob = register(&test.app, "bob@example.com", "password123").await;

        let subject_id = create_subject(&test.app, &alice, "AmeR 定向进化").await;

        // Alice 列表可见，Bob 列表为空。
        let (_, value) = send(
            &test.app,
            json_req(Method::GET, "/api/subjects", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(value.as_array().unwrap().len(), 1);

        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/subjects", Some(&bob), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value.as_array().unwrap().is_empty());

        // Bob 读取/修改/删除 Alice 的课题一律 404。
        let uri = format!("/api/subjects/{subject_id}");
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, &uri, Some(&bob), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, _) = send(
            &test.app,
            json_req(
                Method::PATCH,
                &uri,
                Some(&bob),
                json!({ "name": "越权修改", "field": "", "description": "" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        let (status, _) = send(
            &test.app,
            json_req(Method::DELETE, &uri, Some(&bob), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // Alice 可正常读取。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, &uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["name"], "AmeR 定向进化");
    }

    #[tokio::test]
    async fn unauthenticated_subject_access_is_rejected() {
        let test = TestApp::new().await;
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, "/api/subjects", None, Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    // -----------------------------------------------------------------------
    // 上传
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn upload_stores_file_with_hash_and_isolated_name() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "知识库课题").await;

        let content = b"# AmeR notes\r\nsimulated content".to_vec();
        let uri = format!("/api/subjects/{subject_id}/documents");
        let (status, value) = send(
            &test.app,
            multipart_req(&uri, &alice, "notes.md", &content),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "上传失败：{value}");
        assert_eq!(value["original_name"], "notes.md");
        assert_eq!(value["byte_size"], content.len() as i64);
        assert_eq!(value["sha256"], util::sha256_hex(&content));

        // 磁盘文件名由服务端生成，且确实存在。
        let document_id = value["id"].as_i64().unwrap();
        let stored_name: String = test
            .state
            .db
            .with(|conn| {
                conn.query_row(
                    "SELECT stored_name FROM documents WHERE id = ?1",
                    rusqlite::params![document_id],
                    |row| row.get(0),
                )
            })
            .unwrap();
        assert!(!stored_name.contains("notes"));
        let path = storage::subject_dir(&test.state.config.uploads_dir, subject_id).join(&stored_name);
        let stored = tokio::fs::read(&path).await.unwrap();
        assert_eq!(stored, content);
    }

    #[tokio::test]
    async fn upload_rejects_bad_extension_and_path_traversal() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "知识库课题").await;
        let uri = format!("/api/subjects/{subject_id}/documents");

        // 非白名单扩展名。
        let (status, _) = send(
            &test.app,
            multipart_req(&uri, &alice, "payload.exe", b"binary"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // 路径穿越文件名。
        let (status, _) = send(
            &test.app,
            multipart_req(&uri, &alice, "../escape.md", b"escape"),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn upload_rejects_oversized_payload() {
        let test = TestApp::with_max_upload(64 * 1024).await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "大文件课题").await;
        let uri = format!("/api/subjects/{subject_id}/documents");

        let big = vec![b'a'; 128 * 1024];
        let (status, _) = send(&test.app, multipart_req(&uri, &alice, "big.txt", &big)).await;
        assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    }

    // -----------------------------------------------------------------------
    // 备份
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn backup_requires_auth_and_can_be_reopened() {
        let test = TestApp::new().await;

        // 未认证 401。
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, "/api/admin/backup", None, Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);

        let token = register(&test.app, "alice@example.com", "password123").await;
        let (status, value) = send(
            &test.app,
            json_req(Method::POST, "/api/admin/backup", Some(&token), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "备份失败：{value}");
        let file = value["file"].as_str().unwrap().to_string();
        assert!(file.starts_with("backups/"));

        let path = test.state.config.data_dir.join(&file);
        let bytes = tokio::fs::read(&path).await.unwrap();
        assert_eq!(value["sha256"], util::sha256_hex(&bytes));
        assert_eq!(value["byte_size"], bytes.len() as u64);

        // 用备份文件重新打开，schema 与数据一致。
        let reopened = db::Db::open(&path).unwrap();
        assert_eq!(reopened.schema_version().unwrap(), db::migration_count() as i64);
        let users: i64 = reopened
            .with(|conn| conn.query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0)))
            .unwrap();
        assert_eq!(users, 1);
    }

    // -----------------------------------------------------------------------
    // 既有阶段 A 行为回归
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn case_progress_persists_and_resumes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let state = AppState::open(AppConfig::for_root(root.clone())).await.unwrap();
        {
            let mut progress = state.case.lock().await;
            progress.completed.push(0);
            progress.current_stage = 1;
            push_event(&mut progress, "stage.completed", "阶段已完成", "问题定义", Some(0));
            state.persist_case(&progress).await.unwrap();
        }

        let reopened = AppState::open(AppConfig::for_root(root)).await.unwrap();
        let progress = reopened.case.lock().await;
        assert_eq!(progress.current_stage, 1);
        assert_eq!(progress.completed, vec![0]);
        assert!(progress
            .events
            .iter()
            .any(|event| event.kind == "stage.completed"));
    }

    #[tokio::test]
    async fn a3s_session_calls_local_fixture_and_emits_stream_events() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("agent-workspace");
        tokio::fs::create_dir_all(&workspace).await.unwrap();
        let probe = run_a3s_probe(&workspace).await.unwrap();
        assert_eq!(probe.runtime, "A3S Code Core");
        assert_eq!(probe.version, "9.1.1");
        assert!(!probe.events.is_empty());
        assert!(probe.events.contains(&"text_delta".to_string()));
        assert!(probe.events.contains(&"agent_end".to_string()));
        assert_eq!(probe.output, FIXTURE_RECOMMENDATION);
        assert!(probe.fixture_calls >= 1);
        assert!(probe.model_source.contains("非 AI 推理"));
        assert_eq!(probe.tool_requests, 0);
        assert_eq!(probe.tool_executions, 0);
        assert!(!probe.network_used);
    }

    #[test]
    fn agent_policy_denies_unlisted_tools() {
        let policy = default_agent_permissions();
        for tool in ["shell", "write_file", "web_search", "hardware_control"] {
            assert_eq!(
                policy.check(tool, &json!({})),
                a3s_code_core::permissions::PermissionDecision::Deny,
                "{tool} 应被默认策略拒绝"
            );
        }
    }

    // -----------------------------------------------------------------------
    // 阶段 E：对话与课题空间
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn conversation_flow_persists_messages_and_simulated_reply() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "AmeR 定向进化").await;
        let conversation_id = create_conversation(&test.app, &alice, subject_id).await;

        // 发送消息 → 返回用户消息与本地模拟回复。
        let uri = format!("/api/conversations/{conversation_id}/messages");
        let (status, value) = send(
            &test.app,
            json_req(
                Method::POST,
                &uri,
                Some(&alice),
                json!({ "content": "请给出 AmeR 定向进化的下一步建议" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "发送消息失败：{value}");
        assert_eq!(value["user_message"]["role"], "user");
        assert_eq!(value["assistant_message"]["role"], "assistant");
        assert!(value["assistant_message"]["content"]
            .as_str()
            .unwrap()
            .contains("模拟"));
        assert_eq!(value["meta"]["simulated"], true);
        assert_eq!(value["meta"]["network_used"], false);
        assert_eq!(value["meta"]["tool_executions"], 0);
        assert_eq!(value["title"], "请给出 AmeR 定向进化的下一步建议");

        // 会话详情：两条消息，顺序正确。
        let detail_uri = format!("/api/conversations/{conversation_id}");
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, &detail_uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["subject_name"], "AmeR 定向进化");
        let messages = value["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "user");
        assert_eq!(messages[1]["role"], "assistant");

        // 会话列表：含消息数与课题名。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/conversations", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let list = value.as_array().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["message_count"], 2);
        assert_eq!(list[0]["subject_name"], "AmeR 定向进化");

        // 用量摘要：对话 1 / 消息 2 / 运行 1 / 课题 1。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/workspace/summary", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["subjects"], 1);
        assert_eq!(value["conversations"], 1);
        assert_eq!(value["messages"], 2);
        assert_eq!(value["runs"], 1);
        assert_eq!(value["documents"], 0);

        // 删除会话级联删除消息。
        let (status, _) = send(
            &test.app,
            json_req(Method::DELETE, &detail_uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, &detail_uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn conversations_are_isolated_and_validated() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let bob = register(&test.app, "bob@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "AmeR 定向进化").await;
        let conversation_id = create_conversation(&test.app, &alice, subject_id).await;

        // Bob 不能读取 Alice 的会话。
        let uri = format!("/api/conversations/{conversation_id}");
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, &uri, Some(&bob), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // Bob 不能向 Alice 的会话发消息。
        let message_uri = format!("/api/conversations/{conversation_id}/messages");
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &message_uri, Some(&bob), json!({ "content": "越权" })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // 也不能为 Alice 的课题创建会话。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/conversations",
                Some(&bob),
                json!({ "subject_id": subject_id }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // 空消息 400。
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &message_uri, Some(&alice), json!({ "content": "   " })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // 超长消息 400。
        let long = "字".repeat(4001);
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &message_uri, Some(&alice), json!({ "content": long })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // 非法 mode 400。
        let (status, _) = send(
            &test.app,
            json_req(
                Method::POST,
                "/api/conversations",
                Some(&alice),
                json!({ "subject_id": subject_id, "mode": "turbo" }),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // 未认证 401。
        let (status, _) = send(
            &test.app,
            json_req(Method::GET, "/api/conversations", None, Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn tool_catalog_and_subject_association() {
        let test = TestApp::new().await;
        let alice = register(&test.app, "alice@example.com", "password123").await;
        let bob = register(&test.app, "bob@example.com", "password123").await;
        let subject_id = create_subject(&test.app, &alice, "工具课题").await;

        // 目录只读且可筛选。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/tools", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        let total = value["total"].as_i64().unwrap();
        assert!(total >= 10);
        assert!(value["items"].as_array().unwrap().iter().all(|item| item["simulated"] == true));

        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/tools?kind=skill", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert!(value["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["kind"] == "skill"));

        let (status, value) = send(
            &test.app,
            json_req(Method::GET, "/api/tools?q=对接", Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value["total"], 1);

        // 关联工具（幂等）。
        let uri = format!("/api/subjects/{subject_id}/tools");
        let (status, value) = send(
            &test.app,
            json_req(Method::POST, &uri, Some(&alice), json!({ "tool_id": "skill-structure-fold" })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "关联工具失败：{value}");
        assert_eq!(value["tool_id"], "skill-structure-fold");

        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &uri, Some(&alice), json!({ "tool_id": "skill-structure-fold" })),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        // 列表包含关联项。
        let (status, value) = send(
            &test.app,
            json_req(Method::GET, &uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(value.as_array().unwrap().len(), 1);

        // 未知工具 400。
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &uri, Some(&alice), json!({ "tool_id": "no-such-tool" })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);

        // Bob 不能在 Alice 的课题上关联工具。
        let (status, _) = send(
            &test.app,
            json_req(Method::POST, &uri, Some(&bob), json!({ "tool_id": "skill-structure-fold" })),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);

        // 解除关联。
        let remove_uri = format!("/api/subjects/{subject_id}/tools/skill-structure-fold");
        let (status, _) = send(
            &test.app,
            json_req(Method::DELETE, &remove_uri, Some(&alice), Value::Null),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        let (_, value) = send(
            &test.app,
            json_req(Method::GET, &uri, Some(&alice), Value::Null),
        )
        .await;
        assert!(value.as_array().unwrap().is_empty());
    }
}
