import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@vid-skills/core": pkg("core"),
      "@vid-skills/providers": pkg("providers"),
      "@vid-skills/distribute": pkg("distribute"),
      "@vid-skills/mcp": pkg("mcp"),
      "@vid-skills/renderer": pkg("renderer"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
