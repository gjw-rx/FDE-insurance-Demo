import { defineConfig } from "vitest/config";

/**
 * 真实数据库集成测试配置。
 *
 * 只收集 `test/integration/**`，并在执行前从仓库根 `.env` 读取 `DATABASE_TEST_URL`。
 * 集成测试直接操作远程 MySQL，因此串行执行文件，避免迁移与清理互相干扰。
 */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.integration.test.ts"],
    setupFiles: ["test/integration/setup/load-env.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
