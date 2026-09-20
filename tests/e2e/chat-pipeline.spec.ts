import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * 端到端链路自动化：真实 API 进程 + fake insurance-agent + 独立 Vite dev server。
 *
 * 验证 Web → API → (fake) insurance-agent → API SSE → Web 完整链路，
 * 全程不需要真实模型凭据。fake Agent 只回放固定增量与终态；断言只使用
 * 消息长度，不保存消息正文。
 */

const API_MAIN = fileURLToPath(
  new URL("../../apps/api/src/bootstrap/main.ts", import.meta.url),
);
const API_CWD = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const WEB_CWD = fileURLToPath(new URL("../../apps/web/", import.meta.url));

interface FakeAgentRun {
  readonly sessionId: string;
  readonly runId: string;
  readonly messageLength: number;
}

/** 启动 fake insurance-agent：记录创建请求（不含正文）并回放 SSE。 */
async function startFakeAgent(): Promise<{
  readonly baseUrl: string;
  readonly runs: FakeAgentRun[];
  close(): Promise<void>;
}> {
  const runs: FakeAgentRun[] = [];
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      if (request.method === "POST" && request.url === "/internal/agent/runs") {
        let body = "";
        request.on("data", (chunk: Buffer) => {
          body += chunk;
        });
        request.on("end", () => {
          const parsed = JSON.parse(body) as {
            sessionId: string;
            runId: string;
            message: string;
          };
          runs.push({
            sessionId: parsed.sessionId,
            runId: parsed.runId,
            messageLength: parsed.message.length,
          });
          response.writeHead(202, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              agentName: "insurance-agent",
              sessionId: parsed.sessionId,
              runId: parsed.runId,
              status: "accepted",
              createdAt: new Date().toISOString(),
            }),
          );
        });
        return;
      }
      if (
        request.method === "GET" &&
        request.url?.startsWith("/internal/agent/runs/") &&
        request.url.endsWith("/events")
      ) {
        const runId = decodeURIComponent(
          request.url.slice("/internal/agent/runs/".length, -"/events".length),
        );
        const run = runs.find((candidate) => candidate.runId === runId);
        if (run === undefined) {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              error: {
                code: "RUN_NOT_FOUND",
                message: "指定的 run 不存在",
                retryable: false,
              },
            }),
          );
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
        });
        const event = (type: string, cursor: number, extra: object = {}) => {
          response.write(
            `id: ${cursor}\ndata: ${JSON.stringify({
              agentName: "insurance-agent",
              sessionId: run.sessionId,
              runId: run.runId,
              cursor,
              at: new Date().toISOString(),
              type,
              ...extra,
            })}\n\n`,
          );
        };
        event("run.accepted", 1);
        event("agent.started", 2);
        event("answer.delta", 3, { text: "链路" });
        event("answer.delta", 4, { text: "验证" });
        event("run.completed", 5);
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    },
  );
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake Agent 未返回监听端口");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    runs,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  };
}

/** 启动真实 API 进程，指向 fake Agent。 */
async function startApi(
  agentBaseUrl: string,
): Promise<{ readonly baseUrl: string; close(): Promise<void> }> {
  const child = spawn(process.execPath, ["--import", "tsx", API_MAIN], {
    cwd: API_CWD,
    env: {
      ...process.env,
      API_PORT: "0",
      AGENT_BASE_URL: agentBaseUrl,
      // 本用例只验证「浏览器 → 业务 API → fake Agent」的对话流，不访问数据库。
      // API 现在要求数据库配置才能启动，因此指向必然不可达的本地端口即可：
      // 连接池创建是惰性的，启动不受影响。
      DATABASE_URL: "mysql://e2e_user:e2e_password@127.0.0.1:1/renewal",
      DATABASE_TLS_MODE: "disabled",
      DATABASE_ALLOW_INSECURE_TLS: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const started = await new Promise<{ address: string }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error("等待 API 启动超时")),
      15_000,
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split("\n").find((value) => value.trim() !== "");
      if (line === undefined) return;
      clearTimeout(timeout);
      resolve(JSON.parse(line) as { address: string });
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`API 提前退出 (${code}): ${stderr}`));
    });
  });
  return {
    baseUrl: started.address,
    close: async () => {
      const exited = new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
      });
      child.kill("SIGTERM");
      await exited;
    },
  };
}

/** 启动独立 Vite dev server，/api 代理指向测试 API。 */
async function startVite(
  apiBaseUrl: string,
): Promise<{ readonly baseUrl: string; close(): Promise<void> }> {
  // vite 是纯 JS bin：直接用 node 运行，避免 tsx/esm loader 干扰。
  const viteBin = fileURLToPath(
    new URL("../../apps/web/node_modules/vite/bin/vite.js", import.meta.url),
  );
  // 随机高位端口 + 轮询就绪，不依赖解析 Vite 彩色输出。
  const port = 5200 + Math.floor(Math.random() * 600);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [viteBin, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: WEB_CWD,
      env: { ...process.env, API_PROXY_TARGET: apiBaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // 消费 stdout，避免管道缓冲写满后阻塞 dev server。
  child.stdout?.resume();

  const deadline = Date.now() + 30_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(
        `Vite 提前退出 (${child.exitCode}): ${stderr.slice(0, 300)}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) break;
    } catch {
      // 尚未监听，继续轮询。
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`等待 Vite 启动超时: ${stderr.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    baseUrl,
    close: async () => {
      const exited = new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
      });
      child.kill("SIGTERM");
      await exited;
    },
  };
}

test("端到端链路：浏览器发送消息经真实 API 到达 fake Agent，增量流式回到页面", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const fakeAgent = await startFakeAgent();
  const api = await startApi(fakeAgent.baseUrl);
  const vite = await startVite(api.baseUrl);
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${vite.baseUrl}/`);
    // 首屏没有任何历史会话：会话栏提示未选择会话，先显式新建一个会话再发送。
    await expect(page.locator(".chat-session-bar__title")).toHaveText(
      "未选择会话",
    );
    await page.getByRole("button", { name: "新会话", exact: true }).click();
    await expect(page.locator(".chat-session-bar__title")).toHaveText("新会话");
    await page
      .getByPlaceholder("输入您想咨询的车险问题...")
      .fill("链路联调测试");
    await page.getByRole("button", { name: "发送" }).click();

    // 用户消息追加 + 增量合并展示（限定在对话区，避免与会话标题同名冲突）
    const messageArea = page.locator(".chat-panel__messages");
    await expect(messageArea.getByText("链路联调测试")).toBeVisible();
    await expect(messageArea.getByText("链路验证")).toBeVisible();

    // fake Agent 收到一次相同长度的消息（不保存正文）
    expect(fakeAgent.runs).toHaveLength(1);
    expect(fakeAgent.runs[0]!.messageLength).toBe("链路联调测试".length);

    // 完成后发送恢复，且首条消息已由真实 API 自动命名为会话标题
    await expect(page.locator(".chat-session-bar__title")).toHaveText(
      "链路联调测试",
    );
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("再次发送");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();

    await context.close();
  } finally {
    await vite.close();
    await api.close();
    await fakeAgent.close();
  }
});
