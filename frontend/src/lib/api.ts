/**
 * 阶段 E：带令牌的本地 API 客户端。
 * - 所有 `/api/*`（health/auth 除外）自动携带 `Authorization: Bearer`。
 * - 401 时通知认证层清理本地会话。
 * - 令牌只保存在 localStorage，仅绑定 127.0.0.1 回环服务。
 */

const TOKEN_KEY = "fieldnote.token";

let token: string | null = readToken();

function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(next: string | null): void {
  token = next;
  try {
    if (next) {
      window.localStorage.setItem(TOKEN_KEY, next);
    } else {
      window.localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    /* localStorage 不可用时仅保留内存令牌 */
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** 注册 401 回调（由认证 store 在初始化时调用）。 */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isForm = init?.body instanceof FormData;
  if (!isForm && init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(url, { ...init, headers });

  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new ApiRequestError(401, "登录状态已失效，请重新登录。");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new ApiRequestError(
      response.status,
      body?.error ?? `请求失败 (${response.status})`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}
