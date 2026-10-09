export type Stage = {
  id: string;
  index: number;
  title: string;
  eyebrow: string;
  summary: string;
  output: string;
  state: "ready" | "simulated";
};

export type AuditEvent = {
  id: number;
  at: number;
  kind: string;
  title: string;
  detail: string;
  stage: number | null;
};

export type CaseResponse = {
  id: string;
  title: string;
  subtitle: string;
  data_label: string;
  current_stage: number;
  completed: number[];
  finished: boolean;
  stages: Stage[];
  events: AuditEvent[];
};

export type AgentProbe = {
  runtime: string;
  version: string;
  command: string;
  model_source: string;
  events: string[];
  output: string;
  fixture_calls: number;
  tool_requests: number;
  tool_executions: number;
  network_used: boolean;
};

export type BusyState = "load" | "advance" | "reset" | "probe" | null;

export type WorkspaceKey = "case" | "papers";
export type PaperTabKey = "search" | "reading" | "citation";
export type PaperKind = "research" | "review";

export type PaperRecord = {
  id: string;
  title: string;
  authors: string;
  year: number;
  kind: PaperKind;
  topic: string;
  abstract: string;
};

export type PdfDemo = {
  name: string;
  size: number;
};

export type CitationReport = {
  mode: "existence" | "consistency";
  verdict: string;
  confidence: string;
  evidence: string[];
  uncertainty: string;
};

// ---------------------------------------------------------------------------
// 阶段 E：认证 / 课题 / 对话 / 工具（本地模拟）
// ---------------------------------------------------------------------------

export type ChatMode = "quick" | "deep";

export type SessionUser = {
  id: number;
  email: string;
  display_name: string;
  created_at: number;
};

export type AuthResponse = {
  token: string;
  expires_at: number;
  user: SessionUser;
};

export type Subject = {
  id: number;
  owner_id: number;
  name: string;
  field: string;
  description: string;
  created_at: number;
  updated_at: number;
};

export type DocumentMeta = {
  id: number;
  subject_id: number;
  owner_id: number;
  original_name: string;
  byte_size: number;
  sha256: string;
  content_type: string;
  created_at: number;
};

export type WorkspaceSummary = {
  subjects: number;
  documents: number;
  conversations: number;
  messages: number;
  runs: number;
  storage_bytes: number;
};

export type Conversation = {
  id: number;
  subject_id: number;
  owner_id: number;
  title: string;
  mode: string;
  model: string;
  created_at: number;
  updated_at: number;
};

export type ConversationSummary = {
  id: number;
  subject_id: number;
  subject_name: string;
  title: string;
  mode: string;
  model: string;
  message_count: number;
  created_at: number;
  updated_at: number;
};

export type MessageRecord = {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: number;
};

export type ConversationDetail = {
  conversation: Conversation;
  subject_name: string;
  messages: MessageRecord[];
};

export type ChatMeta = {
  runtime: string;
  version: string;
  model_source: string;
  fixture_calls: number;
  tool_requests: number;
  tool_executions: number;
  network_used: boolean;
  events: string[];
  simulated: boolean;
};

export type MessageExchange = {
  conversation_id: number;
  title: string;
  user_message: MessageRecord;
  assistant_message: MessageRecord;
  meta: ChatMeta;
};

export type ToolItem = {
  id: string;
  name: string;
  kind: string;
  field: string;
  purpose: string;
  summary: string;
  simulated: boolean;
};

export type ToolListResponse = {
  total: number;
  items: ToolItem[];
  fields: string[];
  purposes: string[];
};

export type SubjectToolItem = {
  tool_id: string;
  added_at: number;
  tool: ToolItem | null;
};

export type ToolQuery = {
  kind: string;
  q: string;
  field: string;
  purpose: string;
  sort: string;
};
