# Fieldnote Research Studio

独立品牌的本地科研工作流演示。阶段 A 展示 AmeR 蛋白质定向进化案例工作流；阶段 B 提供文献检索、PDF 精读和引文核验的本地模拟交互；阶段 C 引入本地账号认证、课题空间与知识库底座（SQLite、文档上传、工具关联）；阶段 E 打通“对话 + 课题空间”核心闭环。科研材料、曲线、文献条目、阅读样例和实验任务均非真实数据。前端采用 React、TypeScript、Vite、Tailwind CSS、shadcn/ui 和 Zustand。

## 本地运行

需要 Node.js 20+、npm 和 Rust stable/nightly 工具链。首次安装前后端依赖时需要访问 npm/crates.io；应用运行阶段仅绑定本机回环地址，不调用外部模型 API。

终端一，启动 Rust API：

```powershell
cargo run --manifest-path backend/Cargo.toml
```

API 绑定 `127.0.0.1:8081`。本地数据根目录为进程工作目录下的 `data/`（可用 `FIELDNOTE_DATA_DIR` 覆盖），存放 SQLite 数据库 `fieldnote.db`、上传文档 `uploads/`、备份 `backups/`、日志 `logs/` 与案例进度 `case-progress.json`；A3S 工作区位于 `.runtime/`。`data/` 与 `.runtime/` 已加入 Git 忽略。

终端二，启动 React 前端：

```powershell
Set-Location frontend
npm install
npm run dev
```

Vite 仅绑定 `127.0.0.1:5175`，浏览器打开 <http://127.0.0.1:5175>。开发代理将 `/api` 转发至上述本地 Rust 服务。首次使用需在登录页注册本地账号（邮箱 + 口令，Argon2id 哈希存储）。

## 检查

```powershell
cargo test --manifest-path backend/Cargo.toml
Set-Location frontend
npm run typecheck
npm run build
```

## A3S 接入说明

后端锁定 `a3s-code-core = 9.1.1`，使用其 Rust `Agent`、`AgentSession::stream`、`AgentEvent` 和宿主 `LlmClient` 接口。界面中的“A3S 本地模型链路”通过 A3S 会话调用内存中的固定响应 fixture，实际展示其流式事件和路线建议；它不是 AI 推理，不请求外部模型 API，工具权限默认拒绝。科研案例其余材料是预置模拟回放，不冒充模型推理或科研计算。

Zustand 保存前端共享的案例进度、所选阶段、加载/错误状态、认证态、课题/会话列表与 A3S 会话结果。`src/components/ui/` 中的 Button、Badge、Card 和 Progress 是按 shadcn/ui 约定组织的可编辑组件；Tailwind CSS 负责主题工具类与组件样式组合。

## 验收导出工具

`tools/docs/` 下的零依赖 Node 脚本用于重建验收交付物，**需要 Node 24+**（使用内置 `fetch`/`WebSocket`）：

1. `prepare-demo-data.mjs`：经本地 API 幂等重建固定演示数据（账号 `demo.e7@lab.local`），状态写入 `tools/docs/demo-state.json`（已加入 Git 忽略，含本地会话令牌，勿提交）。
2. `capture-screenshots.mjs`：用本机 Chrome（CDP 直连）采集 15 张真实 UI 截图到 `deliverables/screenshots/`。
3. `render-pdf.mjs`：把 Markdown/HTML 渲染为 PDF（依赖本机 pandoc 与 Chrome）。

复现命令见 `deliverables/screenshots/README.md`。导出工具与应用运行互不依赖；导出时需本地前后端服务在 5175/8081 运行。

## 安全与范围

- 论文工具只筛选前端内置的虚构条目；PDF 在浏览器本地校验扩展名、MIME、大小和前 5 字节签名，不上传或解析正文，阅读视图与文件内容无关；引文判断是演示规则，不是事实核验。
- 无真实学术数据库、计算集群、实验仪器、机械臂、Omega 主手或摄像头连接。
- 不使用书生品牌 Logo、PPT 视频或未经许可的品牌资产。
- API 与前端都仅绑定 `127.0.0.1`；本阶段不包含公网或 Kubernetes 部署。
- `deliverables/` 保存阶段验收记录与真实截图。
