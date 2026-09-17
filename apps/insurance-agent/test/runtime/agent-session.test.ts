import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import {
  ModelRuntime,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadAgentConfig,
  type AgentConfig,
} from "../../src/config/agent-config.js";
import {
  createTempWorkspace,
  type TempWorkspace,
} from "../support/workspace.js";
import type { AgentResolvedModel } from "../../src/runtime/agent-model-runtime.js";
import {
  createAgentRunSession,
  type AgentRunSession,
} from "../../src/runtime/agent-session.js";

const workspaces: TempWorkspace[] = [];
const sessions: AgentRunSession[] = [];

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.dispose()));
  await Promise.all(
    workspaces.splice(0).map((workspace) => workspace.cleanup()),
  );
}, 20_000);

interface Harness {
  readonly workspace: TempWorkspace;
  readonly config: AgentConfig;
  readonly faux: ReturnType<typeof fauxProvider>;
  readonly modelRuntime: ModelRuntime;
  readonly model: AgentResolvedModel;
}

/** 构造 faux provider 与隔离 workspace 组成的会话夹具。 */
async function createHarness(
  options: { tokensPerSecond?: number } = {},
): Promise<Harness> {
  const workspace = await createTempWorkspace();
  workspaces.push(workspace);
  const config = loadAgentConfig({ configPath: workspace.configPath, env: {} });
  await mkdir(config.runtime.dataDirectory, { recursive: true });

  const faux = fauxProvider({
    provider: "opencode-go",
    models: [{ id: "deepseek-flash" }],
    ...(options.tokensPerSecond === undefined
      ? {}
      : { tokensPerSecond: options.tokensPerSecond }),
  });

  const modelRuntime = await ModelRuntime.create({
    authPath: join(config.runtime.dataDirectory, "auth.json"),
    modelsPath: join(config.runtime.dataDirectory, "models.json"),
    modelsStorePath: join(config.runtime.dataDirectory, "models-store.json"),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);

  const model = modelRuntime.getModel("opencode-go", "deepseek-flash");
  if (model === undefined) throw new Error("faux provider 未注册配置模型");

  return { workspace, config, faux, modelRuntime, model };
}

/** 打开一个受控 session 并收集其 SDK 事件。 */
async function openSession(
  harness: Harness,
): Promise<{ session: AgentRunSession; events: AgentSessionEvent[] }> {
  const session = await createAgentRunSession({
    config: harness.config,
    modelRuntime: harness.modelRuntime,
    model: harness.model,
  });
  sessions.push(session);
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { session, events };
}

/** 拼接事件流中的回答文本增量。 */
function answerText(events: readonly AgentSessionEvent[]): string {
  let text = "";
  for (const event of events) {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      text += event.assistantMessageEvent.delta;
    }
  }
  return text;
}

/** 提取工具执行结果与错误标记。 */
function toolExecutions(
  events: readonly AgentSessionEvent[],
): Array<{ isError: boolean; result: unknown }> {
  return events
    .filter((event) => event.type === "tool_execution_end")
    .map((event) => ({ isError: event.isError, result: event.result }));
}

/** 轮询等待条件成立，超时即失败。 */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 足够长的流式回答，使 abort 有机会中断进行中的 run。 */
function longAnswer(): ReturnType<typeof fauxAssistantMessage> {
  return fauxAssistantMessage("这是一段很长的回答。".repeat(20));
}

describe("每个 run 独立的 SDK runtime", () => {
  it("用 faux provider 完成 agent loop，不依赖 Pi CLI 或开发会话", async () => {
    const harness = await createHarness();
    harness.faux.setResponses([fauxAssistantMessage("你好，我是续保助手。")]);
    const { session, events } = await openSession(harness);

    await session.prompt("你好");

    expect(answerText(events)).toContain("你好，我是续保助手。");
    expect(session.session.isIdle).toBe(true);
  });

  it("活动工具严格为四个内置只读工具", async () => {
    const harness = await createHarness();
    const { session } = await openSession(harness);

    expect([...session.session.getActiveToolNames()].sort()).toEqual([
      "find",
      "grep",
      "ls",
      "read",
    ]);
  });

  it("不同 run 的 Pi session 与消息互不串联", async () => {
    const harness = await createHarness();
    harness.faux.setResponses([
      fauxAssistantMessage("第一轮回答"),
      fauxAssistantMessage("第二轮回答"),
    ]);

    const first = await openSession(harness);
    await first.session.prompt("第一个问题");
    const second = await openSession(harness);
    await second.session.prompt("第二个问题");

    expect(first.session.piSessionId).not.toBe(second.session.piSessionId);
    expect(JSON.stringify(first.session.session.messages)).not.toContain(
      "第二轮回答",
    );
    expect(JSON.stringify(second.session.session.messages)).not.toContain(
      "第一轮回答",
    );
    expect(answerText(first.events)).toContain("第一轮回答");
    expect(answerText(second.events)).toContain("第二轮回答");
  });

  it("运行中的 run 可被 abort 并回到空闲", async () => {
    const harness = await createHarness({ tokensPerSecond: 20 });
    harness.faux.setResponses([longAnswer()]);
    const { session } = await openSession(harness);

    const prompting = session.prompt("请详细说明");
    await waitUntil(() => !session.session.isIdle);
    await session.abort();
    await prompting;

    expect(session.session.isIdle).toBe(true);
  }, 20_000);

  it("dispose 幂等且能安全结束仍在运行的 run", async () => {
    const harness = await createHarness({ tokensPerSecond: 20 });
    harness.faux.setResponses([longAnswer()]);
    const { session } = await openSession(harness);

    const prompting = session.prompt("请详细说明");
    await waitUntil(() => !session.session.isIdle);
    await session.dispose();
    await session.dispose();
    try {
      await prompting;
    } catch {
      // run 被中断时 prompt 可能以错误结束，这里只关心资源释放。
    }

    expect(session.session.isIdle).toBe(true);
  }, 20_000);
});

describe("只读工具在真实运行中的行为", () => {
  it("允许读取受控工作目录内的文件", async () => {
    const harness = await createHarness();
    await harness.workspace.write("work/case.md", "案件：张三续保");
    harness.faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: "case.md" })]),
      fauxAssistantMessage("已读取案件资料。"),
    ]);
    const { session, events } = await openSession(harness);

    await session.prompt("读取案件资料");

    const executions = toolExecutions(events);
    expect(executions.length).toBeGreaterThan(0);
    expect(executions[0]?.isError).toBe(false);
    expect(JSON.stringify(executions)).toContain("张三续保");
  });

  it("拒绝读取工作目录外的文件且不返回其内容", async () => {
    const harness = await createHarness();
    await harness.workspace.write("outside-secret.md", "绝密内容 CANARY-42");
    harness.faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall("read", { path: "../outside-secret.md" }),
      ]),
      fauxAssistantMessage("无法读取该文件。"),
    ]);
    const { session, events } = await openSession(harness);

    await session.prompt("读取外部文件");

    const executions = toolExecutions(events);
    expect(executions.length).toBeGreaterThan(0);
    expect(executions[0]?.isError).toBe(true);
    expect(JSON.stringify(executions)).not.toContain("CANARY-42");
  });
});
