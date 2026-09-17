import { symlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  InlineExtension,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTempWorkspace,
  type TempWorkspace,
} from "../support/workspace.js";
import {
  canonicalizePath,
  createPathGuardExtension,
  isInsideDirectory,
} from "../../src/runtime/path-guard.js";

const workspaces: TempWorkspace[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.cleanup()),
  );
});

/** 创建临时 workspace 并在用例结束后清理。 */
async function setup(): Promise<TempWorkspace> {
  const workspace = await createTempWorkspace();
  workspaces.push(workspace);
  return workspace;
}

type ToolCallHandler = (
  event: ToolCallEvent,
) => { block?: boolean; reason?: string } | undefined;

/** 从 inline extension 中取出 tool_call 处理器以便直接调用。 */
function captureToolCallHandler(extension: InlineExtension): ToolCallHandler {
  const handlers: ToolCallHandler[] = [];
  const factory =
    typeof extension === "function" ? extension : extension.factory;
  factory({
    on: (eventName: string, callback: ToolCallHandler) => {
      if (eventName === "tool_call") handlers.push(callback);
    },
  } as unknown as ExtensionAPI);

  const handler = handlers[0];
  if (handler === undefined)
    throw new Error("extension 未注册 tool_call handler");
  return handler;
}

/** 构造 tool_call 事件替身。 */
function toolCallEvent(
  toolName: string,
  input: Record<string, unknown>,
): ToolCallEvent {
  return {
    type: "tool_call",
    toolName,
    toolCallId: "call-1",
    input,
  } as unknown as ToolCallEvent;
}

describe("只读工具路径门禁", () => {
  it("允许工作目录内的相对路径与绝对路径", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );
    await workspace.write("work/case.md", "案件资料");

    expect(handler(toolCallEvent("read", { path: "case.md" }))).toBeUndefined();
    expect(
      handler(
        toolCallEvent("read", {
          path: join(workspace.workDirectory, "case.md"),
        }),
      ),
    ).toBeUndefined();
    expect(handler(toolCallEvent("ls", { path: "." }))).toBeUndefined();
  });

  it("拒绝 ../ 逃逸且不返回文件内容", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );
    await workspace.write("secret-outside.md", "绝密内容");

    const result = handler(
      toolCallEvent("read", { path: "../secret-outside.md" }),
    );

    expect(result?.block).toBe(true);
    expect(JSON.stringify(result)).not.toContain("绝密内容");
  });

  it("拒绝绝对路径逃逸", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );
    await workspace.write("secret-outside.md", "绝密内容");

    const result = handler(
      toolCallEvent("read", {
        path: join(workspace.root, "secret-outside.md"),
      }),
    );

    expect(result?.block).toBe(true);
    expect(JSON.stringify(result)).not.toContain("绝密内容");
  });

  it("拒绝符号链接逃逸", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );
    await workspace.write("outside/secret.txt", "绝密内容");
    symlinkSync(
      join(workspace.root, "outside"),
      join(workspace.workDirectory, "link-outside"),
      "dir",
    );

    const result = handler(
      toolCallEvent("read", { path: "link-outside/secret.txt" }),
    );

    expect(result?.block).toBe(true);
    expect(JSON.stringify(result)).not.toContain("绝密内容");
  });

  it("拒绝不在只读白名单中的工具", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );

    for (const toolName of ["bash", "edit", "write", "unknown_tool"]) {
      const result = handler(toolCallEvent(toolName, { command: "rm -rf /" }));
      expect(result?.block, `${toolName} 应被拒绝`).toBe(true);
    }
  });

  it("未提供 path 参数时放行（默认使用工作目录）", async () => {
    const workspace = await setup();
    const handler = captureToolCallHandler(
      createPathGuardExtension({ workingDirectory: workspace.workDirectory }),
    );

    expect(handler(toolCallEvent("grep", { pattern: "续保" }))).toBeUndefined();
    expect(handler(toolCallEvent("find", { pattern: "*.md" }))).toBeUndefined();
    expect(handler(toolCallEvent("ls", {}))).toBeUndefined();
  });
});

describe("路径工具函数", () => {
  it("canonicalizePath 解析符号链接并保留不存在的尾段", async () => {
    const workspace = await setup();
    symlinkSync(
      workspace.workDirectory,
      join(workspace.root, "work-link"),
      "dir",
    );

    expect(
      canonicalizePath(join(workspace.root, "work-link", "not-exists.md")),
    ).toBe(join(canonicalizePath(workspace.workDirectory), "not-exists.md"));
  });

  it("isInsideDirectory 不受同前缀目录影响", () => {
    expect(isInsideDirectory("/work", "/work/file.md")).toBe(true);
    expect(isInsideDirectory("/work", "/work")).toBe(true);
    expect(isInsideDirectory("/work", "/work-evil/file.md")).toBe(false);
    expect(isInsideDirectory("/work", "/etc/passwd")).toBe(false);
  });
});
