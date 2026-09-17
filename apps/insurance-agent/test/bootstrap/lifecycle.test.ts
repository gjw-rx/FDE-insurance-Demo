import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTempWorkspace,
  defaultTestConfig,
  type TempWorkspace,
} from "../support/workspace.js";

const mainPath = fileURLToPath(
  new URL("../../src/bootstrap/main.ts", import.meta.url),
);
const processes: ChildProcess[] = [];
const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.cleanup()),
  );
});

/** 等待子进程 stdout 首行的启动摘要。 */
async function waitForStarted(child: ChildProcess): Promise<{
  readonly address: string;
  readonly agentName: string;
  readonly ready: boolean;
}> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(
      () => reject(new Error("等待服务启动超时")),
      5_000,
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split("\n").find((value) => value.trim() !== "");
      if (line === undefined) return;
      clearTimeout(timeout);
      resolve(
        JSON.parse(line) as {
          address: string;
          agentName: string;
          ready: boolean;
        },
      );
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`服务提前退出 (${code}): ${stderr}`));
    });
  });
}

/** 等待子进程退出并返回退出码。 */
async function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("等待服务退出超时")),
      5_000,
    );
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
}

describe("insurance-agent 进程生命周期", () => {
  it("在独立 HOME 启动 liveness、报告 not-ready 并响应 SIGTERM", async () => {
    const config = defaultTestConfig();
    config.model.catalogRefreshTimeoutMs = 0;
    config.http.port = 0;
    const workspace = await createTempWorkspace(config);
    workspaces.push(workspace);
    const isolatedHome = workspace.filePath("home");
    await mkdir(isolatedHome, { recursive: true });

    const child = spawn(process.execPath, ["--import", "tsx", mainPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: isolatedHome,
        INSURANCE_AGENT_CONFIG_PATH: workspace.configPath,
        INSURANCE_AGENT_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    processes.push(child);

    const started = await waitForStarted(child);
    expect(started).toMatchObject({
      agentName: "insurance-agent",
      ready: false,
    });

    const live = await fetch(`${started.address}/health/live`);
    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({
      status: "ok",
      agentName: "insurance-agent",
    });

    const ready = await fetch(`${started.address}/health/ready`);
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toMatchObject({
      status: "not-ready",
      reasons: ["MODEL_UNAVAILABLE"],
    });

    child.kill("SIGTERM");
    await expect(waitForExit(child)).resolves.toBe(0);
  });
});
