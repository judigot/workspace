/**
 * WorkspaceShell — the unified workspace UI.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │ [App1] [App2] [App3] ...  (horiz strip) │
 *   ├─────────────────────────────────────────┤
 *   │                                         │
 *   │          OpenCode iframe                │
 *   │          (fills remaining space)        │
 *   │                                         │
 *   └─────────────────────────────────────────┘
 *
 * Used by:
 *   - Dashboard (App.tsx) — rendered as full page
 *   - DevBubble widget (widget.tsx) — rendered inside the panel overlay
 */

import React, {
  useState,
  useEffect,
  useCallback,
  type FC,
  type ReactNode,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface IApp {
  slug: string;
  port: number;
  url: string;
  status: "up" | "down" | "unknown";
}

export interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

export interface WorkspaceShellProps {
  /** URL for the OpenCode iframe */
  opencodeUrl: string;
  /** Optional header content (e.g. Home button, minimize button) */
  header?: ReactNode;
  /** CSS class for the outer wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Hook: fetch /api/apps
// ---------------------------------------------------------------------------
export function useApps() {
  const [config, setConfig] = useState<IConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchApps = useCallback(async () => {
    try {
      const res = await fetch("/api/apps");
      if (!res.ok) return;
      const data = (await res.json()) as IConfig;
      setConfig(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchApps();
    const id = setInterval(() => void fetchApps(), 10_000);
    return () => clearInterval(id);
  }, [fetchApps]);

  return { config, loading };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const WorkspaceShell: FC<WorkspaceShellProps> = ({
  opencodeUrl,
  header,
  className,
}) => {
  const { config, loading } = useApps();
  const currentSlug =
    window.location.pathname.split("/").filter(Boolean)[0] ?? "";

  return (
    <div className={`ws-shell${className ? ` ${className}` : ""}`}>
      {/* Optional header (Home/minimize buttons injected by parent) */}
      {header}

      {/* App strip */}
      <div className="ws-strip">
        <span className="ws-strip-label">Apps</span>

        {loading && (
          <span className="ws-strip-loading">Loading...</span>
        )}

        {config?.apps.map((app) => (
          <a
            key={app.slug}
            href={app.url}
            className={`ws-chip${app.slug === currentSlug ? " ws-chip-active" : ""}`}
            title={app.url}
          >
            <span className="ws-chip-icon">
              {app.slug.charAt(0).toUpperCase()}
            </span>
            <span className="ws-chip-name">{app.slug}</span>
            <span
              className={`ws-chip-dot ws-chip-dot-${app.status}`}
            />
          </a>
        ))}

        {config && config.apps.length === 0 && !loading && (
          <span className="ws-strip-loading">No apps</span>
        )}
      </div>

      {/* OpenCode iframe */}
      <iframe
        className="ws-iframe"
        src={opencodeUrl}
        title="OpenCode"
        allow="clipboard-read; clipboard-write; microphone"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Styles (exported so both dashboard and widget can use them)
// ---------------------------------------------------------------------------
export const WORKSPACE_SHELL_CSS = `
  /* ── Shell container ── */
  .ws-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f1115;
    font-family: system-ui, -apple-system, sans-serif;
    color: #f5f7ff;
  }
  .ws-shell-fullpage {
    height: 100vh;
    height: 100dvh;
  }

  /* ── App strip ── */
  .ws-strip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: #161627;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
  }
  .ws-strip::-webkit-scrollbar { display: none; }

  .ws-strip-label {
    color: rgba(255,255,255,0.65);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0 4px 0 2px;
    flex-shrink: 0;
  }

  .ws-strip-loading {
    color: #8891a8;
    font-size: 12px;
    padding: 6px 10px;
    white-space: nowrap;
  }

  /* ── App chip (semantic <a> link — supports long-press "open in new tab") ── */
  .ws-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    color: rgba(255,255,255,0.7);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    min-height: 36px;
    font-family: inherit;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    -webkit-tap-highlight-color: transparent;
    text-decoration: none;
  }
  .ws-chip:active {
    background: rgba(255,255,255,0.12);
    transform: scale(0.97);
  }
  @media (hover: hover) {
    .ws-chip:hover {
      background: rgba(255,255,255,0.1);
      border-color: rgba(102,126,234,0.3);
      color: white;
    }
  }
  .ws-chip-active {
    background: rgba(102,126,234,0.15);
    border-color: rgba(102,126,234,0.5);
    color: white;
  }

  .ws-chip-icon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }

  .ws-chip-name {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ws-chip-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .ws-chip-dot-up {
    background: #2ed573;
    box-shadow: 0 0 4px rgba(46,213,115,0.5);
  }
  .ws-chip-dot-down,
  .ws-chip-dot-unknown {
    background: #57606a;
  }

  /* ── OpenCode iframe ── */
  .ws-iframe {
    flex: 1;
    width: 100%;
    border: none;
    background: #0f0f1a;
  }
`;
