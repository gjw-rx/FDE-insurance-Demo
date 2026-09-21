import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 迁移命令运行器（测试用）。
 *
 * 与 `package.json` 的 `db:migrate` 使用同一入口，因此测试验证的是发布流程真正
 * 会执行的代码路径，而不是测试专用的替代实现。
 */

/** 迁移进程入口路径。 */
export const MIGRATE_ENTRY = fileURLToPath(
  new URL("../../src/bootstrap/migrate.ts", import.meta.url),
);

export interface MigrateRunResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const MIGRATE_TIMEOUT_MS = 60_000;

/** 以给定环境变量运行一次迁移命令并等待退出。 */
export function runMigrate(env: NodeJS.ProcessEnv): Promise<MigrateRunResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", MIGRATE_ENTRY],
      { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("迁移命令执行超时"));
    }, MIGRATE_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}
