import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "tests/integration/**/*.test.ts"],
    testTimeout: 60000,
    fileParallelism: false,
  },
});
