import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 集成测试环境加载。
 *
 * 集成测试需要 `.env` 中的 `DATABASE_TEST_URL`，而 Node 默认不读取 `.env`，
 * 因此这里显式加载仓库根目录的 `.env`。已存在的环境变量优先，不会被文件覆盖。
 */
const envPath = fileURLToPath(new URL("../../../../../.env", import.meta.url));

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
