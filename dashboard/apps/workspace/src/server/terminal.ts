import type { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import type { IPty } from "node-pty";
import * as pty from "node-pty";
import { readlinkSync } from "node:fs";

type UpgradeWebSocket = ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"];

type TerminalMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "ping" };

type ShellLaunch = {
  shell: string;
  args: string[];
  env: Record<string, string>;
};

const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 36;

function getShellCommand() {
  if (process.platform === "win32") return "powershell.exe";
  return process.env.SHELL || "bash";
}

function getShellLaunch(shell: string): ShellLaunch {
  if (shell.includes("zsh")) {
    return {
      shell,
      args: ["-f", "-i"],
      env: { PS1: "%# ", PROMPT: "%# " },
    };
  }
  if (shell.includes("bash")) {
    return {
      shell,
      args: ["--noprofile", "--norc", "-i"],
      env: { PS1: "$ ", PROMPT_COMMAND: "" },
    };
  }
  return {
    shell,
    args: ["-i"],
    env: { PS1: "$ " },
  };
}

function formatCwdLabel(cwd: string, workspaceRoot: string): string {
  if (cwd === workspaceRoot) return "~";
  if (cwd.startsWith(`${workspaceRoot}/`)) {
    return `~/${cwd.slice(workspaceRoot.length + 1)}`;
  }

  const home = process.env.HOME;
  if (home) {
    if (cwd === home) return "~";
    if (cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  }

  return cwd;
}

function emitCwd(ws: { send: (data: string) => void }, ptyProcess: IPty, workspaceRoot: string) {
  try {
    const cwd = readlinkSync(`/proc/${String(ptyProcess.pid)}/cwd`);
    ws.send(
      JSON.stringify({
        type: "cwd",
        path: formatCwdLabel(cwd, workspaceRoot),
      }),
    );
  } catch {
    // no-op
  }
}

function parseClientMessage(raw: string): TerminalMessage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TerminalMessage>;
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return { type: "input", data: parsed.data };
    }
    if (
      parsed.type === "resize" &&
      typeof parsed.cols === "number" &&
      typeof parsed.rows === "number"
    ) {
      return { type: "resize", cols: parsed.cols, rows: parsed.rows };
    }
    if (parsed.type === "ping") {
      return { type: "ping" };
    }
    return null;
  } catch {
    return null;
  }
}

export function registerTerminalWebSocketRoute(
  app: Hono,
  upgradeWebSocket: UpgradeWebSocket,
) {
  app.get(
    "/api/terminal/ws",
    upgradeWebSocket(() => {
      let ptyProcess: IPty | null = null;
      let isClosed = false;
      let cwdTimer: ReturnType<typeof setTimeout> | null = null;
      let workspaceRoot = process.env.WORKSPACE_ROOT || "/home/ubuntu/workspace";

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        if (cwdTimer) {
          clearTimeout(cwdTimer);
          cwdTimer = null;
        }
        if (ptyProcess) {
          try {
            ptyProcess.kill();
          } catch {
            // no-op
          }
          ptyProcess = null;
        }
      };

      return {
        onOpen(_event, ws) {
          const shell = getShellCommand();
          const launch = getShellLaunch(shell);
          workspaceRoot = process.env.WORKSPACE_ROOT || "/home/ubuntu/workspace";

          ptyProcess = pty.spawn(launch.shell, launch.args, {
            name: "xterm-256color",
            cols: DEFAULT_TERMINAL_COLS,
            rows: DEFAULT_TERMINAL_ROWS,
            cwd: workspaceRoot,
            env: {
              ...process.env,
              TERM: "xterm-256color",
              ...launch.env,
            },
            handleFlowControl: true,
          });

          emitCwd(ws, ptyProcess, workspaceRoot);

          ptyProcess.onData((chunk) => {
            try {
              ws.send(JSON.stringify({ type: "output", data: chunk }));
            } catch {
              cleanup();
            }
          });

          ptyProcess.onExit(({ exitCode }) => {
            try {
              ws.send(
                JSON.stringify({
                  type: "exit",
                  code: exitCode,
                }),
              );
              ws.close(1000, "Terminal process exited");
            } catch {
              // no-op
            } finally {
              cleanup();
            }
          });
        },

        onMessage(event, ws) {
          if (!ptyProcess || isClosed) return;
          if (typeof event.data !== "string") return;

          const message = parseClientMessage(event.data);
          if (!message) {
            ptyProcess.write(event.data);
            return;
          }

          if (message.type === "input") {
            ptyProcess.write(message.data);

            // Emit updated cwd after command submit (enter/newline).
            if (message.data.includes("\r") || message.data.includes("\n")) {
              if (cwdTimer) clearTimeout(cwdTimer);
              cwdTimer = setTimeout(() => {
                cwdTimer = null;
                if (!ptyProcess || isClosed) return;
                emitCwd(ws, ptyProcess, workspaceRoot);
              }, 140);
            }
            return;
          }

          if (message.type === "resize") {
            const cols = Math.max(20, Math.floor(message.cols));
            const rows = Math.max(8, Math.floor(message.rows));
            ptyProcess.resize(cols, rows);
            return;
          }

          if (message.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        },

        onClose() {
          cleanup();
        },

        onError() {
          cleanup();
        },
      };
    }),
  );
}
