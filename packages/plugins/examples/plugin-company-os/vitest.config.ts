import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    // Playwright e2e specs (`*.e2e.spec.ts`) run under the Playwright runner, not vitest.
    exclude: ["tests/**/*.e2e.spec.ts", "node_modules/**", "dist/**"],
    environment: "node",
  },
});
