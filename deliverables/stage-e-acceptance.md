# 阶段 E 验收报告：核心闭环——对话 + 课题空间

- 日期：2026-10-01
- 对应规格：[stage-e-core-loop.md](../.trae/specs/build-a3s-science-workbench/stage-e-core-loop.md)（roadmap §3 阶段 E、tasks.md 任务 9）
- 实施目录：`E:\isaac_sim\elite_robot_arm_0922\vla_launch\.tmp_jixiaxueshe_worktree`
- 结论：**通过（本地验收）**。后端 15/15 测试通过、构建零警告；前端 `tsc --noEmit` + `vite build` 通过（67 模块）；浏览器端到端实测走通「登录 → 建课题 → 上传文件 → 工具关联 → 课题内对话 → `/chat` 发消息 → 历史与失败态」，并修复 1 个真实布局缺陷。

> 说明：本阶段仅覆盖**本地单机、模拟数据**下的中枢闭环。回复统一来自本地模板响应模型（A3S 会话 + fixture LLM 客户端），**不**接入真实模型/密钥/费用（阶段 D）、**未**部署内测（阶段 I）、**未**发布公网（阶段 J）、**未**触碰实验室服务器与真机。

## 1. 交付物

### 后端（在阶段 C 模块化结构上增量）

| 模块 | 职责 |
|---|---|
| [tools.rs](../backend/src/tools.rs) | 只读本地模拟工具目录（`skill` 4 类 + `scp` 8 类共 **12** 条，全部 `simulated: true`），含 kind/q/field/purpose/sort 过滤 |
| [routes/conversations.rs](../backend/src/routes/conversations.rs) | 会话 CRUD、发消息、用量摘要、工具目录与课题工具关联 |
| [agent.rs](../backend/src/agent.rs) | 阶段 A 的 A3S 探针逻辑保持不变；新增 fixture LLM 客户端（提示词感知的本地模板回复） |
| [db.rs](../backend/src/db.rs) | 新增迁移 `002_conversation_loop`（仅追加列与新增表） |
| [routes/mod.rs](../backend/src/routes/mod.rs) | 新增路由挂载（会话/摘要/工具/关联） |

### 前端（新增路由与两套页面）

| 文件 | 职责 |
|---|---|
| [App.tsx](../frontend/src/App.tsx) | 引入 `react-router-dom`（`BrowserRouter`）与受保护路由；按路由渲染面包屑 |
| [components/AuthGate.tsx](../frontend/src/components/AuthGate.tsx) | 登录/注册门（同一界面切换），启动用 `localStorage` 令牌校验 `/api/auth/me` |
| [pages/ChatPage.tsx](../frontend/src/pages/ChatPage.tsx) | `/chat` 首页（选题/输入/快速·深度/模型占位/附件占位/示例问题）与会话视图（消息流/加载/失败/空态/历史） |
| [pages/RepositoryPage.tsx](../frontend/src/pages/RepositoryPage.tsx) | `/repo/repository` 用量摘要 + 课题列表 + 创建课题对话框 |
| [pages/SubjectDetailPage.tsx](../frontend/src/pages/SubjectDetailPage.tsx) | `/repo/repository/:id` 知识库/工具/课题内对话/`@` 引用 |
| [store-e.ts](../frontend/src/store-e.ts) | Zustand 状态：会话、消息、课题、文档、工具目录与关联、摘要 |
| [lib/api.ts](../frontend/src/lib/api.ts) | 统一 `fetch` 封装，自动附带 `Authorization: Bearer`，401 清会话回登录门 |

## 2. 数据模型与迁移（002）

`001_initial` 已建 `conversations`/`messages`/`runs`/`evidence`。阶段 E 新增迁移 `002_conversation_loop`，**只做追加列与新增表**（不重建表）：

```sql
ALTER TABLE conversations ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN mode  TEXT NOT NULL DEFAULT 'quick';   -- quick / deep
ALTER TABLE conversations ADD COLUMN model TEXT NOT NULL DEFAULT 'auto';    -- 选择器占位值
CREATE TABLE subject_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    tool_id TEXT NOT NULL, added_at INTEGER NOT NULL,
    UNIQUE(subject_id, tool_id)
);
```

不变式：对话必须归属课题（`subject_id NOT NULL`）；删对话级联删消息，删课题级联删其对话与工具关联；资源访问先校验 `owner_id == 当前用户`，越权一律 404。

实测启动日志：

```json
{"event":"migration.applied","fields":{"applied":2,"schema_version":2},"level":"info","msg":"数据库迁移已应用","ts":1790828479}
{"event":"server.started","fields":{"address":"127.0.0.1:8081"},"level":"info","msg":"Fieldnote API 已启动","ts":1790828479}
```

## 3. 接口契约（本地回环 `127.0.0.1:8081`，前缀 `/api`，均需 Bearer 令牌）

沿用阶段 C 的错误体 `{ "error": string }`。

| 方法 | 路径 | 实测 |
|---|---|---|
| GET | `/api/workspace/summary` | 200：课题/文档/对话/消息/运行计数 + 文档总字节 |
| GET | `/api/conversations` | 200：当前用户会话列表（课题名、标题、消息数、最近活动），按 `updated_at DESC` |
| POST | `/api/conversations` | 201：`{ subject_id, title?, mode?, model? }`；课题须属当前用户 |
| GET | `/api/conversations/{id}` | 200：会话详情 + 按时间正序消息 |
| POST | `/api/conversations/{id}/messages` | 200：落库用户消息 → 本地模拟回复 → 落库助手消息 → 写入 `runs`(`a3s.chat`) 与 `evidence` |
| DELETE | `/api/conversations/{id}` | 200：级联删除消息 |
| GET | `/api/tools` | 200：只读工具目录，支持 `kind`/`q`/`field`/`purpose`/`sort`，返回 `{ total, items }` |
| GET | `/api/subjects/{id}/tools` | 200：课题已关联工具（含目录摘要） |
| POST | `/api/subjects/{id}/tools` | 201：关联工具 `{ tool_id }`（幂等，重复返回既有） |
| DELETE | `/api/subjects/{id}/tools/{tool_id}` | 200：解除关联 |

约束：消息 `content` 非空且 ≤4000 字符（超出 400）；会话 `title` 缺省取首条消息前 24 字；工具 `tool_id` 必须命中静态目录。阶段 A/B/C 既有接口路径与响应结构保持不变（回归通过）。

## 4. 回复生成（本地模拟，不访问外网）

- 复用 A3S 会话：`Agent::new(ACL)` → 受限 `SessionOptions`（默认拒绝工具）→ 注入 fixture LLM 客户端。
- fixture 客户端为**提示词感知的本地模板**：固定免责声明 + 课题/模式/知识库附件上下文 + 截断回显用户问题 + 建议路径 + 收尾句「本轮未使用网络、未执行任何工具；这是一条模拟回复。」
- 元数据（运行时、版本、fixture 调用次数、事件名）随助手消息返回并入库 `runs.output_json`，前端展示为「模拟回复」标签与运行时元数据。
- 阶段 A 的 `/api/agent/probe` 行为**保持不变**（仍返回固定 `FIXTURE_RECOMMENDATION`）。

## 5. 前端结构与交互

### 5.1 路由与导航

- 真实路由：`/chat`、`/chat/:id`、`/repo/repository`、`/repo/repository/:id`（SPA fallback 正常，深链可直达）。
- 侧边导航：研究总览（占位）· **对话** · **课题空间** · 案例工作流（`/`）· 研究资料（`/paper`）· 工具与方法（占位）。
- 顶部面包屑按路由显示：`对话` / `课题空间`。

### 5.2 认证

- 启动用 `localStorage["fieldnote.token"]` 调 `/api/auth/me`；无效显示**登录 / 注册**门。
- 登录/注册成功后保存令牌与用户；所有 `/api/*`（除 health/auth）自动带 `Authorization: Bearer`。
- 侧栏展示当前用户，支持退出（`/api/auth/logout`）；401 清本地会话回登录门。

### 5.3 `/chat`

- 首页：课题选择器（默认最近课题）、问题输入、快速/深度切换、模型选择器（`Auto · 自动（占位）`）、附件菜单（禁用 + 说明）、示例问题（只填入不发送）、发起按钮（空输入禁用）。
- 会话视图：用户/助手气泡（助手带「模拟回复」标签与运行时元数据）、发送中 loading、失败态可重试、空态。
- 左侧会话历史：课题名 + 标题 + 时间 + 消息数；可新建 / 删除 / 切换。

### 5.4 `/repo/repository` 与 `/repo/repository/:id`

- 顶部用量摘要卡片（课题/文档/对话/消息/运行 + 存储字节）。
- 课题卡片列表；「创建课题」对话框（名称必填 ≤50、领域下拉、描述 ≤200，空名称禁用创建，错误内联）。
- 详情页：知识库（文件列表含名称/类型/大小/SHA-256 前 8 位/时间，下载/删除；上传白名单 pdf/txt/md/csv/json ≤20 MiB；「上传文件夹」为占位说明）；工具（只读目录，搜索 + 筛选 + 排序 + 分页，可添加/移除，均标注模拟）；课题内对话；输入框 `@文件名` 形态引用提示（仅文本插入，不解析正文）。

## 6. 安全边界

1. 后端仅监听 `127.0.0.1:8081`；前端 `127.0.0.1:5175`；无 `0.0.0.0`（远程访问只走 SSH 隧道）。
2. 全接口鉴权 + `owner_id` 归属校验；越权 404。
3. 消息长度上限；工具 id 必须命中静态目录；课题关联必须属本人。
4. 不上传/外发任何研究材料；回复与目录均为本地模拟并显式标注。
5. 前端令牌仅存 `localStorage`，退出即吊销服务端会话。

## 7. 测试与构建验证

### 后端单元/集成测试（15/15 通过，零警告）

```
running 15 tests
test tests::agent_policy_denies_unlisted_tools ... ok
test tests::case_progress_persists_and_resumes ... ok
test tests::migrations_apply_once_and_are_idempotent ... ok
test tests::a3s_session_calls_local_fixture_and_emits_stream_events ... ok
test tests::unauthenticated_subject_access_is_rejected ... ok
test tests::invalid_registration_is_rejected ... ok
test tests::backup_requires_auth_and_can_be_reopened ... ok
test tests::upload_rejects_oversized_payload ... ok
test tests::upload_stores_file_with_hash_and_isolated_name ... ok
test tests::upload_rejects_bad_extension_and_path_traversal ... ok
test tests::conversation_flow_persists_messages_and_simulated_reply ... ok
test tests::tool_catalog_and_subject_association ... ok
test tests::subjects_are_isolated_by_owner ... ok
test tests::conversations_are_isolated_and_validated ... ok
test tests::register_login_me_and_logout_flow ... ok

test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.05s
```

- 命令：`cargo test --offline --config "<rsproxy 镜像配置>"`；测试用 `tower::ServiceExt::oneshot` 直连 `Router`（`tempfile` 隔离数据目录），无需真实端口。
- 阶段 E 新增用例：迁移 002 幂等且版本递增、会话 CRUD 与归属隔离、发消息落库 + 模拟回复 + 写 run/evidence、空/超长消息校验、工具目录筛选与关联幂等、摘要计数正确。

### 构建

- 后端：`cargo run` → `Finished \`dev\` profile ... in 1.98s`（无警告），监听 `127.0.0.1:8081`。
- 前端：`npm run typecheck` → exit 0；`npm run build`（`tsc --noEmit && vite build`）→

```
✓ 67 modules transformed.
dist/index.html                   0.59 kB │ gzip:   0.39 kB
dist/assets/index-CyTBTCkg.css   64.93 kB │ gzip:  14.46 kB
dist/assets/index-DjkQ6U_B.js   346.52 kB │ gzip: 109.74 kB
✓ built in 866ms
```

## 8. 浏览器端到端实测

用 Puppeteer 驱动真实浏览器（1280×860），实测账号 `demo.e7@lab.local`（本地账号）。实测路由与场景（截图场景名对应，分辨率 1280×860）：

| 场景 | 路由 | 实测结果 |
|---|---|---|
| 认证门 | `/chat`（未登录） | **stage-e-auth-gate**：登录/注册切换、邮箱与密码（≥8 位）、底部「本地演示：无外网调用，不连接实验设备；退出即吊销本机会话。」 |
| 对话首页 | `/chat` | **stage-e-chat-home**：课题选择器默认最近课题、快速/深度、`Auto · 自动（占位）`、附件「暂不可用」、示例问题「只填入不发送」 |
| 会话视图 | `/chat/1` | **stage-e-chat-detail**：历史列表（课题名/标题/时间/4 条消息）、用户与助手气泡、「A3S 模拟回复」标签与运行时元数据；追问消息往返正常 |
| 课题空间 | `/repo/repository` | **stage-e-subject-space**：用量摘要（1 课题 / 1 知识库文件 / 1 会话 / 4 消息 / 2 运行记录 / 44 B）、课题卡片 |
| 课题详情（工具目录） | `/repo/repository/1` | **stage-e-subject-detail-tools**：知识库文件、工具目录 6 行整齐、分页「1 / 2」、已关联工具可移除 |

其他实测要点：

- **注册 → 登录 → 退出 → 重新登录** 全流程正常；登录响应 200 并返回令牌。
- **上传文档**：`POST /api/subjects/1/documents`（`FormData` 字段 `file`）→ 201，响应含 `byte_size:44`、`sha256`、`content_type`。
- **深链直达**：直接访问 `/repo/repository/1` 与 `/chat/9999` 均可渲染（SPA fallback 正常）；`/chat/9999` 显示「对话不存在」并回退首页态。
- **失败态**：断网/错误时助手气泡显示失败并可重试。

### 本次修复的布局缺陷

**现象**：`/repo/repository/1` 中已关联工具行 `.tool-info` 宽度被压到 0，标题逐字换行、行高 717px。

**根因**：`.button-outline` 含 `width: 100%; justify-content: space-between;`，当工具按钮切换为 `button-outline`（已关联态）时，在横排 `.tool-row` 内被撑到 660px，把 `.tool-info` 挤成 0 宽。

**修复**：在 [styles.css](../frontend/src/styles.css) 增加

```css
.tool-row .button {
  flex: 0 0 auto;
  width: auto;
  justify-content: center;
}
```

**验证**：修复后 6 行 `.tool-row` 行高全部 99px、`.tool-info` 宽度恢复 659–677px。另复核 `.chat-history-head`（新对话按钮 140px，标题 74px）与 `.kb-card .card-heading`（上传按钮 86px，标题 85px），均未被 `width:100%` 意外撑满，无同类残留问题。

## 9. 本地运行

- 后端：`cargo run`（默认 `127.0.0.1:8081`）；数据根目录由 `FIELDNOTE_DATA_DIR` 指定。
- 前端：`npm run dev` = `vite --host 127.0.0.1 --port 5175`（见 `.trae/rules/本地开发端口规范.md`）。
- 浏览器打开 <http://127.0.0.1:5175>；一律只绑回环，远程访问只走 SSH 隧道。

## 10. 模拟 / 未实现清单（明确边界）

- **模拟**：`/api/health` 标注 `simulated`；对话回复来自 A3S 会话 + fixture LLM 客户端；`/api/tools` 目录为本地静态自造清单（12 条，全部 `simulated: true`）。
- **占位**：模型选择器（`Auto` 等仅记录不改变回复来源）；附件菜单（禁用 + 说明）；「上传文件夹」（浏览器端限制说明）；研究总览、工具与方法导航（后续阶段）。
- **未实现（留待后续阶段）**：真实模型提供方与密钥、工具真实执行、外网上传/正文解析、论文工具进阶与目录类模块（F）、应用/计算/模型（G）、帮助与账号（H）、内测部署（I）、公网发布（J）。
- **`@` 引用**：仅对齐输入形态（文本插入 + 文件名提示），**不**解析正文。

## 11. 需授权事项（已停止，未执行）

以下均**未**执行，需用户明确授权后再单独立项：

- 阶段 D：接入真实模型提供方、托管密钥、可能产生费用。
- 阶段 I：内测/容器部署（非实验室环境）。
- 阶段 J：公网发布、域名/TLS、身份体系与费用。
- 任何实验室服务器与真机/Omega 主手的连接或控制。

## 12. 复核要点与已知限制

1. 工具行为 `Agent` 默认拒绝任何未列白名单的工具，fixture 会话 `tool_executions=0`、`network_used=false`，确保本地演示无副作用。
2. `.button-outline` 的 `width: 100%` 为表单竖向堆叠场景设计；在横排容器中需显式覆盖（本次已对 `.tool-row` 处理，其余横排用点经量测确认不受影响）。
3. 会话标题缺省取首条消息前 24 字，无消息时为「新对话」；`mode`/`model` 仅作记录与展示，不改变回复来源。
4. 本报告编写当时（1280×860 实测）未归档 PNG；现已通过验收导出工具补齐：`deliverables/screenshots/` 归档 15 张真实截图（桌面 1280×900、窄屏 390×844），随本地提交进入仓库，采集脚本与复现命令见 `deliverables/screenshots/README.md`。远端推送属另行授权事项，不因归档而视为已发布。
