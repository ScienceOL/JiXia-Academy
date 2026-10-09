// 演示数据准备脚本（Task 2）
//
// 仅通过后端 HTTP API（http://127.0.0.1:8081）幂等地重建一套固定演示数据，
// 并把状态写入 tools/docs/demo-state.json 供截图脚本复用。
// 全程只用 Node 24 内置能力（全局 fetch / FormData / Blob + node:fs 等），不新增任何依赖。
//
// 用法（在 worktree 根目录）：
//   node tools/docs/prepare-demo-data.mjs

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "http://127.0.0.1:8081";

// 固定账号
const DEMO_EMAIL = "demo.e7@lab.local";
const DEMO_DISPLAY_NAME = "Demo Researcher";
const DEMO_PASSWORD = "lab-pass-2026";

// 固定课题
const SUBJECT_NAME = "AmeR 定向进化验证";
const SUBJECT_FIELD = "蛋白质工程";
const SUBJECT_DESCRIPTION =
  "AmeR 转录因子定向进化：突变体设计与稳定性验证（本地模拟数据）";

// 固定文档
const DOCUMENT_NAME = "amer-notes.txt";
const DOCUMENT_CONTENT = [
  "【AmeR 定向进化实验笔记】",
  "目标：提升 AmeR 转录因子热稳定性。",
  "关键位点：L109A、A45V、R93K。",
  "初筛条件：55℃ 处理 30 分钟后测残余活性。",
  "结果：L109A 在 52℃ 保留约 70% 活性，60℃ 明显失活；A45V、R93K 增益较小。",
  "后续：构建 L109A/A45V 双突变体，补充二硫键位点预测（候选 A45C-P142C）。",
].join("\n");

// 固定工具
const TOOL_IDS = ["scp-md-simulation", "skill-mutation-score", "skill-literature-evidence"];

// 固定会话
const CONVERSATION_TITLE = "AmeR 突变体稳定性评估";
const CONVERSATION_MODE = "deep";
const CONVERSATION_MODEL = "auto";
const MESSAGES = [
  "AmeR 定向进化下一步验证计划如何安排？",
  "结合知识库里的 amer-notes.txt，评估 L109A 突变对蛋白热稳定性的潜在影响。",
  "如果要在 AmeR 上引入二硫键以提升稳定性，推荐哪几个位点组合？",
  "总结本次 AmeR 稳定性改造的风险点，并给出实验优先级排序。",
];

const OUTPUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "demo-state.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 面向使用者的清晰错误：以非 0 退出，绝不静默产出半成品。 */
class DemoError extends Error {}

/**
 * 统一请求封装：返回 { status, data }。
 * data 为解析后的 JSON（无内容或非 JSON 时为 null）。网络层失败抛出 DemoError。
 */
async function request(method, path, { token, json, formData } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (formData !== undefined) {
    body = formData; // fetch 会自动设置 multipart boundary，切勿手动设 Content-Type
  }
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { method, headers, body });
  } catch (err) {
    throw new DemoError(
      `后端不可达：${method} ${BASE_URL}${path}\n` +
        `请确认后端已在 ${BASE_URL} 运行（不得停止/重启它）。\n` +
        `底层错误：${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

/** 断言状态码；不匹配时抛出带响应体的清晰错误。 */
function expectStatus({ status, data }, allowed, label) {
  if (allowed.includes(status)) return;
  const detail = typeof data === "string" ? data : JSON.stringify(data);
  throw new DemoError(`预期外的状态码：${label} 返回 HTTP ${status}\n响应体：${detail}`);
}

// ---------------------------------------------------------------------------
// 各步骤
// ---------------------------------------------------------------------------

async function authenticate() {
  const registered = await request("POST", "/api/auth/register", {
    json: { email: DEMO_EMAIL, display_name: DEMO_DISPLAY_NAME, password: DEMO_PASSWORD },
  });
  if (registered.status === 201) {
    return { token: registered.data.token, action: "register" };
  }
  if (registered.status === 409) {
    const loggedIn = await request("POST", "/api/auth/login", {
      json: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
    expectStatus(loggedIn, [200], "登录");
    return { token: loggedIn.data.token, action: "login(已存在)" };
  }
  expectStatus(registered, [201, 409], "注册");
}

async function ensureSubject(token) {
  const listed = await request("GET", "/api/subjects", { token });
  expectStatus(listed, [200], "读取课题列表");
  const existing = (listed.data ?? []).find((item) => item.name === SUBJECT_NAME);
  if (existing) return existing.id;

  const created = await request("POST", "/api/subjects", {
    token,
    json: { name: SUBJECT_NAME, field: SUBJECT_FIELD, description: SUBJECT_DESCRIPTION },
  });
  expectStatus(created, [201], "创建课题");
  return created.data.id;
}

async function ensureDocument(token, subjectId) {
  const listed = await request("GET", `/api/subjects/${subjectId}/documents`, { token });
  expectStatus(listed, [200], "读取文档列表");
  // 同名文档先删除后重传，保证演示内容始终与脚本内定义一致（可从任意脏状态重建）。
  const stale = (listed.data ?? []).filter((item) => item.original_name === DOCUMENT_NAME);
  for (const item of stale) {
    const removed = await request("DELETE", `/api/documents/${item.id}`, { token });
    expectStatus(removed, [204], `删除旧文档 ${item.id}`);
  }

  const byteSize = Buffer.byteLength(DOCUMENT_CONTENT, "utf8");
  if (byteSize < 200 || byteSize > 400) {
    throw new DemoError(`演示文档字节数 ${byteSize} 超出 200–400 范围，请调整 DOCUMENT_CONTENT。`);
  }
  const form = new FormData();
  form.append("file", new Blob([DOCUMENT_CONTENT], { type: "text/plain" }), DOCUMENT_NAME);
  const uploaded = await request("POST", `/api/subjects/${subjectId}/documents`, { token, formData: form });
  expectStatus(uploaded, [201], "上传文档");
}

async function attachTools(token, subjectId) {
  for (const toolId of TOOL_IDS) {
    const res = await request("POST", `/api/subjects/${subjectId}/tools`, {
      token,
      json: { tool_id: toolId },
    });
    expectStatus(res, [200, 201], `关联工具 ${toolId}`);
  }
}

async function rebuildConversation(token, subjectId) {
  // 先清空该课题下的所有已存在会话，保证幂等。
  const listed = await request("GET", "/api/conversations", { token });
  expectStatus(listed, [200], "读取会话列表");
  const stale = (listed.data ?? []).filter((item) => item.subject_id === subjectId);
  for (const item of stale) {
    const removed = await request("DELETE", `/api/conversations/${item.id}`, { token });
    expectStatus(removed, [204], `删除旧会话 ${item.id}`);
  }

  const created = await request("POST", "/api/conversations", {
    token,
    json: {
      subject_id: subjectId,
      title: CONVERSATION_TITLE,
      mode: CONVERSATION_MODE,
      model: CONVERSATION_MODEL,
    },
  });
  expectStatus(created, [201], "创建会话");
  const conversationId = created.data.id;

  for (let i = 0; i < MESSAGES.length; i += 1) {
    const posted = await request("POST", `/api/conversations/${conversationId}/messages`, {
      token,
      json: { content: MESSAGES[i] },
    });
    expectStatus(posted, [201], `发送第 ${i + 1} 条消息`);
    if (i < MESSAGES.length - 1) await sleep(200);
  }

  // 复核：该课题下应恰好 1 个会话，且消息数恒为 8。
  const verify = await request("GET", "/api/conversations", { token });
  expectStatus(verify, [200], "复核会话列表");
  const mine = (verify.data ?? []).filter((item) => item.subject_id === subjectId);
  if (mine.length !== 1) {
    throw new DemoError(`幂等校验失败：该课题下会话数应为 1，实际为 ${mine.length}。`);
  }
  if (mine[0].message_count !== MESSAGES.length * 2) {
    throw new DemoError(
      `幂等校验失败：会话消息数应为 ${MESSAGES.length * 2}，实际为 ${mine[0].message_count}。`,
    );
  }
  return { conversationId, liveTitle: mine[0].title, messageCount: mine[0].message_count };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  const { token, action } = await authenticate();
  const subjectId = await ensureSubject(token);
  await ensureDocument(token, subjectId);
  await attachTools(token, subjectId);
  const { conversationId, liveTitle, messageCount } = await rebuildConversation(token, subjectId);

  const summary = await request("GET", "/api/workspace/summary", { token });
  expectStatus(summary, [200], "读取用量摘要");

  const state = {
    token,
    subjectId,
    subjectName: SUBJECT_NAME,
    conversationId,
    conversationTitle: liveTitle,
    demoEmail: DEMO_EMAIL,
    demoPassword: DEMO_PASSWORD,
    documentName: DOCUMENT_NAME,
    tools: TOOL_IDS,
    messageCount,
    createdAt: Date.now(),
  };
  await writeFile(OUTPUT_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log("演示数据准备完成（幂等）。");
  console.log(`- 账号：${DEMO_EMAIL}（${action}），token 长度 ${token.length}`);
  console.log(`- 课题：${SUBJECT_NAME}（id=${subjectId}）`);
  console.log(`- 会话：id=${conversationId}，消息数=${messageCount}，后端实际标题="${liveTitle}"`);
  console.log(`- 工具：${TOOL_IDS.join("、")}`);
  console.log(`- 状态文件：${OUTPUT_PATH}`);
  console.log(`- workspace summary：${JSON.stringify(summary.data)}`);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`错误：${message}`);
  process.exit(1);
});
