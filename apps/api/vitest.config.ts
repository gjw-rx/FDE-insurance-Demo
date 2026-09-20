import { defineConfig } from "vitest/config";

/**
 * 单元与应用级测试配置。
 *
 * 真实数据库集成测试（`test/integration/**`）被显式排除：普通 `test` 不访问外部
 * 服务、不需要凭据，集成测试必须通过 `test:integration` 显式运行。
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**", "**/node_modules/**"],
  },
});
