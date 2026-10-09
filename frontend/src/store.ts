import { create } from "zustand";
import type {
  AgentProbe,
  BusyState,
  CaseResponse,
  CitationReport,
  PaperKind,
  PaperRecord,
  PaperTabKey,
  PdfDemo,
  WorkspaceKey,
} from "./types";

const demoPapers: PaperRecord[] = [
  {
    id: "FN-DEMO-001",
    title: "A fictional reading list for protein-function studies",
    authors: "Fieldnote Demo Group",
    year: 2025,
    kind: "review",
    topic: "protein function",
    abstract:
      "A synthetic record used to demonstrate search filters and reading workflows. It is not a published paper or a verified scientific source.",
  },
  {
    id: "FN-DEMO-002",
    title: "Illustrative stability signals in a toy protein benchmark",
    authors: "Fieldnote Sample Lab",
    year: 2024,
    kind: "research",
    topic: "protein stability",
    abstract:
      "A fictional experimental-design example for interface testing. Values and conclusions are fabricated and must not be used as research evidence.",
  },
  {
    id: "FN-DEMO-003",
    title: "Evidence mapping with deliberately incomplete abstracts",
    authors: "Fieldnote Demo Group",
    year: 2023,
    kind: "review",
    topic: "evidence review",
    abstract:
      "This simulated review record demonstrates uncertainty labels, missing metadata, and citation provenance in a local-only paper workspace.",
  },
  {
    id: "FN-DEMO-004",
    title: "A mock comparison of candidate-route summaries",
    authors: "Fieldnote Sample Lab",
    year: 2022,
    kind: "research",
    topic: "AmeR route",
    abstract:
      "A synthetic record connected to the AmeR case-study demonstration. The title, authors, venue, and research claims are illustrative only.",
  },
];

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(body?.error ?? `请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}

type ResearchStore = {
  data: CaseResponse | null;
  selected: number;
  probe: AgentProbe | null;
  busy: BusyState;
  error: string;
  workspace: WorkspaceKey;
  paperTab: PaperTabKey;
  paperQuery: string;
  paperYear: string;
  paperKind: "all" | PaperKind;
  paperResults: PaperRecord[];
  selectedPaperId: string | null;
  paperSearchState: "idle" | "loading" | "done" | "error";
  paperSearchMessage: string;
  pdfDemo: PdfDemo | null;
  pdfError: string;
  pdfValidating: boolean;
  pdfReading: boolean;
  pdfReady: boolean;
  citationMode: "existence" | "consistency";
  citationInput: string;
  sourceExcerpt: string;
  claimInput: string;
  citationReport: CitationReport | null;
  citationError: string;
  setSelected: (selected: number) => void;
  setWorkspace: (workspace: WorkspaceKey) => void;
  setPaperTab: (paperTab: PaperTabKey) => void;
  setPaperQuery: (paperQuery: string) => void;
  setPaperYear: (paperYear: string) => void;
  setPaperKind: (paperKind: "all" | PaperKind) => void;
  setSelectedPaperId: (id: string | null) => void;
  searchPapers: () => Promise<void>;
  selectPdf: (file: File | null) => Promise<void>;
  runPdfDemo: () => Promise<void>;
  clearPdf: () => void;
  setCitationMode: (mode: "existence" | "consistency") => void;
  setCitationInput: (value: string) => void;
  setSourceExcerpt: (value: string) => void;
  setClaimInput: (value: string) => void;
  loadCitationExample: () => void;
  runCitationCheck: () => Promise<void>;
  refresh: () => Promise<void>;
  advance: () => Promise<void>;
  reset: () => Promise<void>;
  runProbe: () => Promise<void>;
};

export const useResearchStore = create<ResearchStore>((set, get) => ({
  data: null,
  selected: 0,
  probe: null,
  busy: null,
  error: "",
  workspace: "case",
  paperTab: "search",
  paperQuery: "",
  paperYear: "all",
  paperKind: "all",
  paperResults: [],
  selectedPaperId: null,
  paperSearchState: "idle",
  paperSearchMessage: "",
  pdfDemo: null,
  pdfError: "",
  pdfValidating: false,
  pdfReading: false,
  pdfReady: false,
  citationMode: "existence",
  citationInput: "",
  sourceExcerpt: "",
  claimInput: "",
  citationReport: null,
  citationError: "",
  setSelected: (selected) => set({ selected }),
  setWorkspace: (workspace) => set({ workspace }),
  setPaperTab: (paperTab) => set({ paperTab }),
  setPaperQuery: (paperQuery) =>
    set({ paperQuery, paperSearchState: "idle", paperSearchMessage: "" }),
  setPaperYear: (paperYear) => set({ paperYear }),
  setPaperKind: (paperKind) => set({ paperKind }),
  setSelectedPaperId: (selectedPaperId) => set({ selectedPaperId }),
  searchPapers: async () => {
    const { paperQuery, paperYear, paperKind } = get();
    const query = paperQuery.trim().toLocaleLowerCase();
    if (!query) {
      set({
        paperSearchState: "error",
        paperSearchMessage: "先输入主题、关键词或研究对象。",
        paperResults: [],
      });
      return;
    }
    set({ paperSearchState: "loading", paperSearchMessage: "", paperResults: [] });
    await delay(320);
    const results = demoPapers.filter((paper) => {
      const matchesQuery = `${paper.title} ${paper.authors} ${paper.topic} ${paper.abstract}`
        .toLocaleLowerCase()
        .includes(query);
      const matchesYear = paperYear === "all" || String(paper.year) === paperYear;
      const matchesKind = paperKind === "all" || paper.kind === paperKind;
      return matchesQuery && matchesYear && matchesKind;
    });
    set({
      paperResults: results,
      paperSearchState: "done",
      paperSearchMessage: results.length
        ? `本地演示索引匹配 ${results.length} 条，不代表真实数据库检索。`
        : "演示索引中没有匹配项；可尝试 protein、stability、evidence 或 AmeR。",
    });
  },
  selectPdf: async (file) => {
    if (!file) return;
    const isPdfName = file.name.toLocaleLowerCase().endsWith(".pdf");
    const hasAllowedType = !file.type || file.type === "application/pdf";
    if (!isPdfName || !hasAllowedType) {
      set({
        pdfDemo: null,
        pdfValidating: false,
        pdfReady: false,
        pdfError: "文件类型不匹配。请选择扩展名为 .pdf 的 PDF 文件。",
      });
      return;
    }
    if (file.size === 0) {
      set({
        pdfDemo: null,
        pdfValidating: false,
        pdfReady: false,
        pdfError: "文件为空，无法进入演示流程。",
      });
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      set({
        pdfDemo: null,
        pdfValidating: false,
        pdfReady: false,
        pdfError: "文件超过 20 MiB 上限；本地演示不接受该文件。",
      });
      return;
    }
    set({ pdfDemo: null, pdfValidating: true, pdfError: "", pdfReady: false });
    try {
      const signature = await file.slice(0, 5).text();
      if (signature !== "%PDF-") {
        set({
          pdfDemo: null,
          pdfValidating: false,
          pdfReady: false,
          pdfError: "文件头不符合 PDF 格式；本地只检查开头 5 个字节，不读取正文。",
        });
        return;
      }
      set({
        pdfDemo: { name: file.name, size: file.size },
        pdfValidating: false,
        pdfError: "",
        pdfReady: false,
      });
    } catch {
      set({
        pdfDemo: null,
        pdfValidating: false,
        pdfReady: false,
        pdfError: "无法在浏览器本地校验该文件。",
      });
    }
  },
  runPdfDemo: async () => {
    if (!get().pdfDemo) {
      set({ pdfError: "请先选择一个符合限制的 PDF 文件。" });
      return;
    }
    set({ pdfReading: true, pdfError: "", pdfReady: false });
    await delay(450);
    set({ pdfReading: false, pdfReady: true });
  },
  clearPdf: () =>
    set({
      pdfDemo: null,
      pdfError: "",
      pdfValidating: false,
      pdfReady: false,
      pdfReading: false,
    }),
  setCitationMode: (citationMode) =>
    set({ citationMode, citationReport: null, citationError: "" }),
  setCitationInput: (citationInput) =>
    set({ citationInput, citationReport: null, citationError: "" }),
  setSourceExcerpt: (sourceExcerpt) =>
    set({ sourceExcerpt, citationReport: null, citationError: "" }),
  setClaimInput: (claimInput) =>
    set({ claimInput, citationReport: null, citationError: "" }),
  loadCitationExample: () =>
    set({
      citationInput: "FN-DEMO-001",
      sourceExcerpt:
        "In this fictional benchmark, variant A shows a higher illustrative stability score than variant B.",
      claimInput:
        "The demo presents variant A with a higher illustrative stability score than variant B.",
      citationReport: null,
      citationError: "",
    }),
  runCitationCheck: async () => {
    const { citationMode, citationInput, sourceExcerpt, claimInput } = get();
    if (citationMode === "existence" && !citationInput.trim()) {
      set({ citationError: "请输入演示记录 ID 或完整题名。" });
      return;
    }
    if (
      citationMode === "consistency" &&
      (!sourceExcerpt.trim() || !claimInput.trim())
    ) {
      set({ citationError: "请同时填写来源片段和待核验观点。" });
      return;
    }
    set({ citationError: "", citationReport: null });
    await delay(280);
    if (citationMode === "existence") {
      const needle = citationInput.trim().toLocaleLowerCase();
      const match = demoPapers.find(
        (paper) =>
          paper.id.toLocaleLowerCase() === needle ||
          paper.title.toLocaleLowerCase() === needle,
      );
      set({
        citationReport: match
          ? {
              mode: "existence",
              verdict: "命中 1 条本地演示索引",
              confidence: "仅确认夹具中存在该记录",
              evidence: [`演示 ID：${match.id}`, `题名：${match.title}`, `年份：${match.year}`],
              uncertainty:
                "这不是对真实论文、DOI、出版信息或学术数据库的存在性核验。",
            }
          : {
              mode: "existence",
              verdict: "无法在本地演示索引中确认",
              confidence: "证据不足",
              evidence: ["未找到与输入完全匹配的演示 ID 或题名。"],
              uncertainty:
                "未命中不代表论文不存在；本流程没有访问外部学术数据库。",
            },
      });
      return;
    }

    const tokens = (value: string) =>
      value
        .toLocaleLowerCase()
        .match(/[a-z0-9]{3,}|[\u4e00-\u9fff]{2,}/g) ?? [];
    const sourceTokens = new Set(tokens(sourceExcerpt));
    const shared = [...new Set(tokens(claimInput))].filter((token) =>
      sourceTokens.has(token),
    );
    const ratio = shared.length / Math.max(new Set(tokens(claimInput)).size, 1);
    set({
      citationReport: {
        mode: "consistency",
        verdict: ratio >= 0.55 ? "演示规则判为部分支持" : "无法确认观点一致",
        confidence: "基于字面关键词重合的低可信度提示",
        evidence: shared.length
          ? [`重合词：${shared.slice(0, 8).join("、")}`]
          : ["没有检测到足够的字面关键词重合。"],
        uncertainty:
          "该结果由本地词面规则生成，不理解语义、上下文、否定或论证有效性；不能视为真实引文核验。",
      },
    });
  },
  refresh: async () => {
    set({ busy: "load", error: "" });
    try {
      const data = await request<CaseResponse>("/api/case");
      set((state) => ({
        data,
        selected: state.data
          ? Math.min(state.selected, data.stages.length - 1)
          : data.current_stage,
      }));
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "无法连接本地服务" });
    } finally {
      set({ busy: null });
    }
  },
  advance: async () => {
    set({ busy: "advance", error: "" });
    try {
      const data = await request<CaseResponse>("/api/case/advance", {
        method: "POST",
      });
      set({ data, selected: data.current_stage });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "阶段推进失败" });
    } finally {
      set({ busy: null });
    }
  },
  reset: async () => {
    set({ busy: "reset", error: "" });
    try {
      const data = await request<CaseResponse>("/api/case/reset", {
        method: "POST",
      });
      set({ data, selected: 0, probe: null });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "无法重置案例" });
    } finally {
      set({ busy: null });
    }
  },
  runProbe: async () => {
    set({ busy: "probe", error: "" });
    try {
      const probe = await request<AgentProbe>("/api/agent/probe", {
        method: "POST",
      });
      const data = await request<CaseResponse>("/api/case");
      set({ probe, data });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : "A3S 自检失败" });
    } finally {
      set({ busy: null });
    }
  },
}));
