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
