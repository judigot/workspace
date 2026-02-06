import { serve } from "@hono/node-server";
import { app } from "./app.js";

const PORT = Number(process.env.DASHBOARD_API_PORT) || 3100;

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.error(
    `Dashboard API running on http://localhost:${String(info.port)}`,
  );
});
