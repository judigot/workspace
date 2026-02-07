import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { app } from "./app.js";
import { registerTerminalWebSocketRoute } from "./terminal.js";

const PORT = Number(process.env.DASHBOARD_API_PORT) || 3100;

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
registerTerminalWebSocketRoute(app, upgradeWebSocket);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.error(
    `Dashboard API running on http://localhost:${String(info.port)}`,
  );
});

injectWebSocket(server);
