// vitest.config.ts — fast default suite; forbids real network (msw onUnhandledRequest:error).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    pool: "threads",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli/bin.ts", "**/*.d.ts"],
    },
  },
});
