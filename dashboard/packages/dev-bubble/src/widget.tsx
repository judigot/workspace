/**
 * DevBubble standalone widget (React).
 * Injected into app pages via nginx sub_filter.
 * Compiled to a self-contained IIFE bundle that includes React+ReactDOM.
 *
 * Behavior modeled after Facebook Messenger chat heads on Android:
 *   - Draggable bubble that snaps to nearest screen edge on release
 *   - Smooth morph transition: bubble scales down as panel slides up from bottom
 *   - Panel is always mounted (iframe never reloads)
 *   - Minimize slides panel down and restores bubble
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BUBBLE_SIZE = 60;
const BUBBLE_MARGIN = 12;
/** Minimum px movement before a gesture counts as drag (absorbs finger jitter). */
const DRAG_THRESHOLD = 10;
/** Duration for edge-snap and open/close animations (ms). */
const SNAP_DURATION = 300;
const PANEL_DURATION = 350;

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
    width: ${BUBBLE_SIZE}px;
    height: ${BUBBLE_SIZE}px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border: none;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    z-index: 100000;
    touch-action: none;
    user-select: none;
    padding: 0;
    /* transition applied dynamically via .db-btn-snapping */
    transition: none;
  }
  .db-btn:active { cursor: grabbing; }

  /* Applied after drag ends for smooth edge-snap */
  .db-btn-snapping {
    transition: left ${SNAP_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                top ${SNAP_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1);
  }

  /* Bubble open/close animations */
  .db-btn-opening {
    transition: transform ${PANEL_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${PANEL_DURATION}ms ease;
    transform: scale(0);
    opacity: 0;
    pointer-events: none;
  }
  .db-btn-closing {
    transition: transform ${PANEL_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${PANEL_DURATION}ms ease;
    transform: scale(1);
    opacity: 1;
  }

  @media (hover: hover) {
    .db-btn:not(.db-btn-opening):hover {
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
    transform: translateY(100%);
    opacity: 0;
    transition: transform ${PANEL_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${PANEL_DURATION * 0.6}ms ease;
    will-change: transform, opacity;
    pointer-events: none;
  }
  .db-panel-open {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }
  .db-panel-hidden {
    /* Initial state before first open: completely hidden, no transition */
    visibility: hidden;
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
    transition: background 0.15s;
  }
  .db-header-btn:hover { background: rgba(255,255,255,0.3); }
  .db-header-btn:active { background: rgba(255,255,255,0.4); }

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
// Drag hook with edge-snapping (Messenger-style)
// ---------------------------------------------------------------------------
function useDrag(initialX: number, initialY: number) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [isSnapping, setIsSnapping] = useState(false);
  const posRef = useRef({ x: initialX, y: initialY });
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { posRef.current = pos; }, [pos]);

  const clamp = useCallback((x: number, y: number) => ({
    x: Math.max(BUBBLE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, x)),
    y: Math.max(BUBBLE_MARGIN, Math.min(window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN, y)),
  }), []);

  /** Snap to nearest horizontal edge (left or right). */
  const snapToEdge = useCallback((fromX: number, fromY: number) => {
    const midpoint = window.innerWidth / 2;
    const targetX = fromX + BUBBLE_SIZE / 2 < midpoint
      ? BUBBLE_MARGIN
      : window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
    const clamped = clamp(targetX, fromY);

    // Enable CSS transition, set target, disable transition after it completes.
    setIsSnapping(true);
    posRef.current = clamped;
    setPos(clamped);

    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => {
      setIsSnapping(false);
      snapTimer.current = null;
    }, SNAP_DURATION + 20);
  }, [clamp]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      // Cancel any in-progress snap so dragging feels immediate.
      if (snapTimer.current) {
        clearTimeout(snapTimer.current);
        snapTimer.current = null;
        setIsSnapping(false);
      }
      dragging.current = true;
      hasDragged.current = false;
      offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
      pointerStart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
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
      const next = clamp(e.clientX - offset.current.x, e.clientY - offset.current.y);
      posRef.current = next;
      setPos(next);
    },
    [clamp],
  );

  /** Returns `true` if the gesture was a drag, `false` if it was a tap. */
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>): boolean => {
      if (!dragging.current) return false;
      e.preventDefault();
      const wasDrag = hasDragged.current;
      dragging.current = false;
      hasDragged.current = false;
      // Always snap to nearest edge after drag, like Messenger.
      if (wasDrag) {
        snapToEdge(posRef.current.x, posRef.current.y);
      }
      return wasDrag;
    },
    [snapToEdge],
  );

  const onPointerCancel = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      hasDragged.current = false;
      snapToEdge(posRef.current.x, posRef.current.y);
    }
  }, [snapToEdge]);

  // Clamp + re-snap on window resize.
  useEffect(() => {
    const handler = () => {
      setPos((p) => {
        const next = clamp(p.x, p.y);
        // Re-snap to nearest edge if the bubble ended up floating mid-screen.
        const midpoint = window.innerWidth / 2;
        const edgeX = next.x + BUBBLE_SIZE / 2 < midpoint
          ? BUBBLE_MARGIN
          : window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
        const snapped = clamp(edgeX, next.y);
        posRef.current = snapped;
        return snapped;
      });
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [clamp]);

  return { pos, isSnapping, onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

// ---------------------------------------------------------------------------
// Widget component
// ---------------------------------------------------------------------------
const DevBubbleWidget: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  /** Tracks whether the panel has ever been opened (to avoid initial flash). */
  const [hasOpened, setHasOpened] = useState(false);
  /** Extra class for bubble enter/exit animation. */
  const [bubbleAnim, setBubbleAnim] = useState<"" | "opening" | "closing">("");
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { pos, isSnapping, onPointerDown, onPointerMove, onPointerUp, onPointerCancel } =
    useDrag(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, BUBBLE_MARGIN);

  // ── Open panel (tap on bubble) ──
  const openPanel = useCallback(() => {
    if (!hasOpened) setHasOpened(true);
    // Animate bubble out (scale down + fade).
    setBubbleAnim("opening");
    // Open panel simultaneously.
    setIsOpen(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => {
      setBubbleAnim("");
    }, PANEL_DURATION);
  }, [hasOpened]);

  // ── Close panel (minimize button) ──
  const closePanel = useCallback(() => {
    // Start panel close animation.
    setIsOpen(false);
    // Animate bubble back in (scale up + fade in).
    setBubbleAnim("closing");
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => {
      setBubbleAnim("");
    }, PANEL_DURATION);
  }, []);

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const wasDrag = onPointerUp(e);
      if (!wasDrag) openPanel();
    },
    [onPointerUp, openPanel],
  );

  // Build bubble class list.
  let bubbleClass = "db-btn";
  if (isSnapping) bubbleClass += " db-btn-snapping";
  if (bubbleAnim === "opening") bubbleClass += " db-btn-opening";
  if (bubbleAnim === "closing") bubbleClass += " db-btn-closing";

  // Build panel class list.
  let panelClass = "db-panel";
  if (isOpen) panelClass += " db-panel-open";
  if (!hasOpened) panelClass += " db-panel-hidden";

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
        onClick={closePanel}
      >
        <IconMinimize />
      </button>
    </div>
  );

  return (
    <>
      {/* Panel — always mounted so iframe never reloads */}
      <div className={panelClass}>
        <WorkspaceShell
          opencodeUrl={OPENCODE_URL}
          header={panelHeader}
        />
      </div>

      {/* Floating bubble — always mounted, animated via CSS classes */}
      <button
        className={bubbleClass}
        aria-label="Open assistant"
        style={{
          left: pos.x,
          top: pos.y,
          // Hide bubble visually when panel is fully open and animation done.
          ...(isOpen && bubbleAnim === "" ? { transform: "scale(0)", opacity: 0, pointerEvents: "none" as const } : {}),
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={onPointerCancel}
      >
        <IconChat />
      </button>
    </>
  );
};

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------
(function mount() {
  if (document.getElementById("__dev-bubble-root")) return;

  const style = document.createElement("style");
  style.textContent = WORKSPACE_SHELL_CSS + WIDGET_CSS;
  document.head.appendChild(style);

  const container = document.createElement("div");
  container.id = "__dev-bubble-root";
  document.body.appendChild(container);

  createRoot(container).render(<DevBubbleWidget />);
})();
