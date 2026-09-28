import path from "node:path";
import { defineConfig } from "vitest/config";

// Backend test runner (roadmap §11.4). Only tests/backend/** run here;
// the legacy self-contained harness under lib/sourceintel/__tests__ keeps
// its own tsc-based invocation and is deliberately excluded.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  test: {
    environment: "node",
    include: ["tests/backend/**/*.test.ts"],
    // Integration files share one disposable test database (schema resets,
    // TRUNCATEs); files must not run concurrently against it.
    fileParallelism: false,
  },
});
