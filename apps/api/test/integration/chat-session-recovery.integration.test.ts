import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AgentRunEvent, AgentRunSnapshot } from "@renewal/contracts";
import { chatRun } from "../../drizzle/chat-schema.js";
import { createApiApp } from "../../src/bootstrap/application.js";
import type { ChatRunAgentClient } from "../../src/application/chat/chat-run-coordinator.js";
import { silentChatLogger } from "../../src/application/chat/chat-logger.js";
import { loadApiConfig } from "../../src/config/api-config.js";
import type { DatabaseConfig } from "../../src/config/database-config.js";
import { resolveIntegrationTarget } from "../support/database-test-target.js";
import { migrateTestEnv } from "../support/migrate-test-env.js";
import { runMigrate } from "../support/migrate-command-runner.js";
import {
  openTestChatStore,
  type TestChatStore,
} from "../support/mysql-chat-store.js";

/**
 * 重启恢复集成测试（需要真实数据库）。
 *
 * 模拟「上一个进程崩溃时留下的 accepted/streaming 记录」，验证启动恢复把它们收敛为
 * 稳定失败语义、重复执行幂等、不重新启动 Agent，并且不改写会话更新时间（否则重启会
 * 打乱历史列表顺序）。未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因。
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

/** 造出「上一个进程留下的活动记录」：accepted run + streaming 助手消息。 */
async function leaveInterruptedRun(): Promise<void> {
  await store().store.createSession({
    sessionId: sessionId(1),
    title: "重启前会话",
    createdAt: at(0),
  });
  await store().store.appendUserMessage({
    sessionId: sessionId(1),
    runId: runId(1),
    messageId: messageId(1),
    text: "重启前的问题",
    createdAt: at(1),
  });
  await store().store.startAssistantMessage({
    runId: runId(1),
    messageId: messageId(2),
    createdAt: at(2),
  });
  await store().store.appendAssistantDelta({
    runId: runId(1),
    text: "未完成的回答",
    updatedAt: at(3),
  });
}

describe.skipIf(!resolution.ok)("重启恢复（真实数据库）", () => {
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

  it("遗留的非终态 run 与 streaming 消息被收敛，并返回本次收敛数量", async () => {
    await leaveInterruptedRun();

    const summary = await store().store.recoverInterruptedRuns({
      updatedAt: at(10),
    });
    expect(summary).toEqual({ runs: 1, messages: 1 });

    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "failed",
    });
    const messages = await store().store.getMessages(sessionId(1));
    expect(messages[1]?.status).toBe("failed");
    // 已写入的回答文本保留，便于用户看到已收到的内容。
    expect(messages[1]?.text).toBe("未完成的回答");
  });

  it("重复恢复是幂等的，不产生新变化", async () => {
    await leaveInterruptedRun();

    await expect(
      store().store.recoverInterruptedRuns({ updatedAt: at(10) }),
    ).resolves.toEqual({ runs: 1, messages: 1 });
    await expect(
      store().store.recoverInterruptedRuns({ updatedAt: at(11) }),
    ).resolves.toEqual({ runs: 0, messages: 0 });

    const messages = await store().store.getMessages(sessionId(1));
    expect(messages).toHaveLength(2);
    await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
      status: "failed",
    });
  });

  it("恢复不改写会话更新时间，历史列表顺序不被重启打乱", async () => {
    await leaveInterruptedRun();
    const before = await store().store.getSession(sessionId(1));

    await store().store.recoverInterruptedRuns({ updatedAt: at(30) });

    await expect(store().store.getSession(sessionId(1))).resolves.toMatchObject(
      {
        updatedAt: before?.updatedAt,
      },
    );
  });

  it("API 组合根启动恢复收敛遗留状态且不重新启动 Agent", async () => {
    await leaveInterruptedRun();

    const agentCalls = { createRun: 0, streamEvents: 0 };
    const agentClient: ChatRunAgentClient = {
      createRun: async (request): Promise<AgentRunSnapshot> => {
        agentCalls.createRun += 1;
        return {
          agentName: "insurance-agent",
          sessionId: request.sessionId,
          runId: request.runId,
          status: "accepted",
          createdAt: at(40),
        };
      },
      streamEvents: async function* (): AsyncGenerator<AgentRunEvent> {
        agentCalls.streamEvents += 1;
      },
    };

    const app = createApiApp({
      config: loadApiConfig({ env: { API_PORT: "0" } }),
      databaseConfig: requireTarget().config,
      agentClient,
      logger: silentChatLogger,
    });
    try {
      await app.recover();

      await expect(store().store.getRun(runId(1))).resolves.toMatchObject({
        status: "failed",
      });
      expect(agentCalls).toEqual({ createRun: 0, streamEvents: 0 });

      // 再次调用恢复是幂等的：没有新的非终态记录，也不报错。
      await expect(app.recover()).resolves.toBeUndefined();
      const rows = await store()
        .db.select({ status: chatRun.status })
        .from(chatRun)
        .where(eq(chatRun.runId, runId(1)));
      expect(rows[0]?.status).toBe("failed");
    } finally {
      await app.close();
      // 组合根关闭了自己的连接池；测试仓储仍指向同一库，重新建立连接继续断言。
      chat = openTestChatStore(requireTarget().config);
    }
  });
});
