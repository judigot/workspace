/**
 * DevBubble standalone widget (React).
 * Injected into app pages via nginx sub_filter.
 * Compiled to a self-contained IIFE bundle that includes React+ReactDOM.
 *
 * Config via script tag data attributes:
 *   <script src="/dev-bubble.js"
 *     data-opencode-url="https://opencode.judigot.com"
 *     data-dashboard-url="https://judigot.com">
 *   </script>
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";

// ---------------------------------------------------------------------------
// Config from script tag
// ---------------------------------------------------------------------------
const scriptTag = document.currentScript as HTMLScriptElement | null;
const OPENCODE_URL =
  scriptTag?.getAttribute("data-opencode-url") ??
  "https://opencode.judigot.com";
const DASHBOARD_URL =
  scriptTag?.getAttribute("data-dashboard-url") ?? "/";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IApp {
  slug: string;
  port: number;
  url: string;
  status: "up" | "down" | "unknown";
}

interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

type Tab = "apps" | "opencode";

// ---------------------------------------------------------------------------
// Styles (injected into <head> once)
// ---------------------------------------------------------------------------
const CSS = `
  #__dev-bubble-root,
  #__dev-bubble-root * {
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
  }
  #__dev-bubble-root {
    font-family: system-ui, -apple-system, sans-serif;
    position: fixed;
    z-index: 99999;
  }

  /* ── Bubble button ── */
  .db-btn {
    position: fixed;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 99999;
    touch-action: none;
    user-select: none;
    padding: 0;
  }
  .db-btn:active { cursor: grabbing; transform: scale(0.95); }
  @media (hover: hover) {
    .db-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(102, 126, 234, 0.5);
    }
  }

  /* ── Panel (fullscreen overlay) ── */
  .db-panel {
    position: fixed;
    inset: 0;
    background: #0f1115;
    z-index: 99998;
    display: flex;
    flex-direction: column;
  }
  .db-panel.hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* ── Header ── */
  .db-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    flex-shrink: 0;
  }
  .db-header-title {
    font-size: 16px;
    font-weight: 600;
    flex: 1;
  }
  .db-header-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,0.2);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
  }
  .db-header-btn:hover { background: rgba(255,255,255,0.3); }

  /* ── Tabs ── */
  .db-tabs {
    display: flex;
    background: #161627;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .db-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: rgba(255,255,255,0.5);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    min-height: 44px;
    font-family: inherit;
    transition: color 0.15s, border-color 0.15s;
  }
  .db-tab:active { background: rgba(255,255,255,0.04); }
  .db-tab.active {
    color: white;
    border-bottom-color: #667eea;
  }

  /* ── Apps list ── */
  .db-apps {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    background: #0f1115;
    -webkit-overflow-scrolling: touch;
  }
  .db-apps-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    max-width: 800px;
    margin: 0 auto;
  }
  .db-app-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px;
    background: #1a1d26;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.15s;
    text-align: left;
    color: #f5f7ff;
    font: inherit;
    width: 100%;
    min-height: 44px;
  }
  .db-app-card:active {
    background: #2a2e3e;
    border-color: rgba(102,126,234,0.3);
    transform: scale(0.98);
  }
  @media (hover: hover) {
    .db-app-card:hover {
      background: #222634;
      border-color: rgba(102,126,234,0.25);
      transform: translateY(-1px);
    }
  }
  .db-app-card-current {
    border-color: rgba(102,126,234,0.5);
    background: #1e2235;
  }
  .db-app-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .db-app-icon-oc {
    background: linear-gradient(135deg, #667eea, #764ba2);
  }
  .db-app-body {
    flex: 1;
    min-width: 0;
  }
  .db-app-name {
    font-size: 0.9375rem;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .db-app-url {
    font-size: 0.6875rem;
    color: #8891a8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .db-status {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .db-status-up {
    background: #2ed573;
    box-shadow: 0 0 6px rgba(46,213,115,0.5);
  }
  .db-status-down, .db-status-unknown {
    background: #57606a;
  }
  .db-apps-loading {
    color: #8891a8;
    text-align: center;
    padding: 40px 20px;
    font-size: 0.875rem;
  }

  /* ── OpenCode iframe ── */
  .db-iframe {
    flex: 1;
    width: 100%;
    border: none;
    background: #0f0f1a;
  }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .db-header { padding: 10px 12px; }
    .db-header-title { font-size: 14px; }
    .db-header-btn { width: 44px; height: 44px; }
    .db-apps-grid { grid-template-columns: 1fr; }
  }
`;

// ---------------------------------------------------------------------------
// Icons (inline SVGs)
// ---------------------------------------------------------------------------
const IconChat: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
  </svg>
);

const IconMinimize: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M19 13H5v-2h14v2z" />
  </svg>
);

const IconHome: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
  </svg>
);

const IconApps: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
    <path d="M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z" />
  </svg>
);

const IconCode: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useApps() {
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

  return { config, loading, refetch: fetchApps };
}

function useDrag(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      dragging.current = true;
      hasDragged.current = false;
      offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragging.current) return;
      hasDragged.current = true;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - offset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - offset.current.y)),
      });
    },
    [],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Clamp on resize
  useEffect(() => {
    const handler = () =>
      setPos((p) => ({
        x: Math.min(p.x, window.innerWidth - 84),
        y: Math.min(p.y, window.innerHeight - 84),
      }));
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  return { pos, hasDragged, onPointerDown, onPointerMove, onPointerUp };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const AppCard: FC<{
  app: IApp;
  isCurrent: boolean;
}> = ({ app, isCurrent }) => (
  <button
    className={`db-app-card${isCurrent ? " db-app-card-current" : ""}`}
    onClick={() => {
      window.location.href = app.url;
    }}
  >
    <div className="db-app-icon">{app.slug.charAt(0).toUpperCase()}</div>
    <div className="db-app-body">
      <div className="db-app-name">{app.slug}</div>
      <div className="db-app-url">{app.url}</div>
    </div>
    <span
      className={`db-status db-status-${app.status}`}
      title={app.status === "up" ? "Running" : "Stopped"}
    />
  </button>
);

const AppsTab: FC<{ config: IConfig | null; loading: boolean }> = ({
  config,
  loading,
}) => {
  // Determine current app from URL path
  const currentSlug = window.location.pathname.split("/").filter(Boolean)[0] ?? "";

  if (loading) {
    return <div className="db-apps-loading">Loading apps...</div>;
  }

  if (!config || config.apps.length === 0) {
    return <div className="db-apps-loading">No apps registered.</div>;
  }

  return (
    <div className="db-apps">
      <div className="db-apps-grid">
        {/* OpenCode card */}
        <button
          className="db-app-card"
          onClick={() => {
            window.open(`https://${config.opencodeDomain}/`, "_blank");
          }}
        >
          <div className="db-app-icon db-app-icon-oc">OC</div>
          <div className="db-app-body">
            <div className="db-app-name">OpenCode</div>
            <div className="db-app-url">https://{config.opencodeDomain}/</div>
          </div>
          <span className="db-status db-status-up" title="Running" />
        </button>

        {/* App cards */}
        {config.apps.map((app) => (
          <AppCard
            key={app.slug}
            app={app}
            isCurrent={app.slug === currentSlug}
          />
        ))}
      </div>
    </div>
  );
};

const DevBubbleWidget: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("apps");
  const { config, loading } = useApps();
  const { pos, hasDragged, onPointerDown, onPointerMove, onPointerUp } =
    useDrag(window.innerWidth - 84, window.innerHeight - 84);

  const handleBubbleClick = useCallback(() => {
    if (!hasDragged.current) setIsOpen(true);
  }, [hasDragged]);

  return (
    <>
      {/* Panel */}
      <div className={`db-panel${isOpen ? "" : " hidden"}`}>
        {/* Header */}
        <div className="db-header">
          <button
            className="db-header-btn"
            aria-label="Home"
            title="Back to dashboard"
            onClick={() => {
              window.location.href = DASHBOARD_URL;
            }}
          >
            <IconHome />
          </button>
          <span className="db-header-title">Workspace</span>
          <button
            className="db-header-btn"
            aria-label="Minimize"
            onClick={() => setIsOpen(false)}
          >
            <IconMinimize />
          </button>
        </div>

        {/* Tabs */}
        <div className="db-tabs">
          <button
            className={`db-tab${activeTab === "apps" ? " active" : ""}`}
            onClick={() => setActiveTab("apps")}
          >
            <IconApps />
            Apps
          </button>
          <button
            className={`db-tab${activeTab === "opencode" ? " active" : ""}`}
            onClick={() => setActiveTab("opencode")}
          >
            <IconCode />
            OpenCode
          </button>
        </div>

        {/* Tab content */}
        {activeTab === "apps" ? (
          <AppsTab config={config} loading={loading} />
        ) : (
          <iframe
            className="db-iframe"
            src={OPENCODE_URL}
            title="OpenCode"
            allow="clipboard-read; clipboard-write; microphone"
          />
        )}
      </div>

      {/* Floating bubble */}
      {!isOpen && (
        <button
          className="db-btn"
          aria-label="Open assistant"
          style={{ left: pos.x, top: pos.y }}
          onClick={handleBubbleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <IconChat />
        </button>
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
(function mount() {
  if (document.getElementById("__dev-bubble-root")) return;

  // Inject styles
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  // Create mount point
  const container = document.createElement("div");
  container.id = "__dev-bubble-root";
  document.body.appendChild(container);

  // Render
  createRoot(container).render(<DevBubbleWidget />);
})();
