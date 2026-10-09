// Task 3：真实截图采集脚本（无新增依赖，复用 cdp.mjs）
//
// 作用：读取 tools/docs/demo-state.json，用本机 headless Chrome 采集 15 张真实 UI 截图
// 落盘到 deliverables/screenshots/，并生成「后端与 A3S 运行证据」截图。
//
// 全程只访问 127.0.0.1（前端 5175 / 后端 8081）与本地 file://，不联网。
//
// 用法（在 worktree 根目录）：
//   node tools/docs/capture-screenshots.mjs
//
// 任何元素等不到 / 断言失败 / 服务不可达 → 打印中文错误并以非 0 退出，不留半成品。

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertService, sleep, withChrome } from "./cdp.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..", "..");
const OUT_DIR = resolve(rootDir, "deliverables", "screenshots");
const DEMO_STATE = resolve(scriptDir, "demo-state.json");
const EVIDENCE_HTML = resolve(scriptDir, "_evidence.tmp.html");

const FRONTEND = "http://127.0.0.1:5175";
const BACKEND = "http://127.0.0.1:8081";
const TOKEN_KEY = "fieldnote.token";
const JOBS_DIR = "C:\\Users\\dou12\\AppData\\Local\\Temp\\trae-agent-toolhost\\jobs";
const FALLBACK_LOG_JOB = "job-800957307909461c9f3489fea68eaf18";

function log(message) {
  console.log(`[capture] ${message}`);
}

function fail(message) {
  console.error(`[capture] 错误：${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 采集辅助
// ---------------------------------------------------------------------------

const captured = [];

async function shoot(page, name, { fullPage = true } = {}) {
  const abs = resolve(OUT_DIR, name);
  await page.screenshot(abs, { fullPage });
  const bytes = statSync(abs).size;
  if (bytes < 10000) {
    throw new Error(`截图 ${name} 仅 ${bytes} 字节（<10000），疑似空白或渲染失败。`);
  }
  captured.push({ name, bytes });
  log(`已保存 ${name}（${bytes} 字节）`);
  return abs;
}

const setTokenScript = (token) =>
  `try { localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); } catch (e) {}`;
const clearTokenScript = `try { localStorage.removeItem(${JSON.stringify(TOKEN_KEY)}); } catch (e) {}`;

/** 页面内原生输入：绕过 React 受控组件，用原生 setter + input 事件触发 onChange。 */
const NATIVE_SET_FN = `
function __setNativeValue(el, value) {
  if (!el) throw new Error("目标输入框不存在");
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}`;

async function waitForText(page, text, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const ok = await page
      .evaluate(`document.body && document.body.innerText.includes(${JSON.stringify(text)})`)
      .catch(() => false);
    if (ok) return true;
    if (Date.now() > deadline) throw new Error(`等待页面文字超时：「${text}」`);
    await sleep(150);
  }
}

/** 已登录页守卫：必须出现应用外壳，且不得仍在登录门。 */
async function requireAuthed(page, label) {
  const state = await page.evaluate(
    `({ shell: !!document.querySelector('.app-shell'), auth: !!document.querySelector('.auth-submit') })`,
  );
  if (!state.shell || state.auth) {
    throw new Error(
      `${label} 渲染异常：应用外壳 presence=${state.shell}，登录门 presence=${state.auth}` +
        `（可能令牌失效被退回登录页）。`,
    );
  }
}

async function assertNoHorizontalOverflow(page, label) {
  const info = await page.evaluate(
    `({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`,
  );
  if (info.scrollWidth > info.innerWidth) {
    throw new Error(
      `${label} 出现横向溢出：scrollWidth=${info.scrollWidth} > innerWidth=${info.innerWidth}。`,
    );
  }
  log(`${label} 无横向溢出：scrollWidth=${info.scrollWidth} <= innerWidth=${info.innerWidth}`);
  return info;
}

// ---------------------------------------------------------------------------
// 后端证据采集
// ---------------------------------------------------------------------------

async function getJson(path, token) {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} 返回 HTTP ${res.status}`);
  return res.json();
}

/** 在 jobs 目录里找最新一个同时含 migration.applied / server.started / listening 的 output.log。 */
function collectLogExcerpt() {
  const wanted = (line) =>
    line.includes("migration.applied") ||
    line.includes("schema_version") ||
    line.includes("server.started") ||
    line.includes("listening");

  const scanFile = (path) => {
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return null;
    }
    if (!text.includes("migration.applied")) return null;
    if (!text.includes("server.started")) return null;
    if (!text.includes("listening at http://127.0.0.1:8081")) return null;
    const lines = text.split(/\r?\n/).filter((line) => wanted(line));
    if (lines.length === 0) return null;
    return { path, lines };
  };

  let entries = [];
  try {
    entries = readdirSync(JOBS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(JOBS_DIR, entry.name, "output.log"))
      .filter((path) => existsSync(path))
      .map((path) => {
        const st = statSync(path);
        return { path, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (err) {
    return { path: null, lines: [], note: `无法读取 jobs 目录：${err.message}` };
  }

  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= 2000) break;
    scanned += 1;
    if (entry.size > 2 * 1024 * 1024) continue;
    const found = scanFile(entry.path);
    if (found) {
      log(`证据日志来源：${found.path}`);
      return found;
    }
  }

  // 回退：已知命中文件。
  const fallback = join(JOBS_DIR, FALLBACK_LOG_JOB, "output.log");
  if (existsSync(fallback)) {
    const found = scanFile(fallback);
    if (found) {
      log(`证据日志来源（回退）：${found.path}`);
      return found;
    }
  }
  return { path: null, lines: [], note: "未在 jobs 目录找到含 migration.applied 的启动日志。" };
}

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildEvidenceHtml({ health, tools, summary, logExcerpt, collectedAt }) {
  const toolRows = (tools.items ?? [])
    .map(
      (tool) =>
        `<tr><td>${esc(tool.id)}</td><td>${esc(tool.name)}</td><td>${esc(
          tool.simulated === true ? "true" : "false",
        )}</td></tr>`,
    )
    .join("\n");

  const logLines = logExcerpt.lines.length
    ? logExcerpt.lines.map((line) => `<code>${esc(line)}</code>`).join("\n")
    : `<p class="warn">${esc(logExcerpt.note ?? "未找到日志行")}</p>`;

  const logSource = logExcerpt.path
    ? `<p class="src">来源文件：<code>${esc(logExcerpt.path)}</code></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>后端与 A3S 运行证据</title>
<style>
  body { font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; margin: 24px; color: #1f2933; background: #fff; }
  h1 { font-size: 22px; border-bottom: 2px solid #1f2933; padding-bottom: 8px; }
  h2 { font-size: 16px; margin-top: 26px; border-left: 4px solid #2563eb; padding-left: 8px; }
  .meta { color: #52606d; font-size: 13px; }
  pre { background: #0f172a; color: #e2e8f0; font-family: Consolas, "Courier New", monospace; font-size: 12px;
        padding: 12px 14px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .logbox { background: #0f172a; border-radius: 6px; padding: 12px 14px; }
  .logbox code { display: block; color: #e2e8f0; font-family: Consolas, "Courier New", monospace;
                 font-size: 12px; white-space: pre-wrap; word-break: break-word; margin: 2px 0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f0f3f6; }
  .badge { display: inline-block; background: #dcfce7; color: #166534; border-radius: 4px; padding: 2px 8px; font-size: 12px; }
  .src { color: #52606d; font-size: 12px; }
  .src code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; }
  .warn { color: #b45309; }
</style>
</head>
<body>
  <h1>后端与 A3S 运行证据（本机 127.0.0.1）</h1>
  <p class="meta">采集时间：${esc(collectedAt)} &nbsp;·&nbsp; 数据来源：${esc(BACKEND)} &nbsp;·&nbsp;
    <span class="badge">本地 / 离线 / 无外网调用</span></p>

  <h2>B. GET /api/health（原始 JSON）</h2>
  <pre>${esc(JSON.stringify(health, null, 2))}</pre>

  <h2>C. GET /api/tools 摘要（total = ${esc(tools.total)}）</h2>
  <table>
    <thead><tr><th>id</th><th>name</th><th>simulated</th></tr></thead>
    <tbody>
${toolRows}
    </tbody>
  </table>

  <h2>D. GET /api/workspace/summary（原始 JSON）</h2>
  <pre>${esc(JSON.stringify(summary, null, 2))}</pre>

  <h2>E. 后端启动 / 迁移日志摘录（真实行，原样摘录）</h2>
  ${logSource}
  <div class="logbox">
${logLines}
  </div>
</body>
</html>`;
}

/** 将本地绝对路径转成合法的 file:// URL（Windows 盘符如 E:\\ 转 /E:/）。 */
function toFileUrl(absolutePath) {
  let p = absolutePath.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  return `file://${encodeURI(p)}`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  // 一、启动前校验
  try {
    await assertService(`${FRONTEND}/`, "前端 (Vite dev, 127.0.0.1:5175)", 5000);
    await assertService(`${BACKEND}/api/health`, "后端 (fieldnote-api, 127.0.0.1:8081)", 5000);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  log("前后端服务可达，开始采集。");

  if (!existsSync(DEMO_STATE)) fail(`找不到输入数据：${DEMO_STATE}`);
  const demo = JSON.parse(readFileSync(DEMO_STATE, "utf8"));
  const {
    token,
    subjectId,
    conversationId,
    demoEmail,
  } = demo;
  if (!token) fail("demo-state.json 缺少 token 字段。");

  mkdirSync(OUT_DIR, { recursive: true });

  // 五、后端 / A3S 证据数据（真实 fetch + 真实日志）
  const collectedAt = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  let health;
  let tools;
  let summary;
  try {
    health = await getJson("/api/health", token);
    tools = await getJson("/api/tools", token);
    summary = await getJson("/api/workspace/summary", token);
  } catch (err) {
    fail(`采集后端证据失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (tools.total !== 12) {
    log(`注意：/api/tools 的 total = ${tools.total}（预期 12）。`);
  }
  const logExcerpt = collectLogExcerpt();
  writeFileSync(
    EVIDENCE_HTML,
    buildEvidenceHtml({ health, tools, summary, logExcerpt, collectedAt }),
    "utf8",
  );

  const toolRowHeights = [];
  const overflowChecks = [];

  try {
    await withChrome(async (browser) => {
      // ---- 未登录页（桌面 1280×900）----
      const authPage = await browser.newPage({ width: 1280, height: 900 });
      await authPage.addInitScript(clearTokenScript);

      // 二.1 desktop-login：先采这一张
      await authPage.goto(`${FRONTEND}/`, { waitSelector: ".auth-submit", settle: 600 });
      await shoot(authPage, "desktop-login.png", { fullPage: true });

      // 三.1 state-auth-register：切到「注册」标签
      await authPage.evaluate(
        `(() => { const btn = Array.from(document.querySelectorAll('.auth-tabs button'))
          .find((b) => b.textContent.trim() === '注册'); if (!btn) throw new Error('找不到注册标签');
          btn.click(); return true; })()`,
      );
      await authPage.waitForSelector('input[autocomplete="nickname"]', 8000);
      await sleep(400);
      await shoot(authPage, "state-auth-register.png", { fullPage: false });

      // 三.2 state-auth-error：真实登录失败
      await authPage.evaluate(
        `(() => { const btn = Array.from(document.querySelectorAll('.auth-tabs button'))
          .find((b) => b.textContent.trim() === '登录'); if (btn) btn.click();
          ${NATIVE_SET_FN}
          __setNativeValue(document.querySelector('input[type="email"]'), ${JSON.stringify(demoEmail)});
          __setNativeValue(document.querySelector('input[type="password"]'), "wrong-pass-0000");
          return true; })()`,
      );
      await authPage.waitForSelector(".auth-submit:not([disabled])", 8000);
      await authPage.evaluate(
        `(() => { document.querySelector('.auth-submit').click(); return true; })()`,
      );
      await authPage.waitForSelector('.inline-error[role="alert"]', 12000);
      await sleep(400);
      await shoot(authPage, "state-auth-error.png", { fullPage: false });
      await authPage.close();

      // ---- 已登录页（桌面 1280×900）----
      const page = await browser.newPage({ width: 1280, height: 900 });
      await page.addInitScript(setTokenScript(token));

      // 二.2 desktop-case
      await page.goto(`${FRONTEND}/`, { waitSelector: ".case-intro", settle: 700 });
      await requireAuthed(page, "desktop-case");
      await shoot(page, "desktop-case.png", { fullPage: true });

      // 二.3 desktop-chat-home
      await page.goto(`${FRONTEND}/chat`, { waitSelector: ".chat-head-home", settle: 700 });
      await requireAuthed(page, "desktop-chat-home");
      await shoot(page, "desktop-chat-home.png", { fullPage: true });

      // 二.4 desktop-chat-detail
      await page.goto(`${FRONTEND}/chat/${conversationId}`, {
        waitSelector: ".message-assistant",
        settle: 800,
      });
      await requireAuthed(page, "desktop-chat-detail");
      await waitForText(page, "A3S 模拟回复");
      await shoot(page, "desktop-chat-detail.png", { fullPage: true });

      // 三.3 state-chat-error：用原生 CDP 让发送失败
      await page.send("Network.enable");
      await page.send("Network.setBlockedURLs", { urls: ["*conversations*messages*"] });
      await page.evaluate(
        `(() => { ${NATIVE_SET_FN}
          __setNativeValue(document.querySelector('.composer textarea'), "这条消息会被网络拦截，用于展示失败态。");
          return true; })()`,
      );
      await page.waitForSelector(".composer-send:not([disabled])", 8000);
      await page.evaluate(
        `(() => { document.querySelector('.composer-send').click(); return true; })()`,
      );
      await page.waitForSelector('.inline-error[role="alert"]', 12000);
      await sleep(400);
      await shoot(page, "state-chat-error.png", { fullPage: false });
      // 恢复网络并重载
      await page.send("Network.setBlockedURLs", { urls: [] });
      await page.goto(`${FRONTEND}/chat/${conversationId}`, {
        waitSelector: ".message-assistant",
        settle: 500,
      });

      // 二.5 desktop-repository
      await page.goto(`${FRONTEND}/repo/repository`, { waitSelector: ".repo-hero", settle: 700 });
      await requireAuthed(page, "desktop-repository");
      await shoot(page, "desktop-repository.png", { fullPage: true });

      // 二.6 desktop-subject-detail + 三.4 state-subject-tools
      await page.goto(`${FRONTEND}/repo/repository/${subjectId}`, {
        waitSelector: ".subject-head",
        settle: 600,
      });
      await requireAuthed(page, "desktop-subject-detail");
      await page.waitForSelector(".tool-row", 12000);
      await page.waitForSelector(".kb-row", 12000);
      await sleep(400);
      await shoot(page, "desktop-subject-detail.png", { fullPage: true });

      // 断言：每个 .tool-row 高度 < 200
      const rows = await page.evaluate(
        `Array.from(document.querySelectorAll('.tool-row')).map((el) => ({
            h: el.getBoundingClientRect().height,
            name: (el.querySelector('strong') || {}).textContent || '',
         }))`,
      );
      if (rows.length === 0) throw new Error("state-subject-tools：页面上找不到任何 .tool-row。");
      const tooTall = rows.filter((row) => row.h >= 200);
      for (const row of rows) {
        toolRowHeights.push({ name: row.name.trim(), h: Math.round(row.h) });
      }
      log(
        `.tool-row 高度断言：共 ${rows.length} 行，最大高度 ${Math.round(
          Math.max(...rows.map((r) => r.h)),
        )}px（阈值 <200）。`,
      );
      if (tooTall.length > 0) {
        throw new Error(
          `布局回归：以下 .tool-row 高度 ≥200px → ${tooTall
            .map((r) => `${r.name}=${Math.round(r.h)}px`)
            .join(", ")}`,
        );
      }
      // 滚动到工具区后取可视区截图
      await page.evaluate(
        `(() => { const el = document.querySelector('.tool-card'); if (el) el.scrollIntoView({ block: 'start' }); return true; })()`,
      );
      await sleep(500);
      await shoot(page, "state-subject-tools.png", { fullPage: false });

      // 二.7 desktop-paper
      await page.goto(`${FRONTEND}/paper`, { waitSelector: ".paper-workspace", settle: 700 });
      await requireAuthed(page, "desktop-paper");
      await shoot(page, "desktop-paper.png", { fullPage: true });
      await page.close();

      // ---- 四、窄屏适配（390×844, dpr 1）----
      const mobile = await browser.newPage({ width: 390, height: 844, dpr: 1 });
      await mobile.addInitScript(setTokenScript(token));

      const mobileTargets = [
        { name: "mobile-chat-detail.png", path: `/chat/${conversationId}`, selector: ".message-assistant" },
        { name: "mobile-repository.png", path: "/repo/repository", selector: ".repo-hero" },
        {
          name: "mobile-subject-detail.png",
          path: `/repo/repository/${subjectId}`,
          selector: ".subject-head",
        },
      ];
      for (const target of mobileTargets) {
        await mobile.setViewport(390, 844, 1);
        await mobile.goto(`${FRONTEND}${target.path}`, {
          waitSelector: target.selector,
          settle: 800,
        });
        await requireAuthed(mobile, target.name);
        await sleep(300);
        const info = await assertNoHorizontalOverflow(mobile, target.name);
        overflowChecks.push({ name: target.name, ...info });
        await shoot(mobile, target.name, { fullPage: true });
      }
      await mobile.close();

      // ---- 五、证据截图 ----
      const evidence = await browser.newPage({ width: 1000, height: 1200 });
      await evidence.goto(toFileUrl(EVIDENCE_HTML), { waitSelector: "body", settle: 600 });
      await shoot(evidence, "evidence-backend-a3s.png", { fullPage: true });
      await evidence.close();
    });
  } finally {
    if (existsSync(EVIDENCE_HTML)) rmSync(EVIDENCE_HTML, { force: true });
  }

  // 结束清单
  console.log("");
  console.log("[capture] ===== 采集清单（文件 / 字节数）=====");
  for (const item of captured) {
    console.log(`  ${item.name.padEnd(32)} ${String(item.bytes).padStart(8)} 字节`);
  }
  console.log(`[capture] 共 ${captured.length} 张，全部落盘于 ${OUT_DIR}`);
  console.log("");
  console.log("[capture] .tool-row 高度（px）：");
  for (const row of toolRowHeights) console.log(`  ${row.name || "(未命名)"} : ${row.h}px`);
  console.log("[capture] 窄屏横向溢出断言：全部通过（scrollWidth <= innerWidth）");
  console.log("[capture] 采集完成。");
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
