import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    server: { deps: { inline: ["convex-test"] } },
    coverage: { provider: "v8", include: ["convex/**", "src/lib/**"] },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "edge-runtime",
        },
      },
      {
        // Opt-in only: every test here self-skips unless LIVE_TESTS=1, so this
        // project is safe to leave in the default `npm test` run.
        extends: true,
        test: {
          name: "live",
          include: ["tests/live/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/live/setup.ts"],
          fileParallelism: false,
        },
      },
    ],
  },
});
