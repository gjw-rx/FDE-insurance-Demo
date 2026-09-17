import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInsuranceAgentService } from "./application.js";

/** 进程入口：启动服务、打印启动摘要，并等待 SIGINT/SIGTERM 触发优雅关闭。 */
export async function runInsuranceAgentProcess(): Promise<void> {
  const service = await createInsuranceAgentService();
  const address = await service.listen();
  process.stdout.write(
    `${JSON.stringify({
      event: "insurance-agent.started",
      agentName: service.config.agentName,
      address,
      ready: service.ready,
      reasons: service.reasons,
      warnings: service.warnings,
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
      void service.close().then(resolveShutdown);
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
  runInsuranceAgentProcess().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`insurance-agent failed to start: ${message}\n`);
    process.exitCode = 1;
  });
}
