# Fieldnote Research Studio

独立品牌的本地科研工作流演示。阶段 A 复现 PPT 中 AmeR 蛋白质定向进化路径；科研材料、曲线和实验任务均为模拟数据。前端采用 React、TypeScript、Vite、Tailwind CSS、shadcn/ui 和 Zustand。

## 本地运行

需要 Node.js 20+、npm 和 Rust stable/nightly 工具链。首次安装前后端依赖时需要访问 npm/crates.io；应用运行阶段仅绑定本机回环地址，不调用外部模型 API。

终端一，启动 Rust API：

```powershell
cargo run --manifest-path backend/Cargo.toml
```

API 绑定 `127.0.0.1:8081`。本地进度存放在仓库根目录 `data/case-progress.json`，A3S 工作区位于 `.runtime/`；两者已加入 Git 忽略。

终端二，启动 React 前端：

```powershell
Set-Location frontend
npm install
npm run dev
```

Vite 仅绑定 `127.0.0.1:5173`，浏览器打开 <http://127.0.0.1:5173>。开发代理将 `/api` 转发至上述本地 Rust 服务。

## 检查

```powershell
cargo test --manifest-path backend/Cargo.toml
Set-Location frontend
npm run typecheck
npm run build
```

## A3S 接入说明

后端锁定 `a3s-code-core = 9.1.1`，使用其 Rust `Agent`、`AgentSession::stream`、`AgentEvent` 和宿主 `LlmClient` 接口。界面中的“A3S 本地模型链路”通过 A3S 会话调用内存中的固定响应 fixture，实际展示其流式事件和路线建议；它不是 AI 推理，不请求外部模型 API，工具权限默认拒绝。科研案例其余材料是预置模拟回放，不冒充模型推理或科研计算。

Zustand 保存前端共享的案例进度、所选阶段、加载/错误状态和 A3S 会话结果。`src/components/ui/` 中的 Button、Badge、Card 和 Progress 是按 shadcn/ui 约定组织的可编辑组件；Tailwind CSS 负责主题工具类与组件样式组合。

## 安全与范围

- 无真实学术数据库、计算集群、实验仪器、机械臂、Omega 主手或摄像头连接。
- 不使用书生品牌 Logo、PPT 视频或未经许可的品牌资产。
- API 与前端都仅绑定 `127.0.0.1`；本阶段不包含公网或 Kubernetes 部署。
- `deliverables/` 保存阶段验收记录。
