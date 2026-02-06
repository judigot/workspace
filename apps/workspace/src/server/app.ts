import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const WORKSPACE_ENV =
  process.env.WORKSPACE_ENV_PATH || "/home/ubuntu/workspace/.env";

interface IApp {
  slug: string;
  type: "frontend" | "fullstack" | "laravel";
  frontendPort: number | null;
  backendPort: number | null;
  options: string[];
  url: string;
  status: "up" | "down" | "unknown";
}

interface IConfig {
  domain: string;
  opencodeDomain: string;
  apps: IApp[];
}

interface IRawApp {
  slug: string;
  type: "frontend" | "fullstack" | "laravel";
  frontendPort: number | null;
  backendPort: number | null;
  options: string[];
}

function parseEnv(): { domain: string; opencodeDomain: string; apps: IRawApp[] } {
  const defaults = {
    domain: "judigot.com",
    opencodeDomain: "opencode.judigot.com",
    apps: [] as IRawApp[],
  };

  try {
    const content = readFileSync(WORKSPACE_ENV, "utf-8");
    const vars: Record<string, string> = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        continue;
      }
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) {
        continue;
      }
      const key = trimmed.slice(0, eqIdx);
      let value = trimmed.slice(eqIdx + 1);
      /* Strip surrounding quotes */
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }

    const domain = vars["DOMAIN"] || defaults.domain;
    const opencodeDomain =
      vars["OPENCODE_SUBDOMAIN"] || `opencode.${domain}`;

    const appsEnv = vars["APPS"] || "";
    const viteApps = vars["VITE_APPS"] || "";

    let apps: IRawApp[];

    if (appsEnv.trim()) {
      /* New format: slug:type:frontend_port[:backend_port[:options]] */
      apps = appsEnv
        .trim()
        .split(/\s+/)
        .filter((entry) => entry.includes(":"))
        .map((entry) => {
          const parts = entry.split(":");
          const slug = parts[0];
          const type = (parts[1] || "frontend") as IRawApp["type"];
          const frontendPort = parts[2] ? Number(parts[2]) : null;
          const backendPort = parts[3] ? Number(parts[3]) : null;
          const options = parts[4] ? parts[4].split(",") : [];
          return { slug, type, frontendPort, backendPort, options };
        });
    } else if (viteApps.trim()) {
      /* Legacy format: slug:port */
      apps = viteApps
        .trim()
        .split(/\s+/)
        .filter((entry) => entry.includes(":"))
        .map((entry) => {
          const [slug, portStr] = entry.split(":");
          return {
            slug,
            type: "frontend" as const,
            frontendPort: Number(portStr),
            backendPort: null,
            options: [],
          };
        });
    } else {
      apps = [];
    }

    return { domain, opencodeDomain, apps };
  } catch {
    return defaults;
  }
}

function checkPort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host, timeout: 500 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export const app = new Hono();

app.use("/*", cors());

app.get("/api/apps", async (c) => {
  const { domain, opencodeDomain, apps: rawApps } = parseEnv();

  const apps: IApp[] = await Promise.all(
    rawApps.map(async (raw) => {
      let status: IApp["status"] = "unknown";

      if (raw.type === "laravel") {
        /* Laravel: check backend port */
        if (raw.backendPort) {
          status = (await checkPort(raw.backendPort)) ? "up" : "down";
        } else {
          status = "down";
        }
      } else if (raw.type === "fullstack") {
        /* Fullstack: check both, but frontend is the primary indicator */
        const frontendUp = raw.frontendPort
          ? await checkPort(raw.frontendPort)
          : false;
        status = frontendUp ? "up" : "down";
      } else {
        /* Frontend: check frontend port */
        if (raw.frontendPort) {
          status = (await checkPort(raw.frontendPort)) ? "up" : "down";
        } else {
          status = "down";
        }
      }

      return {
        slug: raw.slug,
        type: raw.type,
        frontendPort: raw.frontendPort,
        backendPort: raw.backendPort,
        options: raw.options,
        url: `https://${domain}/${raw.slug}/`,
        status,
      };
    }),
  );

  const config: IConfig = { domain, opencodeDomain, apps };
  return c.json(config);
});

app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});
