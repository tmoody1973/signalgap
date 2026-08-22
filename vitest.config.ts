import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    coverage: { provider: "v8", include: ["convex/**", "src/lib/**"] },
    environment: "node",
  },
});
