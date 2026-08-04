import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // グローバルは使わない。describe / it / expect は明示的に import する。
    globals: false,
    reporters: ["default"],
  },
});
