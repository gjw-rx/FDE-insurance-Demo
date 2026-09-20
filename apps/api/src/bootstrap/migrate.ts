import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  describeDatabaseTarget,
  loadDatabaseConfig,
} from "../config/database-config.js";
import {
  describeMigrateFailure,
  migrateDatabase,
} from "../infrastructure/database/migrate-database.js";

/**
 * 迁移进程入口。
 *
 * 由发布流程显式调用（`pnpm --filter @renewal/api db:migrate`），API 进程不会在
 * 启动时执行迁移。失败以非零退出码结束，输出只包含稳定标识，不含连接地址、
 * 凭据或驱动错误细节。
 */

/** 迁移文件目录：源码运行（tsx）时为 `apps/api/drizzle`。 */
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);

export async function runMigrateProcess(): Promise<void> {
  try {
    const config = loadDatabaseConfig();
    await migrateDatabase({ config, migrationsFolder: MIGRATIONS_FOLDER });
    process.stdout.write(
      `${JSON.stringify({
        event: "db.migrate.completed",
        target: describeDatabaseTarget(config.target),
      })}\n`,
    );
  } catch (error) {
    // 只输出稳定标识：连接串、用户名、密码与驱动错误细节都不进入输出。
    process.stderr.write(
      `${JSON.stringify({
        event: "db.migrate.failed",
        reason: describeMigrateFailure(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(resolve(entry)).href
) {
  await runMigrateProcess();
}
