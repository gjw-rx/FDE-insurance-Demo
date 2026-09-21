import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  chatMessage,
  chatRun,
  chatSession,
} from "../../drizzle/chat-schema.js";
import { ChatSessionStoreError } from "../../src/application/chat/chat-session-store-error.js";
import type { DatabaseConfig } from "../../src/config/database-config.js";
import { resolveIntegrationTarget } from "../support/database-test-target.js";
import { migrateTestEnv } from "../support/migrate-test-env.js";
import { runMigrate } from "../support/migrate-command-runner.js";
import {
  openTestChatStore,
  type TestChatStore,
} from "../support/mysql-chat-store.js";

/**
 * 受控取值读取边界的集成测试（需要真实数据库）。
 *
 * 库内没有 `ENUM` 也没有取值校验约束，因此「人工写入或旧版本遗留的契约外取值」是
 * 可能出现的真实状态。这里绕过仓储直接改库（模拟该状态），验证读取路径返回稳定的
 * 存储不可用错误，而不是把未知取值当作正常结果透传给对外契约。
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

/** 契约外的取值，模拟人工改库或旧版本遗留。 */
const UNKNOWN_VALUE = "bogus-status";

let chat: TestChatStore | undefined;

function store(): TestChatStore {
  if (chat === undefined) throw new Error("测试仓储未初始化");
  return chat;
}

/** 建立一条包含 run 与助手消息的会话，便于改库后验证读取边界。 */
async function seedSession(): Promise<void> {
  await store().store.createSession({
    sessionId: sessionId(1),
    title: "新会话",
    createdAt: at(0),
  });
  await store().store.appendUserMessage({
    sessionId: sessionId(1),
    runId: runId(1),
    messageId: messageId(1),
    text: "问题",
    createdAt: at(1),
  });
  await store().store.startAssistantMessage({
    runId: runId(1),
    messageId: messageId(2),
    createdAt: at(2),
  });
}

describe.skipIf(!resolution.ok)("受控取值读取边界（真实数据库）", () => {
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
    await seedSession();
  });

  it("run 状态为契约外取值时读取返回稳定的存储不可用错误", async () => {
    await store()
      .db.update(chatRun)
      .set({ status: UNKNOWN_VALUE })
      .where(eq(chatRun.runId, runId(1)));

    await expect(store().store.getRun(runId(1))).rejects.toBeInstanceOf(
      ChatSessionStoreError,
    );
    await expect(store().store.getRun(runId(1))).rejects.toMatchObject({
      code: "CHAT_SESSION_STORE_UNAVAILABLE",
    });
  });

  it("消息状态为契约外取值时读取会话详情返回稳定错误", async () => {
    await store()
      .db.update(chatMessage)
      .set({ status: UNKNOWN_VALUE })
      .where(eq(chatMessage.messageId, messageId(2)));

    await expect(store().store.getMessages(sessionId(1))).rejects.toMatchObject(
      { code: "CHAT_SESSION_STORE_UNAVAILABLE" },
    );
  });

  it("标题来源为契约外取值时读取会话返回稳定错误", async () => {
    await store()
      .db.update(chatSession)
      .set({ titleSource: UNKNOWN_VALUE })
      .where(eq(chatSession.sessionId, sessionId(1)));

    await expect(store().store.getSession(sessionId(1))).rejects.toMatchObject({
      code: "CHAT_SESSION_STORE_UNAVAILABLE",
    });
    await expect(
      store().store.listSessions({ limit: 10 }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_STORE_UNAVAILABLE" });
  });

  it("未知取值不被透传，错误消息也不回显库中内容", async () => {
    await store()
      .db.update(chatRun)
      .set({ status: UNKNOWN_VALUE })
      .where(eq(chatRun.runId, runId(1)));

    try {
      await store().store.getRun(runId(1));
      throw new Error("应当抛出错误");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatSessionStoreError);
      expect((error as Error).message).not.toContain(UNKNOWN_VALUE);
    }
  });

  it("契约内取值不受影响，恢复仍可收敛合法记录", async () => {
    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      { titleSource: "default" },
    );
    await expect(
      store().store.recoverInterruptedRuns({ updatedAt: at(10) }),
    ).resolves.toEqual({ runs: 1, messages: 1 });
  });
});
