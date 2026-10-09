import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store-e";

/** 阶段 E：本地账号登录 / 注册门（同一界面切换）。 */
export function AuthGate() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const error = useAuthStore((state) => state.error);

  const canSubmit =
    email.trim().length > 0 &&
    password.length >= 8 &&
    (mode === "login" || displayName.trim().length > 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setPending(true);
    if (mode === "login") {
      await login(email.trim(), password);
    } else {
      await register(email.trim(), displayName.trim(), password);
    }
    setPending(false);
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setPassword("");
  }

  return (
    <main className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">F</span>
          <div>
            <strong>fieldnote</strong>
            <small>RESEARCH STUDIO · LOCAL</small>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="账号操作">
          <button
            role="tab"
            aria-selected={mode === "login"}
            className={`auth-tab ${mode === "login" ? "is-active" : ""}`}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            role="tab"
            aria-selected={mode === "register"}
            className={`auth-tab ${mode === "register" ? "is-active" : ""}`}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>

        <p className="auth-lead">
          {mode === "login"
            ? "使用本地账号进入研究工作台。"
            : "在本机创建账号；数据只保存在 127.0.0.1 的本地数据库。"}
        </p>

        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span>邮箱</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@lab.local"
              required
            />
          </label>

          {mode === "register" && (
            <label className="field">
              <span>显示名</span>
              <input
                type="text"
                autoComplete="nickname"
                value={displayName}
                maxLength={60}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="例如：本地研究者"
                required
              />
            </label>
          )}

          <label className="field">
            <span>密码（至少 8 位）</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              minLength={8}
              required
            />
          </label>

          {error && (
            <div className="inline-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <Button className="button button-dark auth-submit" type="submit" disabled={!canSubmit || pending}>
            {pending
              ? mode === "login"
                ? "正在登录…"
                : "正在创建…"
              : mode === "login"
                ? "登录"
                : "创建账号"}
          </Button>
        </form>

        <p className="auth-note">
          本地演示：无外网调用，不连接实验设备；退出即吊销本机会话。
        </p>
      </div>
    </main>
  );
}
