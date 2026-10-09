use serde::{Deserialize, Serialize};

use crate::util::now;

/// 演示案例的阶段定义（阶段 A 基线，保持不变）。
#[derive(Clone, Serialize)]
pub struct Stage {
    pub id: &'static str,
    pub index: usize,
    pub title: &'static str,
    pub eyebrow: &'static str,
    pub summary: &'static str,
    pub output: &'static str,
    pub state: &'static str,
}

pub fn stages() -> Vec<Stage> {
    [
        (
            "question",
            "定义科学问题",
            "RESEARCH BRIEF",
            "围绕 AmeR 蛋白质研究目标，明确候选突变的功能假设与评价尺度。",
            "问题定义 · 研究目标 · 约束条件",
            "ready",
        ),
        (
            "evidence",
            "深度研究",
            "EVIDENCE REVIEW",
            "整理示意文献、作用机制线索、已有案例与待验证假设。",
            "模拟文献集 · 证据摘要 · 未知项",
            "ready",
        ),
        (
            "route",
            "专家选择路线",
            "ROUTE SELECTION",
            "比较候选策略的预期收益、实验成本和证据强度，形成可解释的路线建议。",
            "路线对比 · 选择理由 · 评审记录",
            "ready",
        ),
        (
            "risk",
            "风险评审",
            "RISK REVIEW",
            "审视表达、稳定性、测定偏差和资源约束，为下一步计算标记风险与缓解方式。",
            "风险清单 · 影响等级 · 缓解措施",
            "ready",
        ),
        (
            "simulation",
            "分子动力学模拟",
            "MD SIMULATION",
            "查看预置的示意稳定性曲线、构象指标和候选排序；此处不执行真实计算。",
            "模拟轨迹 · 稳定性指标 · 候选排序",
            "simulated",
        ),
        (
            "evidence-chain",
            "可信科研证据链",
            "PROVENANCE",
            "把问题、模拟工具输入、评审结论和产物连成可追溯的演示记录。",
            "事件记录 · 产物索引 · 来源标签",
            "simulated",
        ),
        (
            "experiment",
            "湿实验任务与监测",
            "LAB TASK · MOCK",
            "浏览虚构的实验任务和历史监测画面；没有实验室设备或控制接口连接。",
            "模拟任务卡 · 只读状态 · 回放画面",
            "simulated",
        ),
        (
            "feedback",
            "结果回流与迭代",
            "ITERATION",
            "将模拟实验结果回收到下一轮研究记录，呈现假设更新和迭代关系。",
            "模拟结果 · 假设变化 · 下一轮建议",
            "simulated",
        ),
    ]
    .into_iter()
    .enumerate()
    .map(
        |(index, (id, title, eyebrow, summary, output, state))| Stage {
            id,
            index,
            title,
            eyebrow,
            summary,
            output,
            state,
        },
    )
    .collect()
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: u64,
    pub at: i64,
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub stage: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CaseProgress {
    pub current_stage: usize,
    pub completed: Vec<usize>,
    pub finished: bool,
    pub next_event_id: u64,
    pub events: Vec<AuditEvent>,
}

impl Default for CaseProgress {
    fn default() -> Self {
        Self {
            current_stage: 0,
            completed: Vec::new(),
            finished: false,
            next_event_id: 2,
            events: vec![AuditEvent {
                id: 1,
                at: now(),
                kind: "case.created".into(),
                title: "演示案例已载入".into(),
                detail: "AmeR 蛋白质定向进化 · 全部科研数据为模拟内容".into(),
                stage: Some(0),
            }],
        }
    }
}

#[derive(Serialize)]
pub struct CaseResponse {
    pub id: &'static str,
    pub title: &'static str,
    pub subtitle: &'static str,
    pub data_label: &'static str,
    pub current_stage: usize,
    pub completed: Vec<usize>,
    pub finished: bool,
    pub stages: Vec<Stage>,
    pub events: Vec<AuditEvent>,
}

pub fn response(progress: &CaseProgress) -> CaseResponse {
    CaseResponse {
        id: "amer-protein-evolution",
        title: "AmeR 蛋白质定向进化",
        subtitle: "从科学假设到实验反馈的可追溯研究流程",
        data_label: "演示数据 · 非真实研究结论",
        current_stage: progress.current_stage,
        completed: progress.completed.clone(),
        finished: progress.finished,
        stages: stages(),
        events: progress.events.clone(),
    }
}

pub fn push_event(
    progress: &mut CaseProgress,
    kind: &str,
    title: &str,
    detail: &str,
    stage: Option<usize>,
) {
    let id = progress.next_event_id;
    progress.next_event_id += 1;
    progress.events.push(AuditEvent {
        id,
        at: now(),
        kind: kind.into(),
        title: title.into(),
        detail: detail.into(),
        stage,
    });
}
