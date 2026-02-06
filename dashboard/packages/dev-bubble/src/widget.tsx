/**
 * DevBubble standalone widget (React).
 * Injected into app pages via nginx sub_filter.
 * Compiled to a self-contained IIFE bundle that includes React+ReactDOM.
 *
 * Behavior modeled after Facebook Messenger chat heads on Android:
 *   - Bubble is ALWAYS visible -- it never disappears
 *   - Draggable with edge-snapping after release
 *   - On tap: bubble repositions to top-right, home button slides out to its
 *     left, chat panel slides down below the bubble row
 *   - On minimize (tap bubble again): home button slides back, panel closes,
 *     bubble returns to its previous edge position
 *   - No header bar inside the panel -- the bubble row IS the header
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
/** Gap between home button and bubble, and bubble to chat — all equal to BUBBLE_MARGIN. */
const BUTTON_GAP = BUBBLE_MARGIN;
/** Minimum px before a gesture counts as drag. */
const DRAG_THRESHOLD = 10;
/** Duration for bubble reposition animations (ms). */
const ANIM_DURATION = 350;
/** Delay before home button starts sliding out (minimal -- starts almost immediately). */
const HOME_REVEAL_DELAY = 50;
/** Duration for home button slide animation. */
const HOME_SLIDE_DURATION = 250;

// ---------------------------------------------------------------------------
// Config from script tag
// ---------------------------------------------------------------------------
const scriptTag = document.currentScript as HTMLScriptElement | null;
const OPENCODE_URL =
  scriptTag?.getAttribute("data-opencode-url") ??
  "https://opencode.judigot.com";
const DASHBOARD_URL =
  scriptTag?.getAttribute("data-dashboard-url") ?? "/";

/** Bubble docked X position (top-right edge). */
function dockedX() {
  return window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
}

// ---------------------------------------------------------------------------
// Styles
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

  /* ── Bubble ── always visible */
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
    outline: none;
    transition: none;
    /* Entry animation on page load */
    animation: db-btn-enter ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1) both;
  }
  @keyframes db-btn-enter {
    from { transform: scale(0); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }
  .db-btn:active { cursor: grabbing; }
  .db-btn-animating {
    transition: left ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                box-shadow ${ANIM_DURATION}ms ease;
  }
  .db-btn-active {
    box-shadow: 0 2px 12px rgba(102, 126, 234, 0.3);
    cursor: pointer;
  }
  @media (hover: hover) {
    .db-btn:hover {
      box-shadow: 0 6px 28px rgba(102, 126, 234, 0.5);
    }
  }

  /* ── Home button ── same size as bubble, slides in from behind bubble */
  .db-home {
    position: fixed;
    width: ${BUBBLE_SIZE}px;
    height: ${BUBBLE_SIZE}px;
    border-radius: 50%;
    background: linear-gradient(135deg, #2d3436 0%, #636e72 100%);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 99999;
    padding: 0;
    outline: none;
    /* Start hidden behind the bubble (translated right) */
    transform: translateX(${BUBBLE_SIZE + BUTTON_GAP}px) scale(0.8);
    opacity: 0;
    pointer-events: none;
    /* Transition position (follows bubble) + reveal transform together */
    transition: left ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                transform ${HOME_SLIDE_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${HOME_SLIDE_DURATION}ms ease;
  }
  .db-home-visible {
    transform: translateX(0) scale(1);
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: hover) {
    .db-home:hover {
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    }
  }

  /* ── Chat panel ── anchored below the bubble row */
  .db-panel {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: #0f1115;
    z-index: 99998;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: top ${ANIM_DURATION}ms cubic-bezier(0.25, 1, 0.5, 1),
                opacity ${ANIM_DURATION}ms ease;
    will-change: top, opacity;
  }
  .db-panel-closed {
    opacity: 0;
    pointer-events: none;
  }
  .db-panel-open {
    opacity: 1;
    pointer-events: auto;
  }
  .db-panel-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .db-panel .ws-shell {
    flex: 1;
    min-height: 0;
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

const IconHome: FC = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function clamp(x: number, y: number) {
  return {
    x: Math.max(BUBBLE_MARGIN, Math.min(window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN, x)),
    y: Math.max(BUBBLE_MARGIN, Math.min(window.innerHeight - BUBBLE_SIZE - BUBBLE_MARGIN, y)),
  };
}

function snapX(fromX: number) {
  const mid = window.innerWidth / 2;
  return fromX + BUBBLE_SIZE / 2 < mid
    ? BUBBLE_MARGIN
    : window.innerWidth - BUBBLE_SIZE - BUBBLE_MARGIN;
}

// ---------------------------------------------------------------------------
// Widget component
// ---------------------------------------------------------------------------
const DevBubbleWidget: FC = () => {
  // ── Bubble position ──
  const [pos, setPos] = useState(() => clamp(dockedX(), BUBBLE_MARGIN));
  const posRef = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // ── Animation flag ──
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Panel state ──
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  // ── Home button visibility (staggered after bubble docks) ──
  const [homeVisible, setHomeVisible] = useState(false);
  const homeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Saved position before opening ──
  const savedPos = useRef<{ x: number; y: number } | null>(null);

  // ── Drag refs ──
  const dragging = useRef(false);
  const hasDragged = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const pointerStart = useRef({ x: 0, y: 0 });

  // Animate bubble to a position.
  const animateTo = useCallback((target: { x: number; y: number }, onDone?: () => void) => {
    if (animTimer.current) clearTimeout(animTimer.current);
    setAnimating(true);
    posRef.current = target;
    setPos(target);
    animTimer.current = setTimeout(() => {
      setAnimating(false);
      animTimer.current = null;
      onDone?.();
    }, ANIM_DURATION + 20);
  }, []);

  // ── Open ── bubble moves and home button reveals simultaneously.
  const openPanel = useCallback(() => {
    savedPos.current = { ...posRef.current };
    if (!hasOpened) setHasOpened(true);
    const target = clamp(dockedX(), BUBBLE_MARGIN);
    setIsOpen(true);
    animateTo(target);
    // Reveal home button early -- starts sliding out as bubble is still moving.
    if (homeTimer.current) clearTimeout(homeTimer.current);
    homeTimer.current = setTimeout(() => {
      setHomeVisible(true);
      homeTimer.current = null;
    }, HOME_REVEAL_DELAY);
  }, [hasOpened, animateTo]);

  // ── Close ── everything moves at once, no sequential waiting.
  const closePanel = useCallback(() => {
    setHomeVisible(false);
    setIsOpen(false);
    if (homeTimer.current) {
      clearTimeout(homeTimer.current);
      homeTimer.current = null;
    }
    if (savedPos.current) {
      const snapped = clamp(snapX(savedPos.current.x), savedPos.current.y);
      animateTo(snapped);
      savedPos.current = null;
    }
  }, [animateTo]);

  // ── Edge-snap after drag ──
  const snapToEdge = useCallback((fromX: number, fromY: number) => {
    animateTo(clamp(snapX(fromX), fromY));
  }, [animateTo]);

  // ── Pointer handlers ──
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (isOpen) return; // No dragging while open.
      e.preventDefault();
      if (animTimer.current) {
        clearTimeout(animTimer.current);
        animTimer.current = null;
        setAnimating(false);
      }
      dragging.current = true;
      hasDragged.current = false;
      offset.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
      pointerStart.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [isOpen],
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
    [],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (isOpen) {
        e.preventDefault();
        closePanel();
        return;
      }
      if (!dragging.current) return;
      e.preventDefault();
      const wasDrag = hasDragged.current;
      dragging.current = false;
      hasDragged.current = false;
      if (wasDrag) {
        snapToEdge(posRef.current.x, posRef.current.y);
      } else {
        openPanel();
      }
    },
    [isOpen, closePanel, snapToEdge, openPanel],
  );

  const onPointerCancel = useCallback(() => {
    if (dragging.current) {
      dragging.current = false;
      hasDragged.current = false;
      snapToEdge(posRef.current.x, posRef.current.y);
    }
  }, [snapToEdge]);

  // ── Resize ──
  useEffect(() => {
    const handler = () => {
      if (isOpen) {
        const target = clamp(dockedX(), BUBBLE_MARGIN);
        posRef.current = target;
        setPos(target);
      } else {
        setPos((p) => {
          const snapped = clamp(snapX(p.x), p.y);
          posRef.current = snapped;
          return snapped;
        });
      }
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [isOpen]);

  // ── Layout calculations ──
  // Home button sits to the left of the bubble.
  const homeLeft = pos.x - BUBBLE_SIZE - BUTTON_GAP;
  const homeTop = pos.y;
  // Panel anchored below the bubble row — same spacing as all other gaps.
  const panelTop = pos.y + BUBBLE_SIZE + BUBBLE_MARGIN;
  const panelTopClosed = window.innerHeight + 10;

  // ── Classes ──
  let bubbleClass = "db-btn";
  if (animating) bubbleClass += " db-btn-animating";
  if (isOpen) bubbleClass += " db-btn-active";

  let panelClass = "db-panel";
  if (isOpen) panelClass += " db-panel-open";
  else if (hasOpened) panelClass += " db-panel-closed";
  else panelClass += " db-panel-hidden";

  let homeClass = "db-home";
  if (homeVisible) homeClass += " db-home-visible";

  return (
    <>
      {/* Chat panel — always mounted, no header bar */}
      <div
        className={panelClass}
        style={{ top: isOpen ? panelTop : panelTopClosed }}
      >
        <WorkspaceShell opencodeUrl={OPENCODE_URL} />
      </div>

      {/* Home button — fixed, positioned to bubble's left */}
      <button
        className={homeClass}
        aria-label="Home"
        title="Back to dashboard"
        style={{ left: homeLeft, top: homeTop }}
        onClick={() => { window.location.href = DASHBOARD_URL; }}
      >
        <IconHome />
      </button>

      {/* Bubble — always visible */}
      <button
        className={bubbleClass}
        aria-label={isOpen ? "Minimize chat" : "Open assistant"}
        style={{ left: pos.x, top: pos.y }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
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
