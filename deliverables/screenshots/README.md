# 验收截图与 PDF 复现说明

本目录下的 15 张 PNG 为**真实浏览器实测截图**（本机 `127.0.0.1`，无外网调用），
由 `tools/docs/` 下的一组无第三方依赖脚本生成，用于 `deliverables/` 中的两份验收 PDF：

- `../stage-e-acceptance.pdf`（阶段 E 验收报告，由 `stage-e-acceptance.md` 渲染）
- `../feature-showcase-acceptance.pdf`（功能展示验收，由 `tools/docs/feature-showcase.html` 渲染）

## 脚本入口

| 脚本 | 作用 |
|---|---|
| `../../tools/docs/cdp.mjs` | 无依赖 CDP 基础设施：启动本机 headless Chrome、建连接、导航、注入脚本、截图 |
| `../../tools/docs/prepare-demo-data.mjs` | 经后端 HTTP API 幂等重建演示数据，并写出 `../../tools/docs/demo-state.json` |
| `../../tools/docs/capture-screenshots.mjs` | 读取 `demo-state.json`，采集全部 PNG 到本目录，并生成后端/A3S 证据截图 |
| `../../tools/docs/render-pdf.mjs` | 把 `.md` / `.html` 渲染为 PDF（pandoc + Chrome `Page.printToPDF`） |
| `../../tools/docs/feature-showcase.html` | 《功能展示验收》文档源（内嵌本目录截图） |

全程只用 Node 24 内置 API 与本机已安装的 Chrome / pandoc，**不新增任何 npm / pip 依赖**，**不联网**。

## 前置条件

1. 后端已运行：`cargo run`（监听 `127.0.0.1:8081`）。
2. 前端已运行：`npm run dev`（`vite --host 127.0.0.1 --port 5175`）。
3. 在 worktree 根目录（`E:\isaac_sim\elite_robot_arm_0922\vla_launch\.tmp_jixiaxueshe_worktree`）执行下述命令。

## 复现命令（按顺序）

```powershell
# 1) 重建演示数据（幂等；输出 tools/docs/demo-state.json）
node tools\docs\prepare-demo-data.mjs

# 2) 采集 15 张真实截图到 deliverables\screenshots\
node tools\docs\capture-screenshots.mjs

# 3) 渲染两份 PDF
node tools\docs\render-pdf.mjs deliverables\stage-e-acceptance.md  deliverables\stage-e-acceptance.pdf  --title "阶段 E 验收报告：核心闭环"
node tools\docs\render-pdf.mjs tools\docs\feature-showcase.html  deliverables\feature-showcase-acceptance.pdf  --title "Fieldnote Research Studio 功能展示验收"
```

## 产物清单（15 张）

桌面主视图（1280×900）：`desktop-login.png`、`desktop-case.png`、`desktop-chat-home.png`、
`desktop-chat-detail.png`、`desktop-repository.png`、`desktop-subject-detail.png`、`desktop-paper.png`

关键交互态：`state-auth-register.png`、`state-auth-error.png`、`state-chat-error.png`、`state-subject-tools.png`

窄屏适配（390×844）：`mobile-chat-detail.png`、`mobile-repository.png`、`mobile-subject-detail.png`

后端/A3S 证据：`evidence-backend-a3s.png`

## 说明

- 采集脚本会在断言失败（元素等不到、服务不可达、窄屏横向溢出、工具行异常行高等）时以非 0 退出，不留半成品。
- 演示会话 id 由 `prepare-demo-data.mjs` 生成并记录在 `tools/docs/demo-state.json`；重跑后会话 id 可能变化，属预期。
- 重跑脚本可能因沙箱拦截 Chrome 访问系统文件而返回非 0 退出码，**产物以磁盘文件为准**。
