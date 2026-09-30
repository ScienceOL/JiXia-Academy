import { create } from "zustand";
import type { AgentProbe, BusyState, CaseResponse } from "./types";

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
  setSelected: (selected: number) => void;
  refresh: () => Promise<void>;
  advance: () => Promise<void>;
  reset: () => Promise<void>;
  runProbe: () => Promise<void>;
};

export const useResearchStore = create<ResearchStore>((set) => ({
  data: null,
  selected: 0,
  probe: null,
  busy: null,
  error: "",
  setSelected: (selected) => set({ selected }),
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
