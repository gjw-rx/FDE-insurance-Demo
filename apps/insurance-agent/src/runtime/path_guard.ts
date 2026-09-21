import { realpathSync } from "node:fs";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from "node:path";
import type {
    InlineExtension,
    ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { READ_ONLY_TOOLS } from "../config/agent_config.js";

/**
 * 只读工具的第二层门禁。
 *
 * SDK 内置的 read/grep/find/ls 允许绝对路径和 `~` 展开，本身不限制工作目录。
 * 该 inline extension 在执行前把路径 canonicalize（含符号链接解析）并确认目标位于
 * 受控工作目录内；被拒绝的调用不执行，因此不会返回任何文件内容。
 */

/** 解析真实路径；目标不存在时对最近存在的祖先目录求 realpath。 */
export function canonicalizePath(path: string): string {
    const absolute = resolve(path);
    const suffix: string[] = [];
    let current = absolute;

    for (;;) {
        try {
            let real = realpathSync(current);
            for (let index = suffix.length - 1; index >= 0; index -= 1) {
                const segment = suffix[index];
                if (segment !== undefined) real = join(real, segment);
            }
            return real;
        } catch {
            const parent = dirname(current);
            if (parent === current) return absolute;
            suffix.push(basename(current));
            current = parent;
        }
    }
}

/** target 是否位于 root 目录内（含自身）。用相对路径判断，避免前缀混淆。 */
export function isInsideDirectory(root: string, target: string): boolean {
    const relativePath = relative(root, target);
    return (
        relativePath === "" ||
        (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
}

/** 读取工具调用的 path 参数；缺失或非字符串时返回 undefined，交由工具默认行为。 */
function readPathInput(event: ToolCallEvent): string | undefined {
    const input: Record<string, unknown> = event.input;
    const value = input["path"];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface AgentPathGuardOptions {
    readonly workingDirectory: string;
}

/** 创建路径门禁 extension；同一实例可被多次 reload 复用。 */
export function createPathGuardExtension(
    options: AgentPathGuardOptions,
): InlineExtension {
    const workingDirectory = canonicalizePath(options.workingDirectory);

    return (pi) => {
        pi.on("tool_call", (event) => {
            const toolName = event.toolName;
            if (!(READ_ONLY_TOOLS as readonly string[]).includes(toolName)) {
                return {
                    block: true,
                    reason: `工具不在只读白名单中：${toolName}`,
                };
            }

            const requestedPath = readPathInput(event);
            if (requestedPath === undefined) return undefined;

            const target = canonicalizePath(
                resolve(workingDirectory, requestedPath),
            );
            if (!isInsideDirectory(workingDirectory, target)) {
                return {
                    block: true,
                    reason: `路径超出受控工作目录：${requestedPath}`,
                };
            }

            return undefined;
        });
    };
}
