# 阶段 C 验收报告：产品基础设施

- 日期：2026-10-01
- 对应规格：[stage-c-infrastructure.md](../.trae/specs/build-a3s-science-workbench/stage-c-infrastructure.md)（roadmap §3 阶段 C）
- 实施目录：`E:\isaac_sim\elite_robot_arm_0922\vla_launch\.tmp_jixiaxueshe_worktree`
- 结论：**通过（本地验收）**。后端 12/12 测试通过、构建零警告；前端 `tsc + vite build` 通过；认证、资源隔离、上传边界、备份与结构化日志均已实测。

> 说明：本阶段仅覆盖**本地单机**可持久化、可迁移、可备份、带最小认证与资源归属的基础设施。**未**接入真实模型/密钥/费用（阶段 D）、**未**部署内测（阶段 I）、**未**发布公网（阶段 J）；这些需另行授权。

## 1. 交付物

后端由阶段 A/B 的单文件演示结构收敛为模块化架构（`backend/src/`）：

| 模块 | 职责 |
|---|---|
| [config.rs](../backend/src/config.rs) | 运行时配置（数据根目录/端口/上传上限/会话时长，环境变量覆盖） |
| [error.rs](../backend/src/error.rs) | 统一 `ApiError`，构造器与 `From` 转换，JSON 错误体 `{ "error": string }` |
| [logging.rs](../backend/src/logging.rs) | 单行 JSON 结构化日志 → stderr 与 `<data>/logs/app.log` |
| [util.rs](../backend/src/util.rs) | 时间戳、SHA-256、随机十六进制 |
| [models.rs](../backend/src/models.rs) | 用户/课题/文档/对话/消息/运行/证据数据模型 |
| [db.rs](../backend/src/db.rs) | SQLite 连接、版本化迁移、`VACUUM INTO` 备份 |
| [auth.rs](../backend/src/auth.rs) | Argon2id 口令哈希、会话令牌、当前用户解析 |
| [storage.rs](../backend/src/storage.rs) | 扩展名白名单、文件名校验、随机落盘名、课题分目录 |
| [state.rs](../backend/src/state.rs) | `AppState`（配置/数据库/日志/案例进度）与审计写入 |
| [case.rs](../backend/src/case.rs) / [agent.rs](../backend/src/agent.rs) | 既有阶段 A/B 案例与 A3S 探针逻辑（行为不变） |
| [routes/](../backend/src/routes/) | `mod.rs`（路由与体积上限）、`auth.rs`、`subjects.rs`、`case.rs`、`agent.rs`、`admin.rs` |
| [main.rs](../backend/src/main.rs) | 引导 + 阶段 C 测试套件（12 用例） |

## 2. 数据模型与迁移

- SQLite 为事实来源，`PRAGMA foreign_keys = ON`，WAL 日志模式；时间戳统一 Unix 秒（`INTEGER`）。
- 迁移以有序列表定义，`PRAGMA user_version` 记录已应用版本，单条迁移在事务内执行、幂等。
- 首版迁移 `001_initial` 建表：`users`、`sessions`、`subjects`、`documents`、`conversations`、`messages`、`runs`、`evidence`、`audit_events`；为后续阶段预留 `002+`。

实测（首次启动全新目录）：

```json
{"event":"migration.applied","fields":{"applied":1,"schema_version":1},"level":"info","msg":"数据库迁移已应用","ts":1790826747}
```

测试 `migrations_apply_once_and_are_idempotent` 断言：重复启动不重复建表，`user_version` 与迁移条数一致。

## 3. 接口契约（本地回环 `127.0.0.1:8081`）

除 `health`、`auth/register`、`auth/login` 外，其余接口需 `Authorization: Bearer <token>`。

| 方法 | 路径 | 实测 |
|---|---|---|
| GET | `/api/health` | 200（保持不变） |
| POST | `/api/auth/register` | 201，返回令牌与用户 |
| POST | `/api/auth/login` | 200 / 错误口令 401 |
| POST | `/api/auth/logout` | 200（吊销当前会话） |
| GET | `/api/auth/me` | 200；无令牌 401 |
| GET/POST | `/api/subjects` | 200 / 201 |
| GET/PATCH/DELETE | `/api/subjects/{id}` | 仅所有者；越权 404 |
| GET/POST | `/api/subjects/{id}/documents` | 列表 / multipart 上传 |
| GET/DELETE | `/api/documents/{id}` | 元数据 / 删除 |
| GET | `/api/documents/{id}/content` | 下载原文 |
| GET | `/api/runs` | 当前用户运行记录（只读） |
| POST | `/api/admin/backup` | 201，返回 `file`/`byte_size`/`sha256`/`created_at` |

既有 `/api/case`、`/api/events`、`/api/case/advance`、`/api/case/reset`、`/api/agent/probe` 保持原路径与响应结构（回归测试通过）。

## 4. 安全边界实现

1. **绑定**：仅 `127.0.0.1:8081`（`SocketAddr::from(([127,0,0,1], port))`），无 `0.0.0.0`。
2. **口令**：Argon2id + 每用户随机盐；错误信息不区分“邮箱不存在/口令错误”，审计记为 `bad_password`。
3. **会话令牌**：32 字节 CSPRNG，仅存 SHA-256 摘要；支持过期与注销。
4. **授权**：资源访问先校验 `owner_id == 当前用户`，越权一律 404（不泄露存在性）。
5. **上传隔离**：扩展名白名单（pdf/txt/md/csv/json）；单文件上限默认 20 MiB（超限 413）；原始名仅作展示，落盘用服务端随机名；目录 `<data>/uploads/<subject_id>/`；拒绝含 `/`、`\`、`..` 的文件名；入库记录 SHA-256。响应**不**回传 `stored_name`（服务端名不外泄）。
6. **审计**：注册、登录成功/失败、课题增删改、文档上传/删除、备份写入 `audit_events` 并输出结构化日志。

实测（`curl.exe`，UTF-8 准确）：

```
CREATE id=2 name=蛋白质定向进化 field=生命科学 desc=酶热稳定性改造
UPLOAD id=1 byte_size=51 sha256=e8b6c80dfa0145ea...
DOWNLOAD 200，正文与上传一致
BADEXT  (上传 a.exe)            -> 400
TRAVERSAL (filename=../../etc/passwd.md) -> 400
BOB-READ-CAROL (越权读他人课题) -> 404
未认证访问 /api/subjects        -> 401
错误口令登录                    -> 401
```

落盘校验：

```
data/uploads/2/d52bee6901f0989ca9686343fbbc53a5.md   ← 随机名 + 课题分目录
```

## 5. 备份与恢复

- `POST /api/admin/backup` 用 `VACUUM INTO` 生成一致性快照 → `<data>/backups/backup-<时间戳>.db`，返回相对路径与 SHA-256；同秒重复触发以后缀避让。
- 测试 `backup_requires_auth_and_can_be_reopened`：先拒匿名（401），用返回的备份文件重新打开并断言数据一致。

实测：

```
BACKUP file=backups/backup-1790826767.db byte_size=110592 sha256=431db43cf52d...
```

## 6. 结构化日志

单行 JSON：`{"ts":..,"level":..,"event":..,"msg":..,"fields":{..}}`，输出到 stderr 并追加到 `<data>/logs/app.log`。关键事件实测样本：

```json
{"event":"auth.login","fields":{"action":"auth.login","actor_id":1,"detail":{"reason":"bad_password"},"outcome":"failure","target":"alice@lab.test"},"level":"info","msg":"审计事件已记录","ts":1790826767}
{"event":"subject.created","fields":{"action":"subject.created","actor_id":3,"detail":{"subject_id":2},"outcome":"success","target":"蛋白质定向进化"},"level":"info","msg":"审计事件已记录","ts":1790826807}
{"event":"document.uploaded","fields":{"action":"document.uploaded","actor_id":3,"detail":{"byte_size":51,"document_id":1,"sha256":"e8b6c80dfa0145ea...","subject_id":2},"outcome":"success","target":"fieldnote-note.md"},"level":"info","msg":"审计事件已记录","ts":1790826807}
```

## 7. 测试与构建验证

### 后端单元/集成测试（12/12 通过，零警告）

```
running 12 tests
test tests::migrations_apply_once_and_are_idempotent ... ok
test tests::register_login_me_and_logout_flow ... ok
test tests::invalid_registration_is_rejected ... ok
test tests::subjects_are_isolated_by_owner ... ok
test tests::unauthenticated_subject_access_is_rejected ... ok
test tests::upload_stores_file_with_hash_and_isolated_name ... ok
test tests::upload_rejects_bad_extension_and_path_traversal ... ok
test tests::upload_rejects_oversized_payload ... ok
test tests::backup_requires_auth_and_can_be_reopened ... ok
test tests::case_progress_persists_and_resumes ... ok
test tests::a3s_session_calls_local_fixture_and_emits_stream_events ... ok
test tests::agent_policy_denies_unlisted_tools ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- 命令：`cargo test --config "<rsproxy 镜像配置>"`
- 测试用 `tower::ServiceExt::oneshot` 直连 `Router`（`tempfile` 隔离数据目录），无需真实端口。

### 构建

- 后端：`cargo build` → `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 11.18s`（无警告）。
- 前端：`npm run build`（`tsc --noEmit && vite build`）→

```
✓ 48 modules transformed.
dist/index.html                   0.59 kB │ gzip:  0.39 kB
dist/assets/index-hAweNItJ.css   49.77 kB │ gzip: 11.80 kB
dist/assets/index-X2gPaZhy.js   274.03 kB │ gzip: 86.56 kB
✓ built in 1.10s
```

## 8. 本地运行

- 后端：`cargo run`（默认 `127.0.0.1:8081`）；数据根目录由 `FIELDNOTE_DATA_DIR` 指定，默认进程工作目录下的 `data/`。
- 前端：`127.0.0.1:5175`（见 `.trae/rules/本地开发端口规范.md`）。
- 一律只绑回环；远程访问只走 SSH 隧道。

## 9. 模拟 / 未实现清单（明确边界）

- **模拟**：`/api/health` 标注 `"data":"simulated"`；案例推进与 A3S 探针仍走本地 fixture，不调用真实模型。
- **未实现（留待后续阶段）**：真实模型提供方与密钥（D）、对话/课题空间前端闭环（E）、论文工具进阶与目录类模块（F）、应用/计算/模型（G）、帮助与账号（H）、内测部署（I）、公网发布（J）。
- `conversations`/`messages`/`runs`/`evidence` 本阶段仅建表与只读归属校验，写入接口留待阶段 E。

## 10. 需授权事项（已停止，未执行）

以下均**未**执行，需用户明确授权后再单独立项：

- 阶段 D：接入真实模型提供方、托管密钥、可能产生费用。
- 阶段 I：内测/容器部署（非实验室环境）。
- 阶段 J：公网发布、域名/TLS、身份体系与费用。
- 任何实验室服务器与真机/Omega 主手的连接或控制。

## 11. 复核要点与已知限制

1. 审计日志中的 `subject.created/target` 在**用 Windows PowerShell 5.1 的 `Invoke-RestMethod` 发送中文 JSON 时**会显示为 `???????`；这是客户端默认编码问题，**非服务端缺陷**——改用 `curl.exe --data-binary`（UTF-8）后同一接口正确落库并显示“蛋白质定向进化”。
2. 单文件上传的精确大小上限由处理器校验（超限 413）；传输层 `DefaultBodyLimit` 设为 `上限 + 1 MiB` 以容纳 multipart 边界与头部，避免小文件被误判。
3. `stored_name` 属服务端内部字段，接口不回传，便于后续防枚举。
