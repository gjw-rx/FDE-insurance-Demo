import { existsSync, readFileSync } from "node:fs";
import {
  DefaultResourceLoader,
  SettingsManager,
  type InlineExtension,
  type ResourceDiagnostic,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { AgentNotReadyReason } from "@renewal/contracts/agent";
import type { AgentConfig } from "../config/agent_config.js";

/**
 * 受控资源加载。
 *
 * 只加载应用配置显式声明的 skill 目录、上下文文件和服务内置 inline extension，
 * 关闭 SDK 的 ambient 发现：不读取用户 HOME、项目 `.pi/settings.json`、全局
 * extensions 或第三方 package。
 */

export interface AgentContextFile {
  readonly path: string;
  readonly content: string;
}

export interface AgentResourceLoaderDeps {
  /** 服务内置的 inline extension（例如路径门禁），不受 noExtensions 影响。 */
  readonly extensionFactories?: readonly InlineExtension[];
}

/** SDK 未从主入口导出资源选项类型，因此从构造函数推导。 */
type ResourceLoaderOptions = ConstructorParameters<
  typeof DefaultResourceLoader
>[0];

/** 会话创建时交给 SDK 的资源选项（cwd/agentDir/settingsManager 由调用方提供）。 */
export type AgentResourceLoaderOptions = Omit<
  ResourceLoaderOptions,
  "cwd" | "agentDir" | "settingsManager"
>;

export interface AgentContextFileReadResult {
  readonly files: AgentContextFile[];
  readonly missingPaths: readonly string[];
}

/** 读取配置显式声明的上下文文件；缺失路径需要让 readiness 失败。 */
export function readConfiguredContextFiles(
  config: AgentConfig,
): AgentContextFileReadResult {
  const files: AgentContextFile[] = [];
  const missingPaths: string[] = [];

  for (const path of config.resources.contextPaths) {
    if (!existsSync(path)) {
      missingPaths.push(path);
      continue;
    }
    files.push({ path, content: readFileSync(path, "utf8") });
  }

  return { files, missingPaths };
}

/**
 * 构造受控资源选项。
 *
 * 启动 readiness 检查与每次 run 的 session 创建共用同一份选项，避免两处漂移。
 */
export function agentResourceLoaderOptions(
  config: AgentConfig,
  deps: AgentResourceLoaderDeps = {},
): AgentResourceLoaderOptions {
  const { files: contextFiles } = readConfiguredContextFiles(config);

  return {
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalSkillPaths: [...config.resources.skillPaths],
    extensionFactories: [...(deps.extensionFactories ?? [])],
    agentsFilesOverride: (base: {
      agentsFiles: Array<{ path: string; content: string }>;
    }) => ({
      agentsFiles: [...base.agentsFiles, ...contextFiles],
    }),
  };
}

export interface AgentResourceLoaderReady {
  readonly status: "ready";
  readonly resourceLoader: ResourceLoader;
  readonly warnings: readonly string[];
}

export interface AgentResourceLoaderNotReady {
  readonly status: "not-ready";
  readonly reasons: readonly AgentNotReadyReason[];
  readonly warnings: readonly string[];
}

export type AgentResourceLoaderResult =
  | AgentResourceLoaderReady
  | AgentResourceLoaderNotReady;

/** 汇总 skill/prompt/theme 三类资源诊断，供 readiness 判定使用。 */
function collectDiagnostics(loader: ResourceLoader): ResourceDiagnostic[] {
  return [
    ...loader.getSkills().diagnostics,
    ...loader.getPrompts().diagnostics,
    ...loader.getThemes().diagnostics,
  ];
}

/**
 * 创建并 reload 受控资源加载器。
 *
 * 配置声明的资源缺失、SDK 资源诊断出现 error、或 extension 加载失败时返回
 * not-ready，避免服务在能力不完整时接受 run。
 */
export async function loadAgentResources(
  config: AgentConfig,
  deps: AgentResourceLoaderDeps = {},
): Promise<AgentResourceLoaderResult> {
  const warnings: string[] = [];
  const reasons: AgentNotReadyReason[] = [];

  const { missingPaths } = readConfiguredContextFiles(config);
  for (const path of missingPaths) {
    warnings.push(`配置的上下文文件不存在：${path}`);
  }
  if (missingPaths.length > 0) reasons.push("RESOURCES_INVALID");

  const resourceLoader = new DefaultResourceLoader({
    cwd: config.workingDirectory,
    agentDir: config.runtime.dataDirectory,
    settingsManager: SettingsManager.inMemory(),
    ...agentResourceLoaderOptions(config, deps),
  });

  try {
    await resourceLoader.reload();
  } catch {
    warnings.push("资源加载失败");
    reasons.push("RESOURCES_INVALID");
  }

  const extensionErrors = resourceLoader.getExtensions().errors;
  for (const error of extensionErrors) {
    warnings.push(`extension 加载失败：${error.path}`);
  }
  if (extensionErrors.length > 0) reasons.push("RESOURCES_INVALID");

  const diagnostics = collectDiagnostics(resourceLoader);
  const diagnosticErrors = diagnostics.filter(
    (diagnostic) => diagnostic.type === "error",
  );
  if (diagnosticErrors.length > 0) {
    warnings.push(`资源诊断报告 ${diagnosticErrors.length} 个错误`);
    reasons.push("RESOURCES_INVALID");
  }
  const diagnosticWarnings = diagnostics.filter(
    (diagnostic) => diagnostic.type === "warning",
  );
  if (diagnosticWarnings.length > 0) {
    warnings.push(`资源诊断报告 ${diagnosticWarnings.length} 个警告`);
  }

  if (reasons.length > 0) {
    return { status: "not-ready", reasons: [...new Set(reasons)], warnings };
  }

  return { status: "ready", resourceLoader, warnings };
}
