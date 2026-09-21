import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 应用专属配置：定义 insurance-agent 的模型、runtime、工具和监听参数。
 *
 * 该配置与 Pi CLI 的 `.pi/settings.json`、`~/.pi/agent` 无关：相对路径一律以仓库根
 * 为基准解析，凭据只允许通过环境变量名间接引用。
 */

const WORKSPACE_MARKER = "pnpm-workspace.yaml";
const DEFAULT_CONFIG_RELATIVE_PATH = join("config", "insurance-agent.json");
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AgentThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Agent 可调用的内置工具白名单：只有只读工具。 */
export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
export type ReadOnlyToolName = (typeof READ_ONLY_TOOLS)[number];

export type AgentConfigErrorCode =
  | "config-not-found"
  | "config-invalid"
  | "config-unknown-field"
  | "config-plaintext-secret";

/** 配置错误只携带字段路径和规则说明，绝不携带字段值。 */
export class AgentConfigError extends Error {
  readonly code: AgentConfigErrorCode;
  readonly field: string;

  /** 只携带字段路径与规则说明；消息由调用方保证不含字段值。 */
  constructor(code: AgentConfigErrorCode, field: string, message: string) {
    super(message);
    this.name = "AgentConfigError";
    this.code = code;
    this.field = field;
  }
}

export interface AgentModelConfig {
  readonly provider: string;
  readonly id: string;
  readonly thinkingLevel: AgentThinkingLevel;
  /** 提供模型密钥的环境变量名；配置本身不保存密钥。 */
  readonly apiKeyEnv: string;
  readonly catalogRefreshTimeoutMs: number;
}

export interface AgentRuntimeSettings {
  readonly dataDirectory: string;
  readonly maxConcurrentRuns: number;
  readonly runTimeoutMs: number;
  readonly eventRetentionMs: number;
  readonly maxEventsPerRun: number;
}

export interface AgentHttpConfig {
  readonly host: string;
  readonly port: number;
}

export interface AgentConfig {
  readonly repositoryRoot: string;
  readonly configPath: string;
  readonly agentName: string;
  readonly workingDirectory: string;
  readonly model: AgentModelConfig;
  readonly runtime: AgentRuntimeSettings;
  readonly tools: readonly ReadOnlyToolName[];
  readonly resources: {
    readonly skillPaths: readonly string[];
    readonly contextPaths: readonly string[];
  };
  readonly http: AgentHttpConfig;
}

export interface LoadAgentConfigOptions {
  /** 显式配置文件路径；相对路径以仓库根为基准。 */
  readonly configPath?: string;
  readonly env?: NodeJS.ProcessEnv;
}

const TOP_LEVEL_FIELDS = new Set([
  "agent",
  "model",
  "runtime",
  "tools",
  "resources",
  "http",
]);
const AGENT_FIELDS = new Set(["name", "workingDirectory"]);
const MODEL_FIELDS = new Set([
  "provider",
  "id",
  "thinkingLevel",
  "apiKeyEnv",
  "catalogRefreshTimeoutMs",
]);
const RUNTIME_FIELDS = new Set([
  "dataDirectory",
  "maxConcurrentRuns",
  "runTimeoutMs",
  "eventRetentionMs",
  "maxEventsPerRun",
]);
const TOOLS_FIELDS = new Set(["allow"]);
const RESOURCES_FIELDS = new Set(["skillPaths", "contextPaths"]);
const HTTP_FIELDS = new Set(["host", "port"]);

/** 明文凭据字段名；`apiKeyEnv` 等只保存变量名的字段不受影响。 */
const SENSITIVE_KEY =
  /^(?:api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|credential|credentials|auth|authorization)$/i;

/** 定位包含 workspace 标记文件的仓库根；不依赖进程当前目录。 */
function repositoryRootFrom(startDirectory: string): string {
  let current = resolve(startDirectory);
  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new AgentConfigError(
        "config-not-found",
        "repositoryRoot",
        `无法定位仓库根：未在上级目录找到 ${WORKSPACE_MARKER}`,
      );
    }
    current = parent;
  }
}

/** 断言值是普通对象（拒绝 null 与数组），否则以字段路径报错。 */
function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AgentConfigError("config-invalid", field, `${field} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

/** 拼接嵌套字段路径，顶层字段不产生前导点。 */
function childField(field: string, key: string): string {
  return field ? `${field}.${key}` : key;
}

/** 白名单校验：出现未声明字段即拒绝，避免配置被静默忽略。 */
function assertKnownFields(
  record: Record<string, unknown>,
  field: string,
  allowed: Set<string>,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      const path = childField(field, key);
      throw new AgentConfigError(
        "config-unknown-field",
        path,
        `配置包含未支持字段：${path}`,
      );
    }
  }
}

/** 递归扫描敏感字段名；命中即拒绝，错误只带路径不带值。 */
function assertNoPlaintextSecrets(value: unknown, field: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoPlaintextSecrets(item, `${field}[${index}]`),
    );
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const path = childField(field, key);
    if (SENSITIVE_KEY.test(key)) {
      throw new AgentConfigError(
        "config-plaintext-secret",
        path,
        `配置中不允许出现明文凭据字段：${path}`,
      );
    }
    assertNoPlaintextSecrets(child, path);
  }
}

/** 读取非空字符串并校验长度上限；返回去除首尾空白后的值。 */
function requireString(
  record: Record<string, unknown>,
  key: string,
  field: string,
  maxLength = 256,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new AgentConfigError(
      "config-invalid",
      field,
      `${field} 必须是字符串`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new AgentConfigError("config-invalid", field, `${field} 不能为空`);
  }
  if (trimmed.length > maxLength) {
    throw new AgentConfigError(
      "config-invalid",
      field,
      `${field} 长度不能超过 ${maxLength}`,
    );
  }
  return trimmed;
}

/** 读取整数并校验闭区间范围。 */
function requireInteger(
  record: Record<string, unknown>,
  key: string,
  field: string,
  min: number,
  max: number,
): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AgentConfigError("config-invalid", field, `${field} 必须是整数`);
  }
  if (value < min || value > max) {
    throw new AgentConfigError(
      "config-invalid",
      field,
      `${field} 必须在 ${min} 到 ${max} 之间`,
    );
  }
  return value;
}

/** 读取非空字符串数组，并把每项解析为相对仓库根的绝对路径。 */
function requireStringArray(
  record: Record<string, unknown>,
  key: string,
  field: string,
  repositoryRoot: string,
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new AgentConfigError("config-invalid", field, `${field} 必须是数组`);
  }
  return value.map((item, index) => {
    const itemField = `${field}[${index}]`;
    if (typeof item !== "string") {
      throw new AgentConfigError(
        "config-invalid",
        itemField,
        `${itemField} 必须是字符串`,
      );
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new AgentConfigError(
        "config-invalid",
        itemField,
        `${itemField} 不能为空`,
      );
    }
    return resolve(repositoryRoot, trimmed);
  });
}

/** 解析只读工具白名单：拒绝非白名单工具、空列表与重复项。 */
function parseToolAllowList(
  record: Record<string, unknown>,
): readonly ReadOnlyToolName[] {
  const value = record["allow"];
  if (!Array.isArray(value) || value.length === 0) {
    throw new AgentConfigError(
      "config-invalid",
      "tools.allow",
      "tools.allow 必须是非空数组",
    );
  }
  const allowed: ReadOnlyToolName[] = [];
  value.forEach((item, index) => {
    const field = `tools.allow[${index}]`;
    if (typeof item !== "string") {
      throw new AgentConfigError(
        "config-invalid",
        field,
        `${field} 必须是字符串`,
      );
    }
    if (!(READ_ONLY_TOOLS as readonly string[]).includes(item)) {
      throw new AgentConfigError(
        "config-invalid",
        field,
        `${field} 只允许只读工具 ${READ_ONLY_TOOLS.join("、")}，收到不允许的工具名：${item}`,
      );
    }
    if (allowed.includes(item as ReadOnlyToolName)) {
      throw new AgentConfigError(
        "config-invalid",
        field,
        `${field} 重复声明了工具：${item}`,
      );
    }
    allowed.push(item as ReadOnlyToolName);
  });
  return allowed;
}

/** 解析 thinking level，必须是 THINKING_LEVELS 之一。 */
function parseThinkingLevel(
  record: Record<string, unknown>,
): AgentThinkingLevel {
  const field = "model.thinkingLevel";
  const value = requireString(record, "thinkingLevel", field, 16);
  if (!(THINKING_LEVELS as readonly string[]).includes(value)) {
    throw new AgentConfigError(
      "config-invalid",
      field,
      `${field} 必须是 ${THINKING_LEVELS.join("、")} 之一`,
    );
  }
  return value as AgentThinkingLevel;
}

/** 读取并严格校验应用配置；任何非法输入都以 AgentConfigError 拒绝。 */
export function loadAgentConfig(
  options: LoadAgentConfigOptions = {},
): AgentConfig {
  const env = options.env ?? process.env;
  const moduleRoot = repositoryRootFrom(MODULE_DIR);
  const requested = options.configPath ?? env.INSURANCE_AGENT_CONFIG_PATH;
  const configPath = resolve(
    moduleRoot,
    requested ?? DEFAULT_CONFIG_RELATIVE_PATH,
  );

  if (!existsSync(configPath)) {
    throw new AgentConfigError(
      "config-not-found",
      configPath,
      `未找到 Agent 配置文件：${configPath}`,
    );
  }

  const repositoryRoot = repositoryRootFrom(dirname(configPath));

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new AgentConfigError(
      "config-invalid",
      configPath,
      `配置文件不是合法 JSON：${configPath}`,
    );
  }

  assertNoPlaintextSecrets(parsed, "");
  const root = asRecord(parsed, "config");
  assertKnownFields(root, "", TOP_LEVEL_FIELDS);

  const agent = asRecord(root["agent"], "agent");
  assertKnownFields(agent, "agent", AGENT_FIELDS);
  const agentName = requireString(agent, "name", "agent.name", 64);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(agentName)) {
    throw new AgentConfigError(
      "config-invalid",
      "agent.name",
      "agent.name 必须是 kebab-case 标识符（小写字母、数字和连字符）",
    );
  }
  const workingDirectory = resolve(
    repositoryRoot,
    requireString(agent, "workingDirectory", "agent.workingDirectory", 512),
  );

  const model = asRecord(root["model"], "model");
  assertKnownFields(model, "model", MODEL_FIELDS);
  const modelConfig: AgentModelConfig = {
    provider: requireString(model, "provider", "model.provider", 64),
    id: requireString(model, "id", "model.id", 128),
    thinkingLevel: parseThinkingLevel(model),
    apiKeyEnv: requireString(model, "apiKeyEnv", "model.apiKeyEnv", 128),
    catalogRefreshTimeoutMs: requireInteger(
      model,
      "catalogRefreshTimeoutMs",
      "model.catalogRefreshTimeoutMs",
      0,
      600_000,
    ),
  };

  const runtime = asRecord(root["runtime"], "runtime");
  assertKnownFields(runtime, "runtime", RUNTIME_FIELDS);
  const runtimeSettings: AgentRuntimeSettings = {
    dataDirectory: resolve(
      repositoryRoot,
      requireString(runtime, "dataDirectory", "runtime.dataDirectory", 512),
    ),
    maxConcurrentRuns: requireInteger(
      runtime,
      "maxConcurrentRuns",
      "runtime.maxConcurrentRuns",
      1,
      64,
    ),
    runTimeoutMs: requireInteger(
      runtime,
      "runTimeoutMs",
      "runtime.runTimeoutMs",
      1_000,
      3_600_000,
    ),
    eventRetentionMs: requireInteger(
      runtime,
      "eventRetentionMs",
      "runtime.eventRetentionMs",
      1_000,
      86_400_000,
    ),
    maxEventsPerRun: requireInteger(
      runtime,
      "maxEventsPerRun",
      "runtime.maxEventsPerRun",
      16,
      100_000,
    ),
  };

  const tools = asRecord(root["tools"], "tools");
  assertKnownFields(tools, "tools", TOOLS_FIELDS);
  const allowedTools = parseToolAllowList(tools);

  const resources = asRecord(root["resources"], "resources");
  assertKnownFields(resources, "resources", RESOURCES_FIELDS);
  const skillPaths = requireStringArray(
    resources,
    "skillPaths",
    "resources.skillPaths",
    repositoryRoot,
  );
  const contextPaths = requireStringArray(
    resources,
    "contextPaths",
    "resources.contextPaths",
    repositoryRoot,
  );

  const http = asRecord(root["http"], "http");
  assertKnownFields(http, "http", HTTP_FIELDS);
  const httpConfig: AgentHttpConfig = {
    host: requireString(http, "host", "http.host", 255),
    port: requireInteger(http, "port", "http.port", 0, 65_535),
  };

  return {
    repositoryRoot,
    configPath,
    agentName,
    workingDirectory,
    model: modelConfig,
    runtime: runtimeSettings,
    tools: allowedTools,
    resources: { skillPaths, contextPaths },
    http: httpConfig,
  };
}
