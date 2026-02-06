import { useState, useRef, useEffect, useCallback } from "react";
import styles from "./DevBubble.module.css";

export interface IBubbleApp {
  slug: string;
  url: string;
  status: "up" | "down" | "unknown";
}

interface IDevBubbleProps {
  /** URL to load in the OpenCode iframe */
  url?: string;
  /** List of workspace apps to show in the nav */
  apps?: IBubbleApp[];
  /** Currently active app slug (highlighted in nav) */
  activeSlug?: string | null;
  /** Called when user taps an app in the nav */
  onSelectApp?: (app: IBubbleApp) => void;
  /** Called when user taps "Home" to go back to dashboard */
  onGoHome?: () => void;
}

interface IPosition {
  x: number;
  y: number;
}

export function DevBubble({
  url = "https://opencode.judigot.com",
  apps = [],
  activeSlug = null,
  onSelectApp,
  onGoHome,
}: IDevBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<IPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<IPosition>({ x: 0, y: 0 });
  const [hasDragged, setHasDragged] = useState(false);
  const bubbleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const updatePosition = () => {
      setPosition({
        x: window.innerWidth - 84,
        y: window.innerHeight - 84,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isOpen) return;
      setIsDragging(true);
      setHasDragged(false);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    },
    [isOpen, position],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return;
      setHasDragged(true);
      setPosition({
        x: Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragStart.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragStart.y)),
      });
    },
    [isDragging, dragStart],
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (isOpen) return;
      const touch = e.touches[0];
      if (touch) {
        setIsDragging(true);
        setHasDragged(false);
        setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
      }
    },
    [isOpen, position],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!isDragging) return;
      const touch = e.touches[0];
      if (touch) {
        setHasDragged(true);
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - 60, touch.clientX - dragStart.x)),
          y: Math.max(0, Math.min(window.innerHeight - 60, touch.clientY - dragStart.y)),
        });
      }
    },
    [isDragging, dragStart],
  );

  const handleTouchEnd = useCallback(() => setIsDragging(false), []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove);
      window.addEventListener("touchend", handleTouchEnd);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  const handleClick = () => {
    if (!hasDragged) setIsOpen(!isOpen);
  };

  const showNav = apps.length > 0 || onGoHome !== undefined;

  return (
    <div className={styles.container}>
      {/* Panel — always mounted so the iframe preserves state */}
      <div className={`${styles.panel} ${isOpen ? "" : styles.panelHidden}`}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.title}>OpenCode</span>
          <button
            className={styles.minimizeButton}
            onClick={() => setIsOpen(false)}
            aria-label="Minimize"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M19 13H5v-2h14v2z" />
            </svg>
          </button>
        </div>

        {/* Workspace nav */}
        {showNav && (
          <div className={styles.nav}>
            {onGoHome !== undefined && (
              <button
                className={`${styles.navItem} ${activeSlug === null ? styles.navActive : ""}`}
                onClick={() => {
                  onGoHome();
                  setIsOpen(false);
                }}
              >
                <span className={styles.navIcon}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                  </svg>
                </span>
                <span>Home</span>
              </button>
            )}
            {apps.map((app) => (
              <button
                key={app.slug}
                className={`${styles.navItem} ${app.slug === activeSlug ? styles.navActive : ""}`}
                onClick={() => {
                  onSelectApp?.(app);
                  setIsOpen(false);
                }}
              >
                <span
                  className={`${styles.navDot} ${app.status === "up" ? styles.navDotUp : styles.navDotDown}`}
                />
                <span>{app.slug}</span>
              </button>
            ))}
          </div>
        )}

        {/* OpenCode iframe */}
        <iframe
          src={url}
          className={styles.iframe}
          title="OpenCode"
          allow="clipboard-read; clipboard-write; microphone"
        />
      </div>

      {!isOpen && (
        <button
          ref={bubbleRef}
          className={`${styles.bubble} ${isDragging ? styles.dragging : ""}`}
          style={{
            left: `${String(position.x)}px`,
            top: `${String(position.y)}px`,
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onClick={handleClick}
          aria-label="Open assistant"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
          </svg>
        </button>
      )}
    </div>
  );
}
