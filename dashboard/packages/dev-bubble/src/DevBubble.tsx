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
  /** Current app iframe URL (shown in the URL bar) */
  appUrl?: string;
  /** Called when user navigates to a new URL via the URL bar */
  onNavigate?: (url: string) => void;
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
  appUrl = "",
  onNavigate,
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
  const [urlInput, setUrlInput] = useState(appUrl);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Sync URL bar when app changes externally
  useEffect(() => {
    setUrlInput(appUrl);
  }, [appUrl]);

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

        {/* URL bar for app navigation */}
        {onNavigate !== undefined && appUrl !== "" && (
          <form
            className={styles.urlBar}
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = urlInput.trim();
              if (trimmed !== "" && trimmed !== appUrl) {
                onNavigate(trimmed);
              }
              urlInputRef.current?.blur();
            }}
          >
            <svg className={styles.urlBarIcon} viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
            <input
              ref={urlInputRef}
              type="text"
              className={styles.urlBarInput}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button type="submit" className={styles.urlBarGo} aria-label="Navigate">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            </button>
          </form>
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
