import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FC,
  type ReactNode,
} from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

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

type WorkspaceMode = "assistant" | "terminal";

export interface WorkspaceShellProps {
  opencodeUrl: string;
  header?: ReactNode;
  className?: string;
  mode?: WorkspaceMode;
  terminalWsPath?: string;
}

type TerminalShortcut = {
  label: string;
  value: string;
  kind?: "ctrl";
};

const CUSTOM_TERMINAL_KEYS: TerminalShortcut[] = [
  { label: "Esc", value: "\u001b" },
  { label: "Tab", value: "\t" },
  { label: "Ctrl", value: "", kind: "ctrl" },
  { label: "/", value: "/" },
];

// Feature toggle: keep custom terminal UX code, but ship defaults for stability.
const useDefault = true;

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
      // ignore
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

const TerminalSurface: FC<{ terminalWsPath: string; active: boolean }> = ({
  terminalWsPath,
  active,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [cwdLabel, setCwdLabel] = useState("~");
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const ctrlArmedRef = useRef(false);
  const keys = CUSTOM_TERMINAL_KEYS;

  useEffect(() => {
    ctrlArmedRef.current = ctrlArmed;
  }, [ctrlArmed]);

  const encodeCtrl = useCallback((input: string): string => {
    if (!input) return input;
    const char = input[0];
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122) {
      return String.fromCharCode(code - 96);
    }
    if (code >= 65 && code <= 90) {
      return String.fromCharCode(code - 64);
    }
    return input;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isMobile = window.matchMedia("(max-width: 768px)").matches;

    const term = useDefault
      ? new Terminal()
      : new Terminal({
          cursorBlink: true,
          cursorStyle: "block",
          convertEol: true,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: isMobile ? 12 : 14,
          lineHeight: isMobile ? 1.2 : 1.3,
          letterSpacing: 0,
          scrollback: 10_000,
          theme: {
            background: "#0b0d12",
            foreground: "#e8ecf4",
            cursor: "#7dd3fc",
            cursorAccent: "#0b0d12",
            black: "#1e2430",
            brightBlack: "#4b5563",
          },
        });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitRef.current = fitAddon;
    term.open(container);
    fitAddon.fit();
    term.focus();
    termRef.current = term;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}${terminalWsPath}`);
    wsRef.current = ws;

    const sendResize = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.addEventListener("open", () => {
      sendResize();
      term.focus();
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as
          | { type: "output"; data: string }
          | { type: "exit"; code: number }
          | { type: "cwd"; path: string }
          | { type: "pong" };
        if (parsed.type === "output") {
          term.write(parsed.data);
          return;
        }
        if (parsed.type === "cwd") {
          setCwdLabel(parsed.path || "~");
          return;
        }
        if (parsed.type === "exit") {
          term.writeln(`\r\n\x1b[31mTerminal exited (${String(parsed.code)})\x1b[0m`);
          return;
        }
      } catch {
        term.write(event.data);
      }
    });

    ws.addEventListener("close", () => {
      // Keep UI quiet; reconnect state is reflected by socket availability.
    });

    const dataDisposable = term.onData((data) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const armed = ctrlArmedRef.current;
      const payload = armed ? encodeCtrl(data) : data;
      ws.send(JSON.stringify({ type: "input", data: payload }));
      if (armed) {
        ctrlArmedRef.current = false;
        setCtrlArmed(false);
      }
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    });

    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    observer.observe(container);

    const viewport = window.visualViewport;
    const onViewportResize = () => {
      fitAddon.fit();
      sendResize();
    };
    viewport?.addEventListener("resize", onViewportResize);

    // If any fonts finish loading later, re-fit once to keep cursor alignment correct.
    // (Best practice from xterm docs when fonts can change metrics.)
    void document.fonts?.ready.then(() => {
      fitAddon.fit();
      sendResize();
    });

    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", onViewportResize);
      resizeDisposable.dispose();
      dataDisposable.dispose();
      try {
        ws.close();
      } catch {
        // no-op
      }
      term.dispose();
      wsRef.current = null;
      termRef.current = null;
      fitRef.current = null;
    };
  }, [terminalWsPath, encodeCtrl]);

  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    termRef.current?.focus();
    const ws = wsRef.current;
    const term = termRef.current;
    if (ws && term && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    }
  }, [active]);

  const sendShortcut = useCallback((shortcut: TerminalShortcut) => {
    const ws = wsRef.current;
    const term = termRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (shortcut.kind === "ctrl") {
      ctrlArmedRef.current = true;
      setCtrlArmed(true);
      term?.focus();
      return;
    }
    const armed = ctrlArmedRef.current;
    const payload = armed ? encodeCtrl(shortcut.value) : shortcut.value;
    ws.send(JSON.stringify({ type: "input", data: payload }));
    if (armed) {
      ctrlArmedRef.current = false;
      setCtrlArmed(false);
    }
    term?.focus();
  }, [encodeCtrl]);

  return (
    <div className={`ws-terminal-root${useDefault ? " ws-terminal-default" : " ws-terminal-custom"}`}>
      <div className="ws-terminal-keys" aria-label="Terminal shortcuts">
        {keys.map((shortcut) => (
          <button
            key={shortcut.label}
            type="button"
            className={`ws-terminal-key${
              shortcut.kind === "ctrl"
                  ? " ws-terminal-key-meta"
                  : ""
            }${shortcut.kind === "ctrl" && ctrlArmed ? " ws-terminal-key-active" : ""}`}
            onClick={() => sendShortcut(shortcut)}
          >
            {shortcut.label}
          </button>
        ))}
      </div>
      <div className="ws-terminal-title" aria-live="polite">
        {cwdLabel}
      </div>
      <div className="ws-terminal-stage" ref={containerRef} />
    </div>
  );
};

export const WorkspaceShell: FC<WorkspaceShellProps> = ({
  opencodeUrl,
  header,
  className,
  mode = "assistant",
  terminalWsPath = "/api/terminal/ws",
}) => {
  const { config, loading } = useApps();
  const currentSlug =
    window.location.pathname.split("/").filter(Boolean)[0] ?? "";

  return (
    <div className={`ws-shell${className ? ` ${className}` : ""}`}>
      {header}

      <div className="ws-strip">
        <span className="ws-strip-label">Apps</span>
        <div className="ws-strip-scroll">
          {loading && <span className="ws-strip-loading">Loading...</span>}

          {config?.apps.map((app) => (
            <a
              key={app.slug}
              href={app.url}
              className={`ws-chip${app.slug === currentSlug ? " ws-chip-active" : ""}`}
              title={app.url}
            >
              <span className="ws-chip-icon">{app.slug.charAt(0).toUpperCase()}</span>
              <span className="ws-chip-name">{app.slug}</span>
              <span className={`ws-chip-dot ws-chip-dot-${app.status}`} />
            </a>
          ))}

          {config && config.apps.length === 0 && !loading && (
            <span className="ws-strip-loading">No apps</span>
          )}
        </div>
      </div>

      <div className="ws-content">
        <div
          className={`ws-pane ws-pane-assistant${mode === "assistant" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <iframe
            className="ws-iframe"
            src={opencodeUrl}
            title="OpenCode"
            allow="clipboard-read; clipboard-write; microphone"
          />
        </div>

        <div
          className={`ws-pane ws-pane-terminal${mode === "terminal" ? " ws-pane-active" : " ws-pane-hidden"}`}
        >
          <TerminalSurface terminalWsPath={terminalWsPath} active={mode === "terminal"} />
        </div>
      </div>
    </div>
  );
};

export const WORKSPACE_SHELL_CSS = `
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

  .ws-strip {
    display: flex;
    align-items: center;
    padding: 8px 0 8px 12px;
    background: #161627;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    overflow: hidden;
  }
  .ws-strip-label {
    color: rgba(255,255,255,0.65);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0 8px 0 2px;
    flex-shrink: 0;
  }
  .ws-strip-scroll {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex: 1;
    min-width: 0;
    padding-right: 12px;
  }
  .ws-strip-scroll::-webkit-scrollbar { display: none; }
  .ws-strip-loading {
    color: #8891a8;
    font-size: 12px;
    padding: 6px 10px;
    white-space: nowrap;
  }

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

  .ws-iframe {
    height: 100%;
    width: 100%;
    border: none;
    background: #0f0f1a;
  }

  .ws-content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .ws-pane {
    position: absolute;
    inset: 0;
    min-height: 0;
  }
  .ws-pane-active {
    visibility: visible;
    opacity: 1;
    pointer-events: auto;
  }
  .ws-pane-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
  }

  .ws-terminal-root {
    height: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #101722 0%, #0a0f17 22%, #07090d 100%);
  }
  .ws-terminal-default {
    background: #0b0d12;
  }
  .ws-terminal-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 0;
    overflow: hidden;
  }
  .ws-terminal-stage .xterm {
    height: 100%;
  }
  .ws-terminal-keys {
    display: flex;
    align-items: center;
    gap: 7px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 9px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.12);
    background: linear-gradient(180deg, rgba(20,28,40,0.96), rgba(13,19,28,0.94));
    backdrop-filter: blur(10px);
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
  }
  .ws-terminal-keys::-webkit-scrollbar { display: none; }
  .ws-terminal-title {
    flex-shrink: 0;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: rgba(220, 232, 248, 0.9);
    padding: 7px 10px 6px;
    background: linear-gradient(180deg, rgba(17, 25, 37, 0.95), rgba(12, 17, 25, 0.92));
    border-bottom: 1px solid rgba(255,255,255,0.08);
    text-shadow: 0 1px 8px rgba(0, 0, 0, 0.35);
  }
  .ws-terminal-key {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    border: 1px solid rgba(255,255,255,0.18);
    background: linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.05));
    color: #e6edf8;
    border-radius: 11px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    height: 34px;
    min-width: 58px;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.22);
    transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
  }
  .ws-terminal-key:active {
    background: linear-gradient(180deg, rgba(125, 211, 252, 0.24), rgba(125, 211, 252, 0.12));
    border-color: rgba(125, 211, 252, 0.46);
    transform: translateY(1px);
  }
  .ws-terminal-key-meta {
    border-color: rgba(129, 140, 248, 0.36);
    color: #dbe4ff;
    min-width: 78px;
  }
  .ws-terminal-key-active {
    border-color: rgba(125, 211, 252, 0.7);
    background: linear-gradient(180deg, rgba(125, 211, 252, 0.36), rgba(125, 211, 252, 0.18));
    color: #f0fbff;
  }

  @media (max-width: 480px) {
    .ws-terminal-key {
      font-size: 10.5px;
      height: 32px;
      min-width: 54px;
      padding: 0 9px;
    }
    .ws-terminal-key-meta {
      min-width: 72px;
    }
  }

  /* xterm.js defaults (kept raw for stability) */
  .xterm {
    cursor: text;
    position: relative;
    user-select: none;
    -ms-user-select: none;
    -webkit-user-select: none;
  }
  .xterm.focus,
  .xterm:focus {
    outline: none;
  }
  .xterm .xterm-helpers {
    position: absolute;
    top: 0;
    z-index: 5;
  }
  .xterm .xterm-helper-textarea {
    padding: 0;
    border: 0;
    margin: 0;
    position: absolute;
    opacity: 0;
    left: -9999em;
    top: 0;
    width: 0;
    height: 0;
    z-index: -5;
    white-space: nowrap;
    overflow: hidden;
    resize: none;
  }
  .xterm .composition-view {
    background: #000;
    color: #fff;
    display: none;
    position: absolute;
    white-space: nowrap;
    z-index: 1;
  }
  .xterm .composition-view.active {
    display: block;
  }
  .xterm .xterm-viewport {
    background-color: #000;
    overflow-y: scroll;
    cursor: default;
    position: absolute;
    right: 0;
    left: 0;
    top: 0;
    bottom: 0;
  }
  .xterm .xterm-screen {
    position: relative;
  }
  .xterm .xterm-screen canvas {
    position: absolute;
    left: 0;
    top: 0;
  }
  .xterm-char-measure-element {
    display: inline-block;
    visibility: hidden;
    position: absolute;
    top: 0;
    left: -9999em;
    line-height: normal;
  }
  .xterm .xterm-accessibility:not(.debug),
  .xterm .xterm-message {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    right: 0;
    z-index: 10;
    color: transparent;
    pointer-events: none;
  }
  .xterm .xterm-accessibility-tree:not(.debug) *::selection {
    color: transparent;
  }
  .xterm .xterm-accessibility-tree {
    font-family: monospace;
    user-select: text;
    white-space: pre;
  }
  .xterm .xterm-accessibility-tree > div {
    transform-origin: left;
    width: fit-content;
  }
  .xterm .live-region {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }
  .xterm.enable-mouse-events {
    cursor: default;
  }
  .xterm.xterm-cursor-pointer,
  .xterm .xterm-cursor-pointer {
    cursor: pointer;
  }
  .xterm.column-select.focus {
    cursor: crosshair;
  }
`;
