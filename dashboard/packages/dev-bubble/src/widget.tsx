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
  useRef,
  useCallback,
  useEffect,
  type FC,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceShell, WORKSPACE_SHELL_CSS } from "./WorkspaceShell";

const BUBBLE_SIZE = 60;
const BUBBLE_MARGIN = 12;
/**
 * Minimum distance (px) the pointer must travel before a gesture counts as a
 * drag rather than a tap.  10 px absorbs natural finger jitter on touch screens.
 */
const DRAG_THRESHOLD = 10;

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
// Widget-only styles (bubble + panel overlay)
// ---------------------------------------------------------------------------
const WIDGET_CSS = `
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

  /* ── Panel header ── */
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

  /* Shell inside panel fills remaining space */
  .db-panel .ws-shell {
    flex: 1;
    min-height: 0;
  }

  @media (max-width: 768px) {
    .db-header { padding: 10px 12px; }
    .db-header-title { font-size: 14px; }
    .db-header-btn { width: 44px; height: 44px; }
  }
`;

// ---------------------------------------------------------------------------
// Icons
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

// ---------------------------------------------------------------------------
// Drag hook
// ---------------------------------------------------------------------------
function useDrag(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  // All mutable drag state lives in refs so pointer handlers never read stale values.
  const posRef = useRef({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });

  // Keep the ref in sync whenever React state changes (e.g. resize clamp).
  useEffect(() => { posRef.current = pos; }, [pos]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      dragging.current = true;
      hasDragged.current = false;
      // Read the *latest* position from the ref, not from a stale closure.
      offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
      pointerStart.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragging.current) return;
      e.preventDefault();
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      if (!hasDragged.current && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
      hasDragged.current = true;
      const next = {
        x: Math.max(BUBBLE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, e.clientX - offset.current.x)),
        y: Math.max(BUBBLE_MARGIN, Math.min(window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN, e.clientY - offset.current.y)),
      };
      posRef.current = next;
      setPos(next);
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragging.current) return;
      e.preventDefault();
      dragging.current = false;
    },
    [],
  );

  const onPointerCancel = useCallback(() => {
    dragging.current = false;
    hasDragged.current = false;
  }, []);

  useEffect(() => {
    const handler = () =>
      setPos((p) => {
        const next = {
          x: Math.max(BUBBLE_MARGIN, Math.min(p.x, window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN)),
          y: Math.max(BUBBLE_MARGIN, Math.min(p.y, window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN)),
        };
        posRef.current = next;
        return next;
      });
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const snapToTopRight = useCallback(() => {
    const next = {
      x: window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN,
      y: BUBBLE_MARGIN,
    };
    posRef.current = next;
    setPos(next);
  }, []);

  return { pos, hasDragged, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, snapToTopRight };
}

// ---------------------------------------------------------------------------
// Widget component
// ---------------------------------------------------------------------------
const DevBubbleWidget: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { pos, hasDragged, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, snapToTopRight } =
    useDrag(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, BUBBLE_MARGIN);

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const wasDrag = hasDragged.current;
      onPointerUp(e);
      // Open only on tap, not after a drag.
      if (!wasDrag) setIsOpen(true);
    },
    [hasDragged, onPointerUp],
  );

  const panelHeader = (
    <div className="db-header">
      <button
        className="db-header-btn"
        aria-label="Home"
        title="Back to dashboard"
        onClick={() => { window.location.href = DASHBOARD_URL; }}
      >
        <IconHome />
      </button>
      <span className="db-header-title">Workspace</span>
      <button
        className="db-header-btn"
        aria-label="Minimize"
        onClick={() => {
          snapToTopRight();
          setIsOpen(false);
        }}
      >
        <IconMinimize />
      </button>
    </div>
  );

  return (
    <>
      {/* Panel */}
      <div className={`db-panel${isOpen ? "" : " hidden"}`}>
        <WorkspaceShell
          opencodeUrl={OPENCODE_URL}
          header={panelHeader}
        />
      </div>

      {/* Floating bubble */}
      {!isOpen && (
        <button
          className="db-btn"
          aria-label="Open assistant"
          style={{ left: pos.x, top: pos.y }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={onPointerCancel}
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

  // Inject styles (both shell + widget)
  const style = document.createElement("style");
  style.textContent = WORKSPACE_SHELL_CSS + WIDGET_CSS;
  document.head.appendChild(style);

  // Create mount point
  const container = document.createElement("div");
  container.id = "__dev-bubble-root";
  document.body.appendChild(container);

  createRoot(container).render(<DevBubbleWidget />);
})();
