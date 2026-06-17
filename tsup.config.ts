import { defineConfig } from "tsup";

// Two entry points: the CLI bin (with a shebang) and the programmatic API.
export default defineConfig({
  entry: { bin: "src/cli/bin.ts", index: "src/index.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: { entry: { index: "src/index.ts" } },
  sourcemap: true,
  clean: true,
  splitting: false,
  // bin.ts carries its own `#!/usr/bin/env node` shebang, which esbuild preserves.
});
