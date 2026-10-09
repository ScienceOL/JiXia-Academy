import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useResearchStore } from "@/store";
import type { PaperTabKey } from "@/types";

const tabs: { id: PaperTabKey; number: string; title: string; subtitle: string }[] = [
  { id: "search", number: "01", title: "文献检索", subtitle: "LOCAL INDEX" },
  { id: "reading", number: "02", title: "PDF 精读", subtitle: "BROWSER ONLY" },
  { id: "citation", number: "03", title: "引文核验", subtitle: "DEMO CHECK" },
];

const quickTopics = ["protein", "stability", "evidence", "AmeR"];

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function PaperTools() {
  const fileInput = useRef<HTMLInputElement>(null);
  const paperTab = useResearchStore((state) => state.paperTab);
  const setPaperTab = useResearchStore((state) => state.setPaperTab);
  const paperQuery = useResearchStore((state) => state.paperQuery);
  const setPaperQuery = useResearchStore((state) => state.setPaperQuery);
  const paperYear = useResearchStore((state) => state.paperYear);
  const setPaperYear = useResearchStore((state) => state.setPaperYear);
  const paperKind = useResearchStore((state) => state.paperKind);
  const setPaperKind = useResearchStore((state) => state.setPaperKind);
  const paperResults = useResearchStore((state) => state.paperResults);
  const selectedPaperId = useResearchStore((state) => state.selectedPaperId);
  const setSelectedPaperId = useResearchStore((state) => state.setSelectedPaperId);
  const paperSearchState = useResearchStore((state) => state.paperSearchState);
  const paperSearchMessage = useResearchStore((state) => state.paperSearchMessage);
  const searchPapers = useResearchStore((state) => state.searchPapers);
  const pdfDemo = useResearchStore((state) => state.pdfDemo);
  const pdfError = useResearchStore((state) => state.pdfError);
  const pdfValidating = useResearchStore((state) => state.pdfValidating);
  const pdfReading = useResearchStore((state) => state.pdfReading);
  const pdfReady = useResearchStore((state) => state.pdfReady);
  const selectPdf = useResearchStore((state) => state.selectPdf);
  const runPdfDemo = useResearchStore((state) => state.runPdfDemo);
  const clearPdf = useResearchStore((state) => state.clearPdf);
  const citationMode = useResearchStore((state) => state.citationMode);
  const setCitationMode = useResearchStore((state) => state.setCitationMode);
  const citationInput = useResearchStore((state) => state.citationInput);
  const setCitationInput = useResearchStore((state) => state.setCitationInput);
  const sourceExcerpt = useResearchStore((state) => state.sourceExcerpt);
  const setSourceExcerpt = useResearchStore((state) => state.setSourceExcerpt);
  const claimInput = useResearchStore((state) => state.claimInput);
  const setClaimInput = useResearchStore((state) => state.setClaimInput);
  const citationReport = useResearchStore((state) => state.citationReport);
  const citationError = useResearchStore((state) => state.citationError);
  const loadCitationExample = useResearchStore((state) => state.loadCitationExample);
  const runCitationCheck = useResearchStore((state) => state.runCitationCheck);

  const chooseTab = (tab: PaperTabKey) => setPaperTab(tab);

  return (
    <section className="paper-workspace" aria-labelledby="paper-tools-title">
      <header className="paper-hero">
        <div className="paper-hero-copy">
          <div className="paper-eyebrow"><span>FIELDNOTE / LITERATURE DESK</span><span>MODULE 02</span></div>
          <h1 id="paper-tools-title">论文工具</h1>
          <p>从发现线索，到阅读与核对。此工作台当前使用本地模拟索引和演示规则。</p>
          <div className="paper-demo-notice"><span aria-hidden="true">i</span>演示模式 · 不连接学术数据库 · 不构成文献事实核验</div>
        </div>
        <div className="paper-hero-index" aria-hidden="true">
          <span>FIELDNOTE</span>
          <strong>READ<br />WITH<br />CARE.</strong>
          <i>LOCAL / 02</i>
        </div>
      </header>

      <nav className="paper-tabs" role="tablist" aria-label="论文工具功能">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`paper-tab-${tab.id}`}
            className={`paper-tab ${paperTab === tab.id ? "is-active" : ""}`}
            role="tab"
            type="button"
            aria-selected={paperTab === tab.id}
            aria-controls="paper-tab-panel"
            onClick={() => chooseTab(tab.id)}
          >
            <span className="paper-tab-number">{tab.number}</span>
            <span className="paper-tab-copy"><strong>{tab.title}</strong><small>{tab.subtitle}</small></span>
            <span className="paper-tab-arrow" aria-hidden="true">↗</span>
          </button>
        ))}
      </nav>

      <div
        id="paper-tab-panel"
        className="paper-panel"
        role="tabpanel"
        aria-labelledby={`paper-tab-${paperTab}`}
        tabIndex={0}
      >
        {paperTab === "search" && (
          <div className="paper-search-layout">
            <div className="paper-main-column">
              <Card className="paper-search-card">
                <div className="paper-section-head">
                  <div><span className="paper-kicker">SEARCH THE DEMO INDEX</span><h2>从一个问题开始</h2></div>
                  <span className="paper-source-stamp">FIXTURE / 04 RECORDS</span>
                </div>
                <form
                  className="paper-search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchPapers();
                  }}
                >
                  <label className="visually-hidden" htmlFor="paper-query">主题、关键词或研究对象</label>
                  <input
                    id="paper-query"
                    value={paperQuery}
                    onChange={(event) => setPaperQuery(event.target.value)}
                    placeholder="输入主题、关键词或研究对象"
                    autoComplete="off"
                  />
                  <Button className="paper-search-button" type="submit" disabled={paperSearchState === "loading"}>
                    {paperSearchState === "loading" ? "检索中…" : "检索演示索引"}
                    <span aria-hidden="true">→</span>
                  </Button>
                </form>
                <div className="paper-filters">
                  <label>年份
                    <select value={paperYear} onChange={(event) => setPaperYear(event.target.value)}>
                      <option value="all">全部年份</option>
                      {[2025, 2024, 2023, 2022].map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                  <label>条目类型
                    <select value={paperKind} onChange={(event) => setPaperKind(event.target.value as "all" | "research" | "review")}>
                      <option value="all">全部类型</option>
                      <option value="research">研究样例</option>
                      <option value="review">综述样例</option>
                    </select>
                  </label>
                  <div className="paper-quick-topics" aria-label="示例检索词">
                    {quickTopics.map((topic) => (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => {
                          setPaperQuery(topic);
                          void searchPapers();
                        }}
                      >{topic}</button>
                    ))}
                  </div>
                </div>
              </Card>

              <div className="paper-results-heading">
                <div><span className="paper-kicker">LOCAL RESULTS</span><h2>演示索引</h2></div>
                <span>{paperResults.length ? `${paperResults.length} 条` : "等待检索"}</span>
              </div>
              <div className="paper-results" aria-live="polite">
                {paperSearchState === "idle" && (
                  <Card className="paper-empty-state">
                    <span className="paper-empty-mark">01—04</span>
                    <h3>先从示例关键词试起</h3>
                    <p>所有条目均为虚构的界面夹具，没有真实作者、期刊或 DOI。</p>
                    <div className="paper-empty-topics">{quickTopics.map((topic) => <span key={topic}>{topic}</span>)}</div>
                  </Card>
                )}
                {paperSearchState === "loading" && (
                  <Card className="paper-empty-state paper-loading" role="status">
                    <span className="paper-spinner" aria-hidden="true" />
                    <h3>正在筛选本地演示索引</h3>
                    <p>没有发送网络请求。</p>
                  </Card>
                )}
                {paperSearchState === "error" && (
                  <Card className="paper-empty-state paper-error-state" role="alert">
                    <h3>检索条件不完整</h3><p>{paperSearchMessage}</p>
                  </Card>
                )}
                {paperSearchState === "done" && (
                  <>
                    <p className="paper-search-message">{paperSearchMessage}</p>
                    {paperResults.map((paper, index) => {
                      const expanded = selectedPaperId === paper.id;
                      return (
                        <Card className={`paper-result-card ${expanded ? "is-expanded" : ""}`} key={paper.id}>
                          <div className="paper-result-index">{String(index + 1).padStart(2, "0")}</div>
                          <div className="paper-result-body">
                            <div className="paper-result-meta"><span>{paper.year}</span><span>{paper.kind === "review" ? "综述样例" : "研究样例"}</span><span>模拟条目</span></div>
                            <h3>{paper.title}</h3>
                            <p className="paper-authors">{paper.authors} <span>·</span> {paper.topic}</p>
                            {expanded && <p className="paper-abstract">{paper.abstract}</p>}
                            <div className="paper-result-footer">
                              <code>{paper.id}</code>
                              <button
                                type="button"
                                aria-expanded={expanded}
                                onClick={() => setSelectedPaperId(expanded ? null : paper.id)}
                              >{expanded ? "收起条目" : "查看条目"} <span aria-hidden="true">↗</span></button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                    {paperResults.length === 0 && (
                      <Card className="paper-empty-state paper-error-state">
                        <span className="paper-empty-mark">NO MATCH</span>
                        <h3>这组条件没有命中</h3>
                        <p>{paperSearchMessage}</p>
                      </Card>
                    )}
                  </>
                )}
              </div>
            </div>
            <aside className="paper-side-column">
              <Card className="paper-side-note">
                <span className="paper-kicker">SCOPE NOTE</span>
                <h3>这是检索交互样例，不是文献服务。</h3>
                <p>结果仅从随前端打包的 4 条虚构记录筛选。不要将条目、作者、年份或摘要用于论文引用。</p>
                <div className="paper-side-rule" />
                <span className="paper-side-index">SOURCE / LOCAL FIXTURE</span>
              </Card>
              <Card className="paper-mini-guide">
                <span className="paper-kicker">NEXT STEPS</span>
                <ol><li>筛选演示条目</li><li>选择本地 PDF</li><li>检查引文边界</li></ol>
                <button type="button" onClick={() => chooseTab("reading")}>进入 PDF 精读 <span aria-hidden="true">→</span></button>
              </Card>
            </aside>
          </div>
        )}

        {paperTab === "reading" && (
          <div className="paper-reading-layout">
            <div className="paper-main-column">
              <Card className="paper-search-card">
                <div className="paper-section-head">
                  <div><span className="paper-kicker">LOCAL FILE / PDF</span><h2>选择一份阅读样例</h2></div>
                  <span className="paper-source-stamp">MAX / 20 MiB</span>
                </div>
                <label className="pdf-dropzone" htmlFor="paper-pdf-input">
                  <span className="pdf-drop-icon" aria-hidden="true">PDF</span>
                  <strong>从本机选择 PDF</strong>
                  <span>校验文件名、类型、大小及开头 5 字节；不上传、不解析正文。</span>
                  <small>PDF · 最大 20 MiB</small>
                  <input
                    ref={fileInput}
                    id="paper-pdf-input"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={(event) => {
                      void selectPdf(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {pdfError && <p className="paper-inline-error" role="alert">{pdfError}</p>}
                {pdfDemo && (
                  <div className="pdf-file-row">
                    <span className="pdf-file-badge">PDF</span>
                    <div><strong>{pdfDemo.name}</strong><small>{formatBytes(pdfDemo.size)} · 仅本机元信息</small></div>
                    <button type="button" onClick={clearPdf} aria-label="移除所选文件">移除</button>
                  </div>
                )}
                <div className="pdf-action-row">
                  <p>精读面板将显示固定示例结构，与所选文件内容无关。</p>
                  <Button className="paper-search-button" onClick={() => void runPdfDemo()} disabled={!pdfDemo || pdfReading || pdfValidating}>
                    {pdfValidating ? "校验 PDF 文件头…" : pdfReading ? "准备演示视图…" : "生成模拟精读视图"} <span aria-hidden="true">→</span>
                  </Button>
                </div>
              </Card>
              {!pdfReady && (
                <Card className="paper-empty-state pdf-placeholder">
                  <span className="paper-empty-mark">READING ROOM</span>
                  <h3>等待本地文件</h3>
                  <p>选中文件后可打开一份通用精读演示。此功能尚未解析 PDF 文本、图表或参考文献。</p>
                </Card>
              )}
              {pdfReady && pdfDemo && (
                <Card className="pdf-reading-result" aria-live="polite">
                  <div className="pdf-result-top"><div><span className="paper-kicker">SIMULATED READING VIEW</span><h2>{pdfDemo.name}</h2></div><span className="paper-demo-stamp">非文件解析结果</span></div>
                  <p className="pdf-reading-warning">以下内容为固定的通用示例，与所选 PDF 正文无关；文件未上传，也未被读取。</p>
                  <div className="pdf-outline">
                    <article><span>01 / QUESTION</span><h3>研究问题</h3><p>此处展示研究问题摘要的版式，不包含用户文档内容。</p></article>
                    <article><span>02 / METHOD</span><h3>方法线索</h3><p>此处展示方法卡片的版式；没有执行文档抽取或科学分析。</p></article>
                    <article><span>03 / LIMITATION</span><h3>局限与待核对</h3><p>请使用实际文献原文人工核验结论、数据、引用与上下文。</p></article>
                  </div>
                </Card>
              )}
            </div>
            <aside className="paper-side-column">
              <Card className="paper-side-note">
                <span className="paper-kicker">PRIVACY BY DEFAULT</span>
                <h3>文件留在浏览器一侧。</h3>
                <p>阶段 B 校验文件名、MIME、字节数和开头 5 字节的 PDF 签名。没有网络上传、持久化或正文解析。</p>
                <div className="pdf-limit-list"><span><b>01</b> 必须为 PDF</span><span><b>02</b> 非空文件</span><span><b>03</b> 不超过 20 MiB</span></div>
              </Card>
              <Card className="paper-mini-guide">
                <span className="paper-kicker">READER STATUS</span>
                <p className="reader-status"><i className={pdfReady ? "is-ready" : ""} />{pdfReady ? "示例视图已打开" : pdfDemo ? "文件已校验，等待打开" : "尚未选择文件"}</p>
                <button type="button" onClick={() => chooseTab("citation")}>继续到引文核验 <span aria-hidden="true">→</span></button>
              </Card>
            </aside>
          </div>
        )}

        {paperTab === "citation" && (
          <div className="paper-citation-layout">
            <div className="paper-main-column">
              <Card className="paper-search-card">
                <div className="paper-section-head">
                  <div><span className="paper-kicker">CHECK THE BOUNDARY</span><h2>引文核验演示</h2></div>
                  <span className="paper-source-stamp">NO EXTERNAL SOURCES</span>
                </div>
                <div className="citation-mode-switch" role="group" aria-label="选择核验方式">
                  <button type="button" className={citationMode === "existence" ? "is-active" : ""} onClick={() => setCitationMode("existence")} aria-pressed={citationMode === "existence"}><span>01</span>存在性</button>
                  <button type="button" className={citationMode === "consistency" ? "is-active" : ""} onClick={() => setCitationMode("consistency")} aria-pressed={citationMode === "consistency"}><span>02</span>观点一致性</button>
                </div>
                {citationMode === "existence" ? (
                  <div className="citation-form">
                    <label htmlFor="citation-input">演示条目 ID 或完整题名</label>
                    <textarea
                      id="citation-input"
                      rows={4}
                      value={citationInput}
                      onChange={(event) => setCitationInput(event.target.value)}
                      placeholder="例如：FN-DEMO-001 或完整题名"
                    />
                    <p>本地仅匹配虚构夹具的 ID 或完整题名；不访问 Crossref、PubMed 或其他服务。</p>
                  </div>
                ) : (
                  <div className="citation-form citation-pair">
                    <label htmlFor="citation-source">来源文本片段</label>
                    <textarea id="citation-source" rows={3} value={sourceExcerpt} onChange={(event) => setSourceExcerpt(event.target.value)} placeholder="粘贴待对照的原文片段" />
                    <label htmlFor="citation-claim">待核验观点</label>
                    <textarea id="citation-claim" rows={3} value={claimInput} onChange={(event) => setClaimInput(event.target.value)} placeholder="粘贴论文中的转述或观点" />
                    <p>演示只计算字面关键词重合，不进行语义理解、上下文判断或来源认证。</p>
                  </div>
                )}
                {citationError && <p className="paper-inline-error" role="alert">{citationError}</p>}
                <div className="citation-actions">
                  <button type="button" onClick={loadCitationExample}>载入示例输入</button>
                  <Button className="paper-search-button" onClick={() => void runCitationCheck()}>运行本地演示核验 <span aria-hidden="true">→</span></Button>
                </div>
              </Card>
              {citationReport ? (
                <Card className="citation-report" aria-live="polite">
                  <div className="citation-report-head">
                    <div><span className="paper-kicker">DEMO REPORT / {citationReport.mode === "existence" ? "EXISTENCE" : "CONSISTENCY"}</span><h2>{citationReport.verdict}</h2></div>
                    <span className="paper-demo-stamp">模拟判断</span>
                  </div>
                  <p className="citation-confidence">{citationReport.confidence}</p>
                  <div className="citation-evidence"><strong>本地依据</strong>{citationReport.evidence.map((item) => <span key={item}>{item}</span>)}</div>
                  <div className="citation-uncertainty"><strong>不确定性</strong><p>{citationReport.uncertainty}</p></div>
                </Card>
              ) : (
                <Card className="paper-empty-state citation-placeholder">
                  <span className="paper-empty-mark">REPORT / —</span>
                  <h3>核验结果会列明边界</h3>
                  <p>载入样例可以快速体验两类报告。所有判断均来自本地演示规则，不可作为学术引用结论。</p>
                </Card>
              )}
            </div>
            <aside className="paper-side-column">
              <Card className="paper-side-note">
                <span className="paper-kicker">TWO DIFFERENT QUESTIONS</span>
                <h3>“记录存在”不等于“观点成立”。</h3>
                <p>存在性仅检查本地模拟索引；观点一致性仅呈现词面重合提示。两者都不确认论文真实性或原文语义。</p>
                <div className="citation-key"><span><i className="key-existence" />存在性</span><span><i className="key-consistency" />观点一致性</span></div>
              </Card>
              <Card className="paper-mini-guide">
                <span className="paper-kicker">AUDIT NOTE</span>
                <p>正式核验需要可信文献源、原文上下文和可复现的证据记录。</p>
                <span className="paper-side-index">STATUS / SIMULATED</span>
              </Card>
            </aside>
          </div>
        )}
      </div>
      <footer className="paper-footer">
        <span>FIELDNOTE LITERATURE DESK</span>
        <span>LOCAL FIXTURES ONLY</span>
        <span>02 / RESEARCH TOOLS</span>
      </footer>
    </section>
  );
}
