import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

function version(path) {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}
function canonical(cwd, path) {
  if (typeof path !== "string") return undefined;
  try {
    return realpathSync(resolve(cwd, path));
  } catch {
    return resolve(cwd, path);
  }
}

// 仅改变发送给模型的副本，保留原始工具结果和未知诊断。
export function createFeedbackFilter() {
  const known = new Map();
  const pending = new Map();
  const safeWrites = new Set();
  return {
    reset() {
      known.clear();
      pending.clear();
      safeWrites.clear();
    },
    before(event, cwd) {
      const path = canonical(cwd, event.input?.path);
      if (!path) return;
      const hash = version(path);
      pending.set(event.toolCallId, { path, hash });
      if (event.toolName === "edit" && hash && known.get(path) === hash) {
        safeWrites.add(event.toolCallId);
      }
    },
    after(event) {
      const prior = pending.get(event.toolCallId);
      pending.delete(event.toolCallId);
      if (!prior || event.isError) return;
      const text = event.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const completeRead =
        event.toolName === "read" &&
        !event.input?.offset &&
        !event.input?.limit &&
        !/more lines|truncated|output limit/i.test(text);
      const ownWrite =
        event.toolName === "write" ||
        (event.toolName === "edit" && safeWrites.has(event.toolCallId));
      const current = version(prior.path);
      if (current && ((completeRead && current === prior.hash) || ownWrite))
        known.set(prior.path, current);
    },
    filter(messages) {
      const seen = new Set();
      return messages.map((message) => {
        if (
          message.role !== "toolResult" ||
          message.isError ||
          !["write", "edit", "bash", "lens_diagnostics"].includes(
            message.toolName,
          )
        )
          return message;
        return {
          ...message,
          content: message.content.map((block) => {
            if (block.type !== "text") return block;
            // 任何 STOP/错误结果整体保留，不能把语法错误当作噪声。
            if (/🔴|STOP —|error TS\d|Error:|PARTIAL APPLY/.test(block.text))
              return block;
            let text = block.text;
            text = text.replace(
              /(?:\n\s*🟡 1 warning\(s\):\s*\n)?[^\n]*Pi-lens markdown analysis unavailable[^\n]*/g,
              (line) => {
                const key = "markdown-analysis-unavailable";
                if (seen.has(key)) return "";
                seen.add(key);
                return line;
              },
            );
            if (safeWrites.has(message.toolCallId)) {
              text = text.replace(
                /^⚠ BLIND WRITE — editing `[^`]+` without reading in the last \d+ tool calls\. Read the file first to avoid assumptions\.\s*$/gm,
                "",
              );
            }
            return {
              ...block,
              text: text.trim() || "工具执行完成；重复的非阻断提示已折叠。",
            };
          }),
        };
      });
    },
  };
}

export default function harness(pi) {
  const feedback = createFeedbackFilter();
  pi.on("session_start", () => feedback.reset());
  pi.on("tool_call", (event, ctx) => feedback.before(event, ctx.cwd));
  pi.on("tool_result", (event) => feedback.after(event));
  pi.on("context", (event) => ({ messages: feedback.filter(event.messages) }));
  pi.registerTool({
    name: "harness_effort",
    label: "任务推理等级",
    description:
      "为下一轮设置推理等级：机械读取 low，常规实现 medium，复杂竞态/证据冲突 high。遵守用户显式选择，难点完成后恢复 medium。",
    parameters: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["level"],
      additionalProperties: false,
    },
    async execute(_id, { level }) {
      if (!["low", "medium", "high"].includes(level))
        throw new Error("非法推理等级");
      pi.setThinkingLevel(level);
      const actual = pi.getThinkingLevel();
      return {
        content: [
          {
            type: "text",
            text: `下一轮推理等级：${actual}（请求 ${level}；受模型能力限制）`,
          },
        ],
        details: { requested: level, actual },
      };
    },
  });
}
