import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

const API_PORT = Number(process.env.DASHBOARD_API_PORT) || 3100;

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: true,
    port: 3200,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${String(API_PORT)}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), tsconfigPaths()],
});
