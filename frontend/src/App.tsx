import { useEffect } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { AuthGate } from "@/components/AuthGate";
import { Icon, type IconName } from "@/components/Icon";
import { ChatPage } from "@/pages/ChatPage";
import { CasePage } from "@/pages/CasePage";
import { RepositoryPage } from "@/pages/RepositoryPage";
import { SubjectDetailPage } from "@/pages/SubjectDetailPage";
import { PaperTools } from "@/PaperTools";
import { useAuthStore } from "@/store-e";

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  count?: string;
};

const navItems: NavItem[] = [
  { to: "/chat", label: "对话", icon: "chat" },
  { to: "/repo/repository", label: "课题空间", icon: "repo" },
  { to: "/", label: "案例工作流", icon: "flask", end: true, count: "01" },
  { to: "/paper", label: "研究资料", icon: "file", count: "02" },
];

function breadcrumbFor(pathname: string): string {
  if (pathname.startsWith("/chat")) return "对话";
  if (pathname.startsWith("/repo/repository/")) return "课题详情";
  if (pathname.startsWith("/repo/repository")) return "课题空间";
  if (pathname.startsWith("/paper")) return "论文工具";
  if (pathname === "/") return "蛋白质定向进化";
  return "研究工作台";
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const logout = useAuthStore((state) => state.logout);
  const location = useLocation();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status === "loading") {
    return (
      <main className="boot-screen">
        <div className="boot-mark">F</div>
        <p>正在校验本地会话…</p>
      </main>
    );
  }

  if (status === "anon") {
    return <AuthGate />;
  }

  const initials = (user?.display_name?.trim() || "本地研究者").slice(0, 1).toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <NavLink className="brand" to="/" end aria-label="Fieldnote 首页">
          <span className="brand-mark">F</span>
          <span className="brand-name">
            fieldnote
            <small>RESEARCH STUDIO</small>
          </span>
        </NavLink>

        <div className="side-caption">WORKSPACE</div>
        <button className="side-link side-link-muted" aria-disabled="true">
          <Icon name="grid" />
          <span>研究总览</span>
          <span className="future-tag">后续</span>
        </button>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `side-link ${isActive ? "side-link-active" : "side-link-muted"}`
            }
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.count && <span className="side-count">{item.count}</span>}
          </NavLink>
        ))}
        <button className="side-link side-link-muted" aria-disabled="true">
          <Icon name="layers" />
          <span>工具与方法</span>
          <span className="future-tag">后续</span>
        </button>

        <div className="sidebar-rule" />
        <div className="side-caption">CURRENT PROJECT</div>
        <div className="project-mini">
          <span className="project-dot" />
          <span>
            AmeR 定向进化
            <small>演示项目 · 本地</small>
          </span>
        </div>

        <div className="sidebar-spacer" />
        <div className="local-card">
          <span className="local-pulse" />
          <div>
            <strong>本地安全模式</strong>
            <small>无设备 · 无外网调用</small>
          </div>
          <span className="local-lock">⌑</span>
        </div>
        <div className="profile">
          <div className="profile-avatar">{initials}</div>
          <div>
            <strong>{user?.display_name ?? "本地研究者"}</strong>
            <small>{user?.email ?? "LOCAL WORKSPACE"}</small>
          </div>
          <button className="icon-button" aria-label="退出登录" onClick={() => void logout()}>
            <Icon name="logout" size={17} />
          </button>
        </div>
      </aside>

      <main className="main-shell" id="overview">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>研究工作台</span>
            <span className="crumb-slash">/</span>
            <strong>{breadcrumbFor(location.pathname)}</strong>
          </div>
          <div className="topbar-actions">
            <Badge className="offline-chip">
              <i />
              LOCAL DEMO
            </Badge>
            <div className="top-avatar">{initials}</div>
          </div>
        </header>

        <div className="page-content">
          <Routes>
            <Route path="/" element={<CasePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/repo/repository" element={<RepositoryPage />} />
            <Route path="/repo/repository/:id" element={<SubjectDetailPage />} />
            <Route path="/paper" element={<PaperTools />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
