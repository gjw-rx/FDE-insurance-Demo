import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/** API 进程生命周期测试：启动、liveness、公开路由可访问与 SIGTERM 优雅退出。 */

const mainPath = fileURLToPath(
  new URL("../../src/bootstrap/main.ts", import.meta.url),
);
const processes: ChildProcess[] = [];

afterEach(() => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
});

/** 进程启动摘要（`api.started` 事件）。 */
interface ApiStartupSummary {
  readonly address: string;
  readonly agentBaseUrl: string;
  readonly databaseTarget: string;
}

/** 等待子进程 stdout 首行启动摘要。 */
async function waitForStarted(child: ChildProcess): Promise<ApiStartupSummary> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error("等待 API 启动超时")),
      10_000,
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split("\n").find((value) => value.trim() !== "");
      if (line === undefined) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line) as ApiStartupSummary);
    });
    const onExit = (code: number | null): void => {
      clearTimeout(timeout);
      reject(new Error(`API 提前退出 (${code}): ${stderr}`));
    };
    child.once("exit", onExit);
  });
}

/** 等待子进程退出并返回退出码。 */
async function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("等待 API 退出超时")),
      10_000,
    );
    const onExit = (code: number | null): void => {
      clearTimeout(timeout);
      resolve(code);
    };
    child.once("exit", onExit);
  });
}

describe("api 进程生命周期", () => {
  it("启动后 liveness 与公开路由可访问，SIGTERM 后正常退出", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", mainPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        API_PORT: "0",
        // 生命周期测试只验证进程与公开路由，不要求真实数据库：指向必然不可达的
        // 本地端口即可。这也是「启动成功 ≠ 数据库可用」的验证前提。
        DATABASE_URL:
          "mysql://lifecycle_user:lifecycle_password@127.0.0.1:1/renewal",
        DATABASE_TLS_MODE: "disabled",
        DATABASE_ALLOW_INSECURE_TLS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);

    const started = await waitForStarted(child);
    expect(started.address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    // 启动摘要只包含脱敏连接目标：凭据与完整连接串不得进入日志。
    expect(started.databaseTarget).toBe("127.0.0.1:1/renewal");
    expect(JSON.stringify(started)).not.toContain("lifecycle_password");
    expect(JSON.stringify(started)).not.toContain("mysql://");

    const live = await fetch(`${started.address}/health/live`);
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ status: "ok" });

    // 公开路由已注册：无效请求返回 400（而不是 404）。
    const invalid = await fetch(`${started.address}/api/chat/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);

    // 会话路由已装配到组合根：可创建并列出会话（本次为进程内存储）。
    const created = await fetch(`${started.address}/api/chat/sessions`, {
      method: "POST",
    });
    expect(created.status).toBe(201);
    const listed = await fetch(`${started.address}/api/chat/sessions`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      sessions: [{ title: "新会话", titleSource: "default" }],
    });

    child.kill("SIGTERM");
    await expect(waitForExit(child)).resolves.toBe(0);
  });
});
