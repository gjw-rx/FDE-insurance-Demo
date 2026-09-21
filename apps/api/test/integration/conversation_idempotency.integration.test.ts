import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AgentRunSnapshot } from "@renewal/contracts";
import { chatRun, chatSession } from "../../drizzle/conversation_schema.js";
import { ChatRequestError } from "../../src/modules/conversation/application/errors/request_error.js";
import type { DatabaseConfig } from "../../src/platform/config/database_config.js";
import { resolveIntegrationTarget } from "../support/database_test_target.js";
import { migrateTestEnv } from "../support/migrate_test_env.js";
import { runMigrate } from "../support/migrate_command_runner.js";
import {
  openTestChatStore,
  type TestChatStore,
} from "../support/mysql_conversation_store.js";

/**
 * 会话写入的幂等与事务边界集成测试（需要真实数据库）。
 *
 * 覆盖：重复 runId 不重复落库、跨会话复用 runId 被拒、首条消息与自动标题一致提交、
 * 助手消息不重复创建、终态只收敛一次、SQL 元字符按参数处理，以及中途写入失败时
 * 事务整体回滚（不留下孤立消息或半更新标题）。
 *
 * 未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因，不计为通过。
 */

const resolution = resolveIntegrationTarget();
if (!resolution.ok) {
  process.stderr.write(`[integration] 未执行原因：${resolution.reason}\n`);
}

function requireTarget(): { readonly config: DatabaseConfig } {
  if (!resolution.ok) {
    throw new Error(`集成测试目标不可用：${resolution.reason}`);
  }
  return resolution.target;
}

function sessionId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
function runId(n: number): string {
  return `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
function messageId(n: number): string {
  return `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
const BASE_TIME = Date.parse("2026-09-20T00:00:00.000Z");
function at(seconds: number): string {
  return new Date(BASE_TIME + seconds * 1_000).toISOString();
}

let chat: TestChatStore | undefined;

function store(): TestChatStore {
  if (chat === undefined) throw new Error("测试仓储未初始化");
  return chat;
}

/** 建立会话并写入首条用户消息。 */
async function startSession(n: number): Promise<void> {
  await store().store.createSession({
    sessionId: sessionId(n),
    title: "新会话",
    createdAt: at(0),
  });
}

describe.skipIf(!resolution.ok)("会话写入幂等与事务（真实数据库）", () => {
  beforeAll(async () => {
    const migrated = await runMigrate(migrateTestEnv());
    expect(migrated.code).toBe(0);
    chat = openTestChatStore(requireTarget().config);
  });

  afterAll(async () => {
    await chat?.close();
  });

  beforeEach(async () => {
    await store().reset();
  });

  it("相同 runId 重复提交只落库一次，且返回既有记录", async () => {
    await startSession(1);
    const first = await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "重复消息",
      createdAt: at(1),
      autoTitle: "重复消息",
    });
    const second = await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(2),
      text: "重复消息",
      createdAt: at(2),
      autoTitle: "重复消息",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.message.messageId).toBe(first.message.messageId);
    const messages = await store().store.getMessages(sessionId(1));
    expect(messages).toHaveLength(1);
    // 重复请求不再推进消息序号，下一次写入仍从 2 开始。
    const orderRows = await store()
      .db.select({ nextOrder: chatSession.nextMessageOrder })
      .from(chatSession)
      .where(eq(chatSession.sessionId, sessionId(1)));
    expect(orderRows[0]?.nextOrder).toBe(2);
  });

  it("跨会话复用 runId 被拒绝，且不留下新的消息或 run", async () => {
    await startSession(1);
    await startSession(2);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "会话 A 的消息",
      createdAt: at(1),
    });

    await expect(
      store().store.appendUserMessage({
        sessionId: sessionId(2),
        runId: runId(1),
        messageId: messageId(2),
        text: "会话 B 的消息",
        createdAt: at(2),
      }),
    ).rejects.toBeInstanceOf(ChatRequestError);

    await expect(store().store.getMessages(sessionId(2))).resolves.toEqual([]);
    await expect(store().store.getSession(sessionId(2))).resolves.toMatchObject(
      { updatedAt: at(0) },
    );
  });

  it("首条消息与自动标题在同一事务内提交，手动标题不被覆盖", async () => {
    await startSession(1);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "我的车险要续保",
      createdAt: at(1),
      autoTitle: "我的车险要续保",
    });
    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      {
        title: "我的车险要续保",
        titleSource: "first-message",
        updatedAt: at(1),
      },
    );

    // 已手动重命名的会话，后续消息不得覆盖标题。
    await store().store.renameSession({
      sessionId: sessionId(1),
      title: "用户标题",
      titleSource: "manual",
      updatedAt: at(2),
    });
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(2),
      messageId: messageId(2),
      text: "第二条消息",
      createdAt: at(3),
      autoTitle: "第二条消息",
    });
    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      { title: "用户标题", titleSource: "manual", updatedAt: at(3) },
    );
  });

  it("SQL 元字符作为参数处理，不改变库结构", async () => {
    await startSession(1);
    const hostile = "x'); drop table chat_message; --";
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: hostile,
      createdAt: at(1),
      autoTitle: hostile,
    });

    const session = await store().store.getSession(sessionId(1));
    expect(session?.title).toBe(hostile);
    const messages = await store().store.getMessages(sessionId(1));
    expect(messages[0]?.text).toBe(hostile);

    // 注入尝试没有变成可执行 SQL：同一库上继续正常写入与读取仍然成功，
    // 说明三张表结构与数据都未被影响。
    await store().store.createSession({
      sessionId: sessionId(2),
      title: "新会话",
      createdAt: at(2),
    });
    await store().store.appendUserMessage({
      sessionId: sessionId(2),
      runId: runId(2),
      messageId: messageId(2),
      text: "正常消息",
      createdAt: at(3),
    });
    await expect(
      store().store.getMessages(sessionId(2)),
    ).resolves.toMatchObject([{ text: "正常消息", role: "user" }]);
    // 原有会话与消息不受影响。
    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      { title: hostile },
    );
  });

  it("中途写入失败时事务整体回滚", async () => {
    await startSession(1);
    // autoTitle 超出列宽：标题更新在消息与 run 插入之后执行，触发失败即应整体回滚，
    // 不能留下「有消息但没有标题」或孤立 run 的中间状态。
    await expect(
      store().store.appendUserMessage({
        sessionId: sessionId(1),
        runId: runId(1),
        messageId: messageId(1),
        text: "超过标题列宽的写入",
        createdAt: at(1),
        autoTitle: "甲".repeat(80),
      }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_STORE_UNAVAILABLE" });

    await expect(store().store.getMessages(sessionId(1))).resolves.toEqual([]);
    await expect(store().store.getRun(runId(1))).resolves.toBeNull();
    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      { title: "新会话", titleSource: "default", updatedAt: at(0) },
    );
    const rows = await store()
      .db.select({ nextOrder: chatSession.nextMessageOrder })
      .from(chatSession)
      .where(eq(chatSession.sessionId, sessionId(1)));
    expect(rows[0]?.nextOrder).toBe(1);
  });

  it("助手消息只创建一次，增量累加且终态只收敛一次", async () => {
    await startSession(1);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "问题",
      createdAt: at(1),
    });

    const first = await store().store.startAssistantMessage({
      runId: runId(1),
      messageId: messageId(2),
      createdAt: at(2),
    });
    const duplicate = await store().store.startAssistantMessage({
      runId: runId(1),
      messageId: messageId(3),
      createdAt: at(3),
    });
    expect(duplicate.messageId).toBe(first.messageId);

    await store().store.appendAssistantDelta({
      runId: runId(1),
      text: "链路",
      updatedAt: at(4),
    });
    await store().store.appendAssistantDelta({
      runId: runId(1),
      text: "验证",
      updatedAt: at(5),
    });
    await store().store.setRunFinished({
      runId: runId(1),
      status: "completed",
      updatedAt: at(6),
    });
    // 迟到的失败终态不得覆盖已完成的 run 与消息状态。
    await store().store.setRunFinished({
      runId: runId(1),
      status: "failed",
      updatedAt: at(7),
    });

    const messages = await store().store.getMessages(sessionId(1));
    expect(messages).toHaveLength(2);
    expect(messages[1]?.text).toBe("链路验证");
    expect(messages[1]?.status).toBe("completed");
    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("较早的 Agent 接受结果不覆盖已收敛的终态", async () => {
    await startSession(1);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "问题",
      createdAt: at(1),
    });
    await store().store.setRunFinished({
      runId: runId(1),
      status: "aborted",
      updatedAt: at(2),
    });

    await store().store.setRunAccepted({
      runId: runId(1),
      snapshot: {
        agentName: "insurance-agent",
        sessionId: sessionId(1),
        runId: runId(1),
        status: "accepted",
        createdAt: at(3),
      },
      updatedAt: at(3),
    });

    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "aborted",
    });
  });

  it("Agent 接受后写入快照与真实 Agent 名称", async () => {
    await startSession(1);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "问题",
      createdAt: at(1),
    });
    const snapshot: AgentRunSnapshot = {
      agentName: "insurance-agent",
      sessionId: sessionId(1),
      runId: runId(1),
      status: "running",
      createdAt: at(2),
    };
    await store().store.setRunAccepted({
      runId: runId(1),
      snapshot,
      updatedAt: at(2),
    });

    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "running",
      snapshot,
    });
    const agentRows = await store()
      .db.select({ agentName: chatRun.agentName })
      .from(chatRun)
      .where(eq(chatRun.runId, runId(1)));
    expect(agentRows[0]?.agentName).toBe("insurance-agent");
  });

  it("Agent 拒绝创建时保留用户消息并标记发送失败", async () => {
    await startSession(1);
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "未能发送的消息",
      createdAt: at(1),
    });
    await store().store.setRunCreateFailed({
      runId: runId(1),
      updatedAt: at(2),
    });

    const messages = await store().store.getMessages(sessionId(1));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("未能发送的消息");
    expect(messages[0]?.status).toBe("send-failed");
    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "failed",
    });
  });
});
