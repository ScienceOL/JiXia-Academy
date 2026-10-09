export type IconName =
  | "grid"
  | "flask"
  | "file"
  | "layers"
  | "settings"
  | "arrow"
  | "check"
  | "chat"
  | "repo"
  | "send"
  | "trash"
  | "upload"
  | "plus"
  | "search"
  | "logout"
  | "download"
  | "user";

export function Icon({
  name,
  size = 18,
}: {
  name: IconName;
  size?: number;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.4" />
          <rect x="14" y="3" width="7" height="7" rx="1.4" />
          <rect x="3" y="14" width="7" height="7" rx="1.4" />
          <rect x="14" y="14" width="7" height="7" rx="1.4" />
        </svg>
      );
    case "flask":
      return (
        <svg {...common}>
          <path d="M9 3h6M10 3v6.3L5 18a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-8.7V3" />
          <path d="M8 15h8" />
        </svg>
      );
    case "file":
      return (
        <svg {...common}>
          <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <path d="M14 3v6h6M8 13h8M8 17h5" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="m19.4 15 .1.1 1.3 1-1.4 2.4-1.6-.6a8 8 0 0 1-1.8 1l-.3 1.7h-2.8l-.3-1.7a8 8 0 0 1-1.8-1l-1.6.6-1.4-2.4 1.3-1a7 7 0 0 1 0-2l-1.3-1 1.4-2.4 1.6.6a8 8 0 0 1 1.8-1l.3-1.7h2.8l.3 1.7a8 8 0 0 1 1.8 1l1.6-.6 1.4 2.4-1.3 1a7 7 0 0 1 0 2Z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 12 4 4L19 6" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5A8 8 0 1 1 21 12Z" />
        </svg>
      );
    case "repo":
      return (
        <svg {...common}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
          <path d="M4 5.5v15M8 7h8M8 11h6" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M4 12 20 4l-6 16-3-7z" />
          <path d="m11 13 9-9" />
        </svg>
      );
    case "trash":
      return (
        <svg {...common}>
          <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 12h10M17 9l3 3-3 3M10 4v16" />
        </svg>
      );
    case "download":
      return (
        <svg {...common}>
          <path d="M12 4v12M7 11l5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
  }
}
