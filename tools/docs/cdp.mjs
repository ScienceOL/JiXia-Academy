// 无依赖 CDP 工具模块
//
// 用本机已存在的 Chrome（优先使用 Puppeteer 捆绑版本）以 headless + 远程调试模式启动，
// 通过 Node 24 内置的全局 WebSocket 直连 Chrome DevTools Protocol，
// 完成页面导航、脚本注入、元素等待与整页截图。全程不新增任何 npm 依赖。
//
// 用法：
//   import { withChrome, assertService, resolveChrome } from "./cdp.mjs";
//   await withChrome(async (browser) => {
//     const page = await browser.newPage({ width: 1280, height: 900 });
//     await page.addInitScript(`localStorage.setItem("k","v")`);
//     await page.goto("http://127.0.0.1:5175/");
//     await page.screenshot("deliverables/screenshots/x.png");
//   });

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Users\\dou12\\.cache\\puppeteer\\chrome\\win64-131.0.6778.204\\chrome-win64\\chrome.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

export function resolveChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  throw new Error(
    "找不到可用的 Chrome/Edge 可执行文件。请设置环境变量 CHROME_PATH 指向 chrome.exe。",
  );
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 探测本地服务是否可达；不可达时抛出明确错误（不静默产出半成品）。 */
export async function assertService(url, label, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${label} 返回 HTTP ${res.status}（${url}）`);
    }
    return res;
  } catch (err) {
    if (err instanceof Error && err.message.includes("HTTP")) throw err;
    throw new Error(
      `${label} 不可达：${url}\n` +
        `请先确认本地服务已启动（前端 127.0.0.1:5175 / 后端 127.0.0.1:8081），再重试。\n` +
        `底层错误：${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

class CdpConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          entry.reject(new Error(`${msg.error.message ?? "CDP error"} (code ${msg.error.code})`));
        } else {
          entry.resolve(msg.result ?? {});
        }
        return;
      }
      if (msg.method) {
        const list = this.handlers.get(msg.method);
        if (list) for (const fn of [...list]) fn(msg.params ?? {}, msg.sessionId);
      }
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const [, entry] of this.pending) entry.reject(new Error("CDP 连接已关闭"));
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error("CDP 连接已关闭"));
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      setTimeout(() => {
        if (this.pending.delete(id)) rejectPromise(new Error(`CDP 超时：${method}`));
      }, 30000);
    });
  }

  on(method, handler) {
    const list = this.handlers.get(method) ?? [];
    list.push(handler);
    this.handlers.set(method, list);
    return () => {
      const current = this.handlers.get(method) ?? [];
      this.handlers.set(
        method,
        current.filter((fn) => fn !== handler),
      );
    };
  }

  waitFor(method, { sessionId, timeout = 15000 } = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
      const off = this.on(method, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        clearTimeout(timer);
        off();
        resolvePromise(params);
      });
      const timer = setTimeout(() => {
        off();
        rejectPromise(new Error(`等待事件超时：${method}`));
      }, timeout);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

export class Page {
  constructor(connection, sessionId, targetId) {
    this.conn = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params = {}) {
    return this.conn.send(method, params, this.sessionId);
  }

  async init({ width = 1280, height = 900, dpr = 1 } = {}) {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("DOM.enable");
    await this.setViewport(width, height, dpr);
  }

  setViewport(width, height, dpr = 1) {
    this.viewport = { width, height, dpr };
    return this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: false,
    });
  }

  /** 注入在每个新文档开始前执行的脚本（同源 localStorage 写 token 等）。 */
  addInitScript(source) {
    return this.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }

  async goto(url, { timeout = 30000, waitSelector, settle = 500 } = {}) {
    const loaded = this.conn
      .waitFor("Page.loadEventFired", { sessionId: this.sessionId, timeout })
      .catch(() => null);
    await this.send("Page.navigate", { url });
    await loaded;
    if (waitSelector) await this.waitForSelector(waitSelector, timeout);
    await sleep(settle);
  }

  async waitForSelector(selector, timeout = 15000) {
    const deadline = Date.now() + timeout;
    const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
    for (;;) {
      const ok = await this.evaluate(expr).catch(() => false);
      if (ok) return true;
      if (Date.now() > deadline) {
        throw new Error(`等待元素超时：${selector}`);
      }
      await sleep(150);
    }
  }

  async evaluate(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `页面脚本执行失败：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result?.value;
  }

  async fullHeight() {
    const metrics = await this.send("Page.getLayoutMetrics");
    const size = metrics.cssContentSize ?? metrics.contentSize ?? { width: 0, height: 0 };
    return Math.ceil(size.height);
  }

  /** 落盘 PNG；返回写入的绝对路径。fullPage=true 时按内容高度截取整页。 */
  async screenshot(outPath, { fullPage = false } = {}) {
    const params = { format: "png", fromSurface: true, captureBeyondViewport: fullPage };
    if (fullPage) {
      const height = await this.fullHeight();
      params.clip = {
        x: 0,
        y: 0,
        width: this.viewport?.width ?? 1280,
        height,
        scale: 1,
      };
    }
    const { data } = await this.send("Page.captureScreenshot", params);
    const absolute = resolve(outPath);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, Buffer.from(data, "base64"));
    return absolute;
  }

  async close() {
    await this.conn.send("Target.closeTarget", { targetId: this.targetId }).catch(() => null);
  }
}

export class Browser {
  constructor(connection, process, userDataDir, browserWsUrl) {
    this.conn = connection;
    this.process = process;
    this.userDataDir = userDataDir;
    this.browserWsUrl = browserWsUrl;
  }

  async newPage(options = {}) {
    const { targetId } = await this.conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.conn.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this.conn, sessionId, targetId);
    await page.init(options);
    return page;
  }

  async close() {
    this.conn.close();
    try {
      this.process.kill();
    } catch {
      /* ignore */
    }
    await sleep(300);
    try {
      rmSync(this.userDataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function readDevToolsPort(userDataDir, timeoutMs) {
  const portFile = join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      if (first && /^\d+$/.test(first)) return Number(first);
    }
    await sleep(100);
  }
  throw new Error("Chrome 未在限定时间内写出 DevToolsActivePort（调试端口启动失败）");
}

async function fetchBrowserWsUrl(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = await res.json();
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    if (Date.now() > deadline) throw new Error("无法从 /json/version 获取浏览器 WebSocket 地址");
    await sleep(150);
  }
}

export async function launchChrome({ executablePath, windowSize = "1280,900" } = {}) {
  const chrome = executablePath ?? resolveChrome();
  const userDataDir = mkdtempSync(join(tmpdir(), "cdp-profile-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    `--window-size=${windowSize}`,
    "about:blank",
  ];
  const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", () => {});
  child.stdout.on("data", () => {});

  const port = await readDevToolsPort(userDataDir, 20000);
  const browserWsUrl = await fetchBrowserWsUrl(port, 10000);

  const ws = new WebSocket(browserWsUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    ws.addEventListener("open", () => resolvePromise());
    ws.addEventListener("error", () => rejectPromise(new Error("CDP WebSocket 连接失败")));
  });

  return new Browser(new CdpConnection(ws), child, userDataDir, browserWsUrl);
}

/** 启动 Chrome、执行回调、无论成败都关闭。 */
export async function withChrome(fn, options) {
  const browser = await launchChrome(options);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}
