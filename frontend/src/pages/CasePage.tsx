import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Icon } from "@/components/Icon";
import { useResearchStore } from "@/store";

const stageCopy: Record<
  string,
  { section: string; input: string; evidence: string[]; metric: string }
> = {
  question: {
    section: "研究问题与评价边界",
    input: "在 AmeR 蛋白质研究示例中，探索兼顾功能表现与结构稳定性的候选方向。",
    evidence: ["研究对象：AmeR（案例演示名）", "目标：功能假设与结构稳定性", "边界：预置模拟数据，不代表真实蛋白实验"],
    metric: "2 项研究目标",
  },
  evidence: {
    section: "文献线索与证据摘要",
    input: "围绕蛋白质突变、功能表型与结构变化整理一组本地模拟证据卡。",
    evidence: ["线索 A · 突变位点与局部相互作用", "线索 B · 表型测定的批次效应", "待验证 · 序列背景与表达条件"],
    metric: "6 条模拟证据",
  },
  route: {
    section: "候选策略比较",
    input: "先选择可解释、可验证的候选路线，再进入计算阶段。",
    evidence: ["路线 A · 单位点优先，便于归因", "路线 B · 组合突变，潜在收益更高", "本轮建议 · 从单点基线开始"],
    metric: "3 条候选路线",
  },
  risk: {
    section: "独立风险评审",
    input: "评审样本量、表达稳定性和测定偏差，保留不确定性说明。",
    evidence: ["中等 · 候选表达量存在批次差异", "低 · 单位点策略可追溯性较高", "缓解 · 设置对照与重复样本"],
    metric: "3 项风险记录",
  },
  simulation: {
    section: "分子动力学 · 预置结果",
    input: "以下趋势图用于展示产物结构，不启动模拟计算。",
    evidence: ["Variant A · 相对稳定性 0.82", "Variant B · 相对稳定性 0.67", "采样时间与指标均为虚构演示值"],
    metric: "120 ns · 模拟样例",
  },
  "evidence-chain": {
    section: "研究产物与来源关系",
    input: "通过阶段事件把问题、评审和模拟材料串联成单一演示证据链。",
    evidence: ["输入快照 · ameR-research-brief-01", "工具轨迹 · local-demo-md-summary", "结论节点 · candidate-route-a"],
    metric: "8 个关联节点",
  },
  experiment: {
    section: "湿实验任务 · 只读回放",
    input: "显示离线模拟的实验任务卡和监测状态，不连接实验室设备。",
    evidence: ["任务 · 样品表达与表型测定", "状态 · 已完成（模拟）", "数据源 · 本地静态演示记录"],
    metric: "4 / 4 · 模拟步骤",
  },
  feedback: {
    section: "结果回流与下一轮假设",
    input: "把虚构的实验读数回写至案例，展示后续研究如何调整。",
    evidence: ["观察 · Variant A 在样例中优于基线", "更新 · 保留稳定性约束", "下一步 · 规划小规模验证（非真实任务）"],
    metric: "1 条模拟迭代",
  },
};

const chartPoints = "0,66 42,56 84,60 126,39 168,47 210,28 252,34 294,18 336,27 378,11";

function formatTime(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CasePage() {
  const data = useResearchStore((state) => state.data);
  const selected = useResearchStore((state) => state.selected);
  const probe = useResearchStore((state) => state.probe);
  const busy = useResearchStore((state) => state.busy);
  const error = useResearchStore((state) => state.error);
  const setSelected = useResearchStore((state) => state.setSelected);
  const refresh = useResearchStore((state) => state.refresh);
  const advance = useResearchStore((state) => state.advance);
  const reset = useResearchStore((state) => state.reset);
  const runProbe = useResearchStore((state) => state.runProbe);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = data?.stages[selected];
  const copy = active ? stageCopy[active.id] : undefined;
  const progressPercent = data
    ? Math.round((data.completed.length / data.stages.length) * 100)
    : 0;
  const eventRows = useMemo(
    () => [...(data?.events ?? [])].reverse().slice(0, 5),
    [data?.events],
  );

  if (!data) {
    return (
      <main className="boot-screen">
        <div className="boot-mark">F</div>
        <p>{error ? "本地工作台暂不可用" : "正在连接本地研究工作台…"}</p>
        {error && (
          <>
            <small>{error}</small>
            <Button className="button button-dark" onClick={() => void refresh()}>
              重试连接
            </Button>
          </>
        )}
      </main>
    );
  }

  return (
    <>
      <section className="case-intro">
        <div className="intro-copy">
          <div className="overline"><span>CASE STUDY</span><span>·</span><span>PROTEIN ENGINEERING</span></div>
          <h1>{data.title}</h1>
          <p>{data.subtitle}</p>
          <div className="intro-tags">
            <span className="simulation-pill"><i />{data.data_label}</span>
            <span className="intro-divider" />
            <span className="updated-label">本地工作区 · 不连接实验设备</span>
          </div>
        </div>
        <div className="intro-aside">
          <div className="case-id">CASE / 2026.09</div>
          <div className="progress-number">{String(data.completed.length).padStart(2, "0")}<span> / 08</span></div>
          <div className="progress-label">研究节点已完成</div>
          <Progress
            value={progressPercent}
            className="progress-track"
            indicatorClassName="progress-indicator"
            aria-label="研究节点完成进度"
          />
          <div className="progress-foot"><span>{progressPercent}% 已完成</span><span>{data.finished ? "全部完成" : "演示进行中"}</span></div>
        </div>
        <div className="molecule-ornament" aria-hidden="true">
          <svg viewBox="0 0 230 200">
            <path d="M44 18c70 26 70 138 142 164M186 18C116 44 116 156 44 182" />
            {[24, 53, 82, 112, 142, 171].map((y, index) => (
              <g key={y}>
                <path d={`M${55 + index * 4} ${y}h${120 - index * 8}`} />
                <circle cx={55 + index * 4} cy={y} r="4" />
                <circle cx={175 - index * 4} cy={y} r="4" />
              </g>
            ))}
          </svg>
        </div>
      </section>

      <section className="stage-section" aria-label="研究阶段">
        <div className="section-heading">
          <div>
            <div className="section-kicker">RESEARCH PATH</div>
            <h2>从假设到验证</h2>
          </div>
          <Button variant="ghost" className="text-button" onClick={() => void reset()} disabled={busy !== null}>
            重新开始 <span>↺</span>
          </Button>
        </div>
        <div className="stage-track">
          {data.stages.map((stage, index) => {
            const complete = data.completed.includes(index);
            const current = !data.finished && data.current_stage === index;
            return (
              <button
                key={stage.id}
                className={`stage-step ${complete ? "is-complete" : ""} ${current ? "is-current" : ""} ${selected === index ? "is-selected" : ""}`}
                onClick={() => setSelected(index)}
                aria-current={selected === index ? "step" : undefined}
              >
                <span className="stage-node">
                  {complete ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, "0")}
                </span>
                <span className="stage-title">{stage.title}</span>
                <span className="stage-state">{complete ? "已完成" : current ? "当前阶段" : "待查看"}</span>
              </button>
            );
          })}
        </div>
      </section>

      {error && (
        <div className="inline-error" role="alert">
          <span>{error}</span>
          <button onClick={() => void refresh()}>重试</button>
        </div>
      )}

      <section className="workspace-grid">
        <div className="primary-column">
          {active && copy && (
            <Card className="brief-card">
              <div className="brief-topline">
                <div className="brief-step">{String(active.index + 1).padStart(2, "0")}</div>
                <div>
                  <div className="section-kicker">{active.eyebrow}</div>
                  <h2>{active.title}</h2>
                </div>
                <span className={`state-label ${active.state}`}>
                  <i />{active.state === "simulated" ? "模拟产物" : "演示阶段"}
                </span>
              </div>
              <p className="brief-summary">{active.summary}</p>
              <div className="brief-block">
                <div className="block-heading"><span>研究输入</span><span>01 / BRIEF</span></div>
                <div className="research-input">{copy.input}</div>
              </div>
              <div className="outputs-heading">
                <span>本阶段产物</span>
                <span className="output-count">{copy.evidence.length} ITEMS</span>
              </div>
              <div className="output-list">
                {copy.evidence.map((item, index) => (
                  <div className="output-row" key={item}>
                    <span className="output-index">{String(index + 1).padStart(2, "0")}</span>
                    <span>{item}</span>
                    <span className="output-check">✓</span>
                  </div>
                ))}
              </div>
              <div className="brief-footer">
                <span><span className="footer-dot" />产物与本地演示记录关联</span>
                {!data.finished && selected === data.current_stage ? (
                  <Button className="button button-dark" onClick={() => void advance()} disabled={busy !== null}>
                    {busy === "advance" ? "正在保存…" : data.current_stage === data.stages.length - 1 ? "完成案例" : "完成并继续"}
                    <Icon name="arrow" size={16} />
                  </Button>
                ) : (
                  <span className="readonly-note">{data.finished ? "案例已完成" : "只读阶段预览"}</span>
                )}
              </div>
            </Card>
          )}

          <Card className="chart-card">
            <div className="chart-header">
              <div>
                <div className="section-kicker">MOLECULAR DYNAMICS / MOCK</div>
                <h3>候选构象稳定性趋势</h3>
              </div>
              <span className="chart-window">0 — 120 ns</span>
            </div>
            <div className="chart-legend">
              <span><i className="legend-a" />Variant A</span>
              <span><i className="legend-b" />Variant B</span>
              <span className="chart-note">仅用于界面演示</span>
            </div>
            <div className="chart">
              <div className="chart-axis">
                <span>1.0</span><span>0.8</span><span>0.6</span><span>0.4</span>
              </div>
              <svg viewBox="0 0 380 120" preserveAspectRatio="none" role="img" aria-label="模拟稳定性趋势折线图">
                {[12, 42, 72, 102].map((y) => <line key={y} x1="0" y1={y} x2="380" y2={y} className="grid-line" />)}
                <polyline points={chartPoints} className="line-a" />
                <polyline points="0,90 42,77 84,83 126,69 168,75 210,61 252,70 294,58 336,67 378,53" className="line-b" />
                <circle cx="378" cy="11" r="4" className="point-a" />
                <circle cx="378" cy="53" r="4" className="point-b" />
              </svg>
            </div>
            <div className="chart-xaxis"><span>0</span><span>30</span><span>60</span><span>90</span><span>120 ns</span></div>
            <div className="chart-footnote">示意数据 · 未运行分子动力学计算 · 数值不构成科研结论</div>
          </Card>
        </div>

        <aside className="secondary-column">
          <Card className="runtime-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">AGENT RUNTIME</div>
                <h3>A3S 本地模型链路</h3>
              </div>
              <span className="runtime-mark">A3S</span>
            </div>
            <p>通过 A3S 会话调用本地固定响应模型，演示路线建议的流式返回。</p>
            <div className="runtime-meta">
              <span>运行时</span><strong>A3S Code Core · 9.1.1</strong>
              <span>响应来源</span><strong>本地 fixture · 无外网</strong>
              <span>工具权限</span><strong>默认拒绝</strong>
            </div>
            <Button variant="outline" className="button button-outline" onClick={() => void runProbe()} disabled={busy !== null}>
              {busy === "probe" ? <><span className="spinner" />正在运行 A3S 会话…</> : "运行模拟路线建议"}
              {busy !== "probe" && <Icon name="arrow" size={15} />}
            </Button>
            {probe && (
              <div className="probe-result" role="status">
                <div className="probe-success"><span>✓</span>A3S 会话已调用本地响应模型</div>
                <div className="probe-tags">{probe.events.map((event, index) => <span key={`${event}-${index}`}>{event}</span>)}</div>
                <pre>{probe.output.trim()}</pre>
                <small>{probe.command} · {probe.model_source} · 模型调用 {probe.fixture_calls} 次 · 工具请求/执行 {probe.tool_requests}/{probe.tool_executions} · 非科研结论</small>
              </div>
            )}
          </Card>

          <Card className="evidence-card">
            <div className="card-heading">
              <div>
                <div className="section-kicker">AUDIT TRAIL</div>
                <h3>最近活动</h3>
              </div>
              <span className="event-count">{data.events.length} EVENTS</span>
            </div>
            <div className="event-list">
              {eventRows.map((event) => (
                <div className="event-row" key={event.id}>
                  <span className={`event-marker ${event.kind.startsWith("a3s") ? "event-a3s" : ""}`} />
                  <div className="event-copy">
                    <strong>{event.title}</strong>
                    <span>{event.detail}</span>
                  </div>
                  <time>{formatTime(event.at)}</time>
                </div>
              ))}
            </div>
            <div className="audit-footer">
              <span>进度保存在本机</span>
              <button onClick={() => void refresh()} disabled={busy !== null}>刷新记录 ↻</button>
            </div>
          </Card>

          <div className="safety-note">
            <span className="safety-icon">i</span>
            <p><strong>演示边界</strong> 本地模拟科研工作流，不连接真实数据库、实验仪器、机械臂或摄像头。</p>
          </div>
        </aside>
      </section>

      <footer className="page-footer">
        <span>FIELDNOTE RESEARCH STUDIO</span>
        <span>LOCAL-FIRST · SIMULATED DATA</span>
        <span>阶段 A / PPT 案例演示</span>
      </footer>
    </>
  );
}
