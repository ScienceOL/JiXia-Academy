//! 只读的本地模拟工具目录（阶段 E）。所有条目均为自造示例，标注 `simulated`，不代表任何真实可用算力或数据源。

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct ToolItem {
    pub id: &'static str,
    pub name: &'static str,
    /// `skill`（分析技能）或 `scp`（计算流程）。
    pub kind: &'static str,
    pub field: &'static str,
    pub purpose: &'static str,
    pub summary: &'static str,
    pub simulated: bool,
}

pub const CATALOG: &[ToolItem] = &[
    ToolItem {
        id: "skill-seq-conservation",
        name: "序列比对与保守性分析",
        kind: "skill",
        field: "蛋白质工程",
        purpose: "序列设计",
        summary: "多重序列比对与保守位点标注（模拟，不执行真实比对）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-structure-fold",
        name: "结构预测（折叠）",
        kind: "skill",
        field: "蛋白质工程",
        purpose: "结构预测",
        summary: "由序列生成候选三维结构的占位流程（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-mutation-score",
        name: "突变效应评分",
        kind: "skill",
        field: "蛋白质工程",
        purpose: "数据分析",
        summary: "对候选突变给出排序分数的模拟评分器。",
        simulated: true,
    },
    ToolItem {
        id: "scp-molecular-docking",
        name: "分子对接计算",
        kind: "scp",
        field: "化学信息学",
        purpose: "结构预测",
        summary: "配体-受体对接的计算流程占位（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-literature-evidence",
        name: "文献证据检索",
        kind: "skill",
        field: "文献情报",
        purpose: "文献检索",
        summary: "按主题梳理公开证据的占位检索技能（模拟，不联网）。",
        simulated: true,
    },
    ToolItem {
        id: "scp-ngs-qc",
        name: "高通量测序质控",
        kind: "scp",
        field: "基因组学",
        purpose: "数据分析",
        summary: "测序数据质量控制的流程占位（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-dashboard-viz",
        name: "数据可视化面板",
        kind: "skill",
        field: "通用",
        purpose: "可视化",
        summary: "将结果表渲染为图表面板的占位技能（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "scp-expression-predict",
        name: "蛋白表达量预测",
        kind: "scp",
        field: "蛋白质工程",
        purpose: "数据分析",
        summary: "预测可溶表达风险的流程占位（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-lab-notebook",
        name: "实验记录模板",
        kind: "skill",
        field: "通用",
        purpose: "实验记录",
        summary: "结构化实验记录模板的占位技能（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "scp-compound-properties",
        name: "化合物性质计算",
        kind: "scp",
        field: "化学信息学",
        purpose: "数据分析",
        summary: "基础理化性质计算的流程占位（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "skill-phylogeny-tree",
        name: "系统发育树构建",
        kind: "skill",
        field: "基因组学",
        purpose: "可视化",
        summary: "由序列构建系统发育树的占位技能（模拟）。",
        simulated: true,
    },
    ToolItem {
        id: "scp-md-simulation",
        name: "分子动力学模拟",
        kind: "scp",
        field: "蛋白质工程",
        purpose: "结构预测",
        summary: "短程分子动力学模拟流程占位（模拟）。",
        simulated: true,
    },
];

/// 目录中的可选筛选项（供前端下拉使用）。
pub fn fields() -> Vec<&'static str> {
    let mut values: Vec<&'static str> = CATALOG.iter().map(|item| item.field).collect();
    values.sort_unstable();
    values.dedup();
    values
}

pub fn purposes() -> Vec<&'static str> {
    let mut values: Vec<&'static str> = CATALOG.iter().map(|item| item.purpose).collect();
    values.sort_unstable();
    values.dedup();
    values
}

pub fn find(id: &str) -> Option<ToolItem> {
    CATALOG.iter().find(|item| item.id == id).cloned()
}

/// 按 `kind` / `field` / `purpose` / 关键词过滤（关键词匹配名称、摘要、领域与用途）。
pub fn filter(
    kind: Option<&str>,
    field: Option<&str>,
    purpose: Option<&str>,
    query: Option<&str>,
) -> Vec<ToolItem> {
    let clean = |value: Option<&str>| -> Option<String> {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let kind = clean(kind);
    let field = clean(field);
    let purpose = clean(purpose);
    let query = clean(query).map(|value| value.to_lowercase());

    CATALOG
        .iter()
        .filter(|item| {
            if let Some(kind) = &kind {
                if item.kind != kind {
                    return false;
                }
            }
            if let Some(field) = &field {
                if item.field != field {
                    return false;
                }
            }
            if let Some(purpose) = &purpose {
                if item.purpose != purpose {
                    return false;
                }
            }
            if let Some(query) = &query {
                let haystack =
                    format!("{} {} {} {}", item.name, item.summary, item.field, item.purpose)
                        .to_lowercase();
                if !haystack.contains(query) {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// 就地排序；`sort` 支持 `name`（默认）、`kind`、`field`。
pub fn sort_items(items: &mut [ToolItem], sort: Option<&str>) {
    match sort.map(str::trim).filter(|value| !value.is_empty()) {
        Some("kind") => items.sort_by(|a, b| (a.kind, a.name).cmp(&(b.kind, b.name))),
        Some("field") => items.sort_by(|a, b| (a.field, a.name).cmp(&(b.field, b.name))),
        _ => items.sort_by(|a, b| a.name.cmp(b.name)),
    }
}
