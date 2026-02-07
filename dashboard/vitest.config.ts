import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: ".",
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".worktrees/**",
      ".apps/**",
      "apps/**",
    ],
  },
});
