import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApiApp } from "./application.js";

/** 进程入口：启动 API、打印启动摘要，并等待 SIGINT/SIGTERM 触发优雅关闭。 */
export async function runApiProcess(): Promise<void> {
  const app = await createApiApp();
  const address = await app.listen();
  process.stdout.write(
    `${JSON.stringify({
      event: "api.started",
      address,
      agentBaseUrl: app.config.agentBaseUrl,
    })}\n`,
  );

  await new Promise<void>((resolveShutdown) => {
    let stopping = false;
    // 幂等关闭：重复信号不重复执行，关闭完成后才 resolve 让进程退出。
    const shutdown = (): void => {
      if (stopping) return;
      stopping = true;
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      void app.close().then(resolveShutdown);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(resolve(entry)).href
) {
  runApiProcess().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`api failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
