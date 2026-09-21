import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../config/agent_config.js";
import { createPathGuardExtension } from "./path_guard.js";

/**
 * 服务内置的 inline extension。
 *
 * 这些是安全边界而不是可选插件，因此由服务统一装配：创建 run session 时自动生效，
 * 调用方不需要（也不应该）记得手动注入。
 */
export function builtinExtensionFactories(
 config: AgentConfig,
): readonly InlineExtension[] {
 return [
  createPathGuardExtension({ workingDirectory: config.workingDirectory }),
 ];
}
