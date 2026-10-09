// 无依赖的 Markdown/HTML → PDF 渲染脚本
//
// 思路：
//   - Markdown 先用 pandoc 转成独立 HTML（临时 HTML 与输入文件同目录，保证相对图片路径可解析）；
//   - HTML 直接读取并注入中文排版 + 打印 CSS；
//   - 统一用 cdp.mjs 启动 headless Chrome，调用 Page.printToPDF 输出 PDF。
// 全程不新增任何 npm 依赖（仅 Node 24 内置 API + 本机已装的 pandoc / Chrome）。
//
// 用法：
//   node tools/docs/render-pdf.mjs <input> <output.pdf> [--title "标题"]
//   PANDOC 环境变量可覆盖 pandoc 可执行文件路径。

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { withChrome } from "./cdp.mjs";

const DEFAULT_PANDOC = "C:\\Users\\dou12\\anaconda3\\Scripts\\pandoc.exe";

const PRINT_CSS = `
  body { font-family: "Microsoft YaHei", "Segoe UI", system-ui, sans-serif; line-height: 1.7; color: #1f2933; font-size: 12pt; margin: 0; }
  h1, h2, h3 { border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-top: 20px; }
  h1 { font-size: 20pt; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13.5pt; }
  code, pre { white-space: pre-wrap; word-break: break-word; background: #f5f7fa; border-radius: 4px; font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; }
  pre { padding: 10px 12px; border: 1px solid #e2e8f0; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; }
  th, td { border: 1px solid #d0d7de; padding: 6px 8px; text-align: left; }
  th { background: #f0f3f6; }
  img { max-width: 100%; height: auto; }
  blockquote { border-left: 4px solid #cbd5e1; margin: 0; padding: 0 12px; color: #52606d; }
  a { color: #2563eb; text-decoration: none; }
  h1, h2, h3 { page-break-after: avoid; }
  table, pre, img, tr { page-break-inside: avoid; }
  @page { size: A4; margin: 18mm 16mm; }
`;

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`[render-pdf] 错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  let title = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") {
      title = argv[i + 1];
      if (title === undefined) fail("--title 缺少参数值");
      i += 1;
    } else if (arg.startsWith("--title=")) {
      title = arg.slice("--title=".length);
    } else if (arg.startsWith("--")) {
      fail(`未知参数：${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length < 2) {
    fail(
      "用法：node tools/docs/render-pdf.mjs <input.md|input.html> <output.pdf> [--title \"标题\"]",
    );
  }
  return { input: positional[0], output: positional[1], title };
}

/** 将本地绝对路径转成合法的 file:// URL（Windows 盘符如 E:\\ 转 /E:/）。 */
function toFileUrl(absolutePath) {
  let p = absolutePath.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  return `file://${encodeURI(p)}`;
}

/** 向 HTML 注入打印样式；无 </head> 时整体包裹成完整文档并保证 utf-8。 */
function injectCss(html) {
  const styleTag = `<style>\n${PRINT_CSS}\n</style>`;
  if (/<\/head>/i.test(html)) {
    let out = html.replace(/<\/head>/i, `${styleTag}\n</head>`);
    if (!/<meta[^>]+charset/i.test(out)) {
      out = out.replace(/<head([^>]*)>/i, `<head$1>\n<meta charset="utf-8">`);
    }
    return out;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title></title>
${styleTag}
</head>
<body>
${html}
</body>
</html>`;
}

function resolvePandoc() {
  if (process.env.PANDOC) return process.env.PANDOC;
  if (existsSync(DEFAULT_PANDOC)) return DEFAULT_PANDOC;
  return "pandoc";
}

function runPandoc(pandoc, inputPath, tempHtml, title) {
  const args = [
    "-f", "gfm",
    "-t", "html5",
    "--standalone",
    "--metadata", `title=${title}`,
    "-o", tempHtml,
    inputPath,
  ];
  const result = spawnSync(pandoc, args, { encoding: "utf8" });
  if (result.error) {
    fail(`无法执行 pandoc（${pandoc}）：${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(
      `pandoc 转换失败（退出码 ${result.status}）：\n${(result.stderr || "").trim() || "(无 stderr 输出)"}`,
    );
  }
}

async function main() {
  const { input, output, title } = parseArgs(process.argv.slice(2));

  const inputPath = resolve(input);
  if (!existsSync(inputPath)) fail(`输入文件不存在：${inputPath}`);

  const outputPath = resolve(output);
  if (extname(outputPath).toLowerCase() !== ".pdf") {
    fail(`输出必须是以 .pdf 结尾的路径：${outputPath}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });

  const ext = extname(inputPath).toLowerCase();
  const tempHtml = `${inputPath}.render.html`;
  const effectiveTitle = title || basename(inputPath, extname(inputPath));

  try {
    if (ext === ".md" || ext === ".markdown") {
      const pandoc = resolvePandoc();
      log(`[render-pdf] 用 pandoc 转换 Markdown → HTML：${pandoc}`);
      runPandoc(pandoc, inputPath, tempHtml, effectiveTitle);
      const converted = readFileSync(tempHtml, "utf8");
      writeFileSync(tempHtml, injectCss(converted), "utf8");
    } else if (ext === ".html" || ext === ".htm") {
      const raw = readFileSync(inputPath, "utf8");
      writeFileSync(tempHtml, injectCss(raw), "utf8");
    } else {
      fail(`不支持的输入类型（仅 .md / .html）：${inputPath}`);
    }

    const fileUrl = toFileUrl(tempHtml);
    let byteLength = 0;
    await withChrome(async (browser) => {
      const page = await browser.newPage({ width: 900, height: 1200 });
      await page.goto(fileUrl, { waitSelector: "body", settle: 400 });
      let data;
      try {
        ({ data } = await page.send("Page.printToPDF", {
          printBackground: true,
          displayHeaderFooter: true,
          preferCSSPageSize: true,
          headerTemplate: "<div></div>",
          footerTemplate:
            '<div style="font-size:8px;width:100%;text-align:center;color:#8a94a6;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
          marginTop: 0.6,
          marginBottom: 0.7,
          marginLeft: 0.5,
          marginRight: 0.5,
        }));
      } catch (err) {
        log(`[render-pdf] preferCSSPageSize 失败，回退到显式 A4 尺寸：${err.message}`);
        ({ data } = await page.send("Page.printToPDF", {
          printBackground: true,
          displayHeaderFooter: true,
          preferCSSPageSize: false,
          paperWidth: 8.27,
          paperHeight: 11.69,
          headerTemplate: "<div></div>",
          footerTemplate:
            '<div style="font-size:8px;width:100%;text-align:center;color:#8a94a6;">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
          marginTop: 0.6,
          marginBottom: 0.7,
          marginLeft: 0.5,
          marginRight: 0.5,
        }));
      }
      const buffer = Buffer.from(data, "base64");
      writeFileSync(outputPath, buffer);
      byteLength = buffer.length;
      await page.close();
    });

    if (byteLength === 0) fail("printToPDF 返回空数据");
    log(`[render-pdf] 成功生成 PDF：${outputPath}（${byteLength} 字节）`);
  } finally {
    try {
      rmSync(tempHtml, { force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.stack || err.message : String(err));
});
