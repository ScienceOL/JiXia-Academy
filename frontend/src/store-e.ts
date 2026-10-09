/**
 * 阶段 E：认证、课题空间与对话的本地状态（Zustand）。
 * 所有数据来自本机 127.0.0.1:8081 的模拟后端；回复为本地模板，非 AI 推理、不联网。
 */

import { create } from "zustand";
import { api, ApiRequestError, getToken, onUnauthorized, setToken } from "./lib/api";
import type {
  AuthResponse,
  ChatMode,
  Conversation,
  ConversationDetail,
  ConversationSummary,
  DocumentMeta,
  MessageExchange,
  SessionUser,
  Subject,
  SubjectToolItem,
  ToolItem,
  ToolListResponse,
  ToolQuery,
  WorkspaceSummary,
} from "./types";

/** 模型选择器为占位项：仅记录取值，不改变回复来源，也不声称可实际调用。 */
export const MODEL_OPTIONS: { id: string; label: string }[] = [
  { id: "auto", label: "Auto · 自动（占位）" },
  { id: "reasoning-preview", label: "推理预览（占位）" },
  { id: "fast-preview", label: "快速预览（占位）" },
];

export const FIELD_OPTIONS = [
  "蛋白质工程",
  "基因组学",
  "化学信息学",
  "文献情报",
  "通用",
];

export const EXAMPLE_QUESTIONS = [
  "如何为一个突变候选设计可解释的验证路线？",
  "把当前课题的知识库文件整理成证据清单。",
  "列出这个方向主要的不确定性来源。",
];

export const EMPTY_TOOL_QUERY: ToolQuery = {
  kind: "",
  q: "",
  field: "",
  purpose: "",
  sort: "name",
};

// ---------------------------------------------------------------------------
// 认证
// ---------------------------------------------------------------------------

type AuthState = {
  status: "loading" | "anon" | "authed";
  user: SessionUser | null;
  error: string;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (
    email: string,
    displayName: string,
    password: string,
  ) => Promise<boolean>;
  logout: () => Promise<void>;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "loading",
  user: null,
  error: "",
  bootstrap: async () => {
    if (!getToken()) {
      set({ status: "anon", user: null });
      return;
    }
    try {
      const user = await api<SessionUser>("/api/auth/me");
      set({ status: "authed", user, error: "" });
    } catch {
      setToken(null);
      set({ status: "anon", user: null });
    }
  },
  login: async (email, password) => {
    set({ error: "" });
    try {
      const result = await api<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(result.token);
      set({ status: "authed", user: result.user, error: "" });
      return true;
    } catch (cause) {
      set({ error: messageOf(cause, "登录失败") });
      return false;
    }
  },
  register: async (email, displayName, password) => {
    set({ error: "" });
    try {
      const result = await api<AuthResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          display_name: displayName,
          password,
        }),
      });
      setToken(result.token);
      set({ status: "authed", user: result.user, error: "" });
      return true;
    } catch (cause) {
      set({ error: messageOf(cause, "注册失败") });
      return false;
    }
  },
  logout: async () => {
    try {
      await api<void>("/api/auth/logout", { method: "POST" });
    } catch {
      /* 会话可能已失效，忽略 */
    }
    setToken(null);
    set({ status: "anon", user: null, error: "" });
  },
  clearSession: () => {
    setToken(null);
    set({ status: "anon", user: null });
  },
}));

// 令牌失效（401）时清理本地会话。
onUnauthorized(() => {
  useAuthStore.getState().clearSession();
});

// ---------------------------------------------------------------------------
// 课题空间与工具
// ---------------------------------------------------------------------------

type WorkspaceState = {
  subjects: Subject[];
  summary: WorkspaceSummary | null;
  listLoading: boolean;
  error: string;
  subject: Subject | null;
  documents: DocumentMeta[];
  detailLoading: boolean;
  detailError: string;
  catalog: ToolItem[];
  toolFields: string[];
  toolPurposes: string[];
  toolTotal: number;
  toolQuery: ToolQuery;
  toolsLoading: boolean;
  subjectTools: SubjectToolItem[];
  loadWorkspace: () => Promise<void>;
  createSubject: (input: {
    name: string;
    field: string;
    description: string;
  }) => Promise<Subject | null>;
  loadSubject: (id: number) => Promise<void>;
  uploadDocument: (subjectId: number, file: File) => Promise<void>;
  deleteDocument: (document: DocumentMeta) => Promise<void>;
  setToolQuery: (patch: Partial<ToolQuery>) => void;
  loadTools: () => Promise<void>;
  loadSubjectTools: (subjectId: number) => Promise<void>;
  addSubjectTool: (subjectId: number, toolId: string) => Promise<void>;
  removeSubjectTool: (subjectId: number, toolId: string) => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  subjects: [],
  summary: null,
  listLoading: false,
  error: "",
  subject: null,
  documents: [],
  detailLoading: false,
  detailError: "",
  catalog: [],
  toolFields: [],
  toolPurposes: [],
  toolTotal: 0,
  toolQuery: { ...EMPTY_TOOL_QUERY },
  toolsLoading: false,
  subjectTools: [],

  loadWorkspace: async () => {
    set({ listLoading: true, error: "" });
    try {
      const [subjects, summary] = await Promise.all([
        api<Subject[]>("/api/subjects"),
        api<WorkspaceSummary>("/api/workspace/summary"),
      ]);
      set({ subjects, summary, listLoading: false });
    } catch (cause) {
      set({ error: messageOf(cause, "无法加载课题空间"), listLoading: false });
    }
  },

  createSubject: async (input) => {
    try {
      const subject = await api<Subject>("/api/subjects", {
        method: "POST",
        body: JSON.stringify(input),
      });
      set((state) => ({ subjects: [subject, ...state.subjects] }));
      void get().loadWorkspace();
      return subject;
    } catch (cause) {
      set({ error: messageOf(cause, "创建课题失败") });
      return null;
    }
  },

  loadSubject: async (id) => {
    set({ detailLoading: true, detailError: "" });
    try {
      const [subject, documents, subjectTools] = await Promise.all([
        api<Subject>(`/api/subjects/${id}`),
        api<DocumentMeta[]>(`/api/subjects/${id}/documents`),
        api<SubjectToolItem[]>(`/api/subjects/${id}/tools`),
      ]);
      set({
        subject,
        documents,
        subjectTools,
        detailLoading: false,
      });
    } catch (cause) {
      set({
        subject: null,
        documents: [],
        subjectTools: [],
        detailError: messageOf(cause, "无法加载课题详情"),
        detailLoading: false,
      });
    }
  },

  uploadDocument: async (subjectId, file) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const doc = await api<DocumentMeta>(`/api/subjects/${subjectId}/documents`, {
        method: "POST",
        body: form,
      });
      set((state) => ({ documents: [doc, ...state.documents], detailError: "" }));
      void get().loadWorkspace();
    } catch (cause) {
      set({ detailError: messageOf(cause, "上传失败") });
    }
  },

  deleteDocument: async (document) => {
    try {
      await api<void>(`/api/documents/${document.id}`, { method: "DELETE" });
      set((state) => ({
        documents: state.documents.filter((item) => item.id !== document.id),
      }));
      void get().loadWorkspace();
    } catch (cause) {
      set({ detailError: messageOf(cause, "删除文件失败") });
    }
  },

  setToolQuery: (patch) => {
    set((state) => ({ toolQuery: { ...state.toolQuery, ...patch } }));
    void get().loadTools();
  },

  loadTools: async () => {
    const { toolQuery } = get();
    const params = new URLSearchParams();
    if (toolQuery.kind) params.set("kind", toolQuery.kind);
    if (toolQuery.q.trim()) params.set("q", toolQuery.q.trim());
    if (toolQuery.field) params.set("field", toolQuery.field);
    if (toolQuery.purpose) params.set("purpose", toolQuery.purpose);
    if (toolQuery.sort) params.set("sort", toolQuery.sort);
    set({ toolsLoading: true });
    try {
      const data = await api<ToolListResponse>(`/api/tools?${params.toString()}`);
      set({
        catalog: data.items,
        toolFields: data.fields,
        toolPurposes: data.purposes,
        toolTotal: data.total,
        toolsLoading: false,
      });
    } catch (cause) {
      set({ toolsLoading: false, detailError: messageOf(cause, "无法加载工具目录") });
    }
  },

  loadSubjectTools: async (subjectId) => {
    try {
      const items = await api<SubjectToolItem[]>(`/api/subjects/${subjectId}/tools`);
      set({ subjectTools: items });
    } catch (cause) {
      set({ detailError: messageOf(cause, "无法加载已关联工具") });
    }
  },

  addSubjectTool: async (subjectId, toolId) => {
    try {
      await api<SubjectToolItem>(`/api/subjects/${subjectId}/tools`, {
        method: "POST",
        body: JSON.stringify({ tool_id: toolId }),
      });
      await get().loadSubjectTools(subjectId);
    } catch (cause) {
      set({ detailError: messageOf(cause, "关联工具失败") });
    }
  },

  removeSubjectTool: async (subjectId, toolId) => {
    try {
      await api<void>(
        `/api/subjects/${subjectId}/tools/${encodeURIComponent(toolId)}`,
        { method: "DELETE" },
      );
      set((state) => ({
        subjectTools: state.subjectTools.filter((item) => item.tool_id !== toolId),
      }));
    } catch (cause) {
      set({ detailError: messageOf(cause, "解除关联失败") });
    }
  },
}));

// ---------------------------------------------------------------------------
// 对话
// ---------------------------------------------------------------------------

type ChatState = {
  conversations: ConversationSummary[];
  listLoading: boolean;
  active: ConversationDetail | null;
  detailLoading: boolean;
  sending: boolean;
  error: string;
  draft: string;
  mode: ChatMode;
  model: string;
  subjectId: number | null;
  lastMeta: MessageExchange["meta"] | null;
  setDraft: (draft: string) => void;
  setMode: (mode: ChatMode) => void;
  setModel: (model: string) => void;
  setSubjectId: (subjectId: number | null) => void;
  loadConversations: () => Promise<void>;
  openConversation: (id: number) => Promise<void>;
  clearActive: () => void;
  removeConversation: (id: number) => Promise<void>;
  /** 在首页发起第一轮：创建会话 → 发送首条消息 → 返回会话 id。 */
  startConversation: (subjectId: number) => Promise<number | null>;
  /** 在当前会话中继续发送。 */
  sendMessage: (content: string) => Promise<void>;
};

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  listLoading: false,
  active: null,
  detailLoading: false,
  sending: false,
  error: "",
  draft: "",
  mode: "quick",
  model: "auto",
  subjectId: null,
  lastMeta: null,

  setDraft: (draft) => set({ draft }),
  setMode: (mode) => set({ mode }),
  setModel: (model) => set({ model }),
  setSubjectId: (subjectId) => set({ subjectId }),

  loadConversations: async () => {
    set({ listLoading: true });
    try {
      const conversations = await api<ConversationSummary[]>("/api/conversations");
      set({ conversations, listLoading: false });
    } catch (cause) {
      set({ error: messageOf(cause, "无法加载会话列表"), listLoading: false });
    }
  },

  openConversation: async (id) => {
    set({ detailLoading: true, error: "" });
    try {
      const active = await api<ConversationDetail>(`/api/conversations/${id}`);
      set({
        active,
        detailLoading: false,
        mode: active.conversation.mode === "deep" ? "deep" : "quick",
        model: active.conversation.model,
        subjectId: active.conversation.subject_id,
      });
    } catch (cause) {
      set({
        active: null,
        error: messageOf(cause, "无法打开会话"),
        detailLoading: false,
      });
    }
  },

  clearActive: () => set({ active: null, error: "", lastMeta: null }),

  removeConversation: async (id) => {
    try {
      await api<void>(`/api/conversations/${id}`, { method: "DELETE" });
      set((state) => {
        const next: Partial<ChatState> = {
          conversations: state.conversations.filter((item) => item.id !== id),
        };
        if (state.active?.conversation.id === id) {
          next.active = null;
        }
        return next;
      });
      void get().loadConversations();
    } catch (cause) {
      set({ error: messageOf(cause, "删除会话失败") });
    }
  },

  startConversation: async (subjectId) => {
    const { mode, model, draft } = get();
    const content = draft.trim();
    if (!content) {
      set({ error: "请先输入问题再发起对话。" });
      return null;
    }
    set({ sending: true, error: "" });
    try {
      const conversation = await api<Conversation>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ subject_id: subjectId, mode, model }),
      });
      const exchange = await api<MessageExchange>(
        `/api/conversations/${conversation.id}/messages`,
        { method: "POST", body: JSON.stringify({ content }) },
      );
      await get().openConversation(conversation.id);
      set({ sending: false, draft: "", lastMeta: exchange.meta });
      void get().loadConversations();
      return conversation.id;
    } catch (cause) {
      set({ sending: false, error: messageOf(cause, "发送失败") });
      return null;
    }
  },

  sendMessage: async (content) => {
    const active = get().active;
    const trimmed = content.trim();
    if (!active) {
      set({ error: "请先选择或新建一个会话。" });
      return;
    }
    if (!trimmed) {
      return;
    }
    set({ sending: true, error: "" });
    try {
      const exchange = await api<MessageExchange>(
        `/api/conversations/${active.conversation.id}/messages`,
        { method: "POST", body: JSON.stringify({ content: trimmed }) },
      );
      set((state) => {
        if (!state.active) return {};
        return {
          sending: false,
          draft: "",
          lastMeta: exchange.meta,
          active: {
            ...state.active,
            conversation: { ...state.active.conversation, title: exchange.title },
            messages: [
              ...state.active.messages,
              exchange.user_message,
              exchange.assistant_message,
            ],
          },
        };
      });
      void get().loadConversations();
    } catch (cause) {
      set({ sending: false, error: messageOf(cause, "发送失败") });
    }
  },
}));

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function messageOf(cause: unknown, fallback: string): string {
  if (cause instanceof ApiRequestError || cause instanceof Error) {
    return cause.message || fallback;
  }
  return fallback;
}

/** 下载课题文件：带令牌取回后在本机触发保存。 */
export async function downloadDocument(document: DocumentMeta): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`/api/documents/${document.id}/content`, { headers });
  if (!response.ok) {
    throw new ApiRequestError(response.status, "下载文件失败");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = document.original_name;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
