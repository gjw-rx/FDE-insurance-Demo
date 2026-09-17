import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * 创建隔离的临时 workspace。
 *
 * 每个测试用例得到独立的仓库根（含 pnpm-workspace.yaml 标记）、配置文件、
 * runtime data 和受控工作目录，避免依赖开发机的 HOME 或真实忽略配置。
 */
export interface TestConfig {
  agent: { name: string; workingDirectory: string };
  model: {
    provider: string;
    id: string;
    thinkingLevel: string;
    apiKeyEnv: string;
    catalogRefreshTimeoutMs: number;
  };
  runtime: {
    dataDirectory: string;
    maxConcurrentRuns: number;
    runTimeoutMs: number;
    eventRetentionMs: number;
    maxEventsPerRun: number;
  };
  tools: { allow: string[] };
  resources: { skillPaths: string[]; contextPaths: string[] };
  http: { host: string; port: number };
}

/** 返回可覆盖的默认测试配置。 */
export function defaultTestConfig(): TestConfig {
  return {
    agent: { name: "insurance-agent", workingDirectory: "work" },
    model: {
      provider: "opencode-go",
      id: "deepseek-flash",
      thinkingLevel: "high",
      apiKeyEnv: "INSURANCE_AGENT_API_KEY",
      catalogRefreshTimeoutMs: 15_000,
    },
    runtime: {
      dataDirectory: ".runtime/insurance-agent",
      maxConcurrentRuns: 4,
      runTimeoutMs: 300_000,
      eventRetentionMs: 900_000,
      maxEventsPerRun: 1_000,
    },
    tools: { allow: ["read", "grep", "find", "ls"] },
    resources: { skillPaths: [], contextPaths: [] },
    http: { host: "127.0.0.1", port: 0 },
  };
}

export interface TempWorkspace {
  /** 临时仓库根。 */
  readonly root: string;
  readonly configPath: string;
  /** 受控工作目录（默认配置中的 `work`）。 */
  readonly workDirectory: string;
  filePath(relativePath: string): string;
  write(relativePath: string, content: string): Promise<string>;
  writeConfig(config: unknown): Promise<void>;
  cleanup(): Promise<void>;
}

/** 创建隔离的临时仓库根、配置文件与受控工作目录。 */
export async function createTempWorkspace(
  config: unknown = defaultTestConfig(),
): Promise<TempWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "insurance-agent-test-"));
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n",
    "utf8",
  );

  const configPath = join(root, "config", "insurance-agent.json");
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

  const workDirectory = join(root, "work");
  await mkdir(workDirectory, { recursive: true });

  return {
    root,
    configPath,
    workDirectory,
    /** 解析相对仓库根的绝对路径。 */
    filePath(relativePath) {
      return join(root, relativePath);
    },
    async write(relativePath, content) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return target;
    },
    async writeConfig(value) {
      await writeFile(configPath, JSON.stringify(value, null, 2), "utf8");
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
