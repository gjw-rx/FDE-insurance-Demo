import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * MySQL 会话仓储集成测试（需要真实数据库）。
 *
 * 验证创建、读取、重命名、游标分页、消息顺序与跨进程持久化；断言对象是真实 SQL 行为，
 * 不用内存替身代替。未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因，不计为通过。
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

/**
 * 固定 36 位标识与时间戳。
 *
 * 主键列为 `CHAR(36)`，使用定长 UUID 形态避免依赖补位与截断行为；时间戳用固定基准
 * 递增，保证排序断言与本地时钟无关。
 */
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

describe.skipIf(!resolution.ok)("MySQL 会话仓储（真实数据库）", () => {
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

  it("创建会话后可读取，未知会话返回 null", async () => {
    const created = await store().store.createSession({
      sessionId: sessionId(1),
      title: "新会话",
      createdAt: at(0),
    });
    expect(created).toEqual({
      sessionId: sessionId(1),
      title: "新会话",
      titleSource: "default",
      createdAt: at(0),
      updatedAt: at(0),
    });

    await expect(store().store.getSession(sessionId(1))).resolves.toEqual(
      created,
    );
    await expect(store().store.getSession(sessionId(99))).resolves.toBeNull();
    await expect(store().store.getRun(runId(99))).resolves.toBeNull();
  });

  it("重复创建同一会话标识属于程序缺陷，明确失败", async () => {
    await store().store.createSession({
      sessionId: sessionId(1),
      title: "新会话",
      createdAt: at(0),
    });
    await expect(
      store().store.createSession({
        sessionId: sessionId(1),
        title: "新会话",
        createdAt: at(1),
      }),
    ).rejects.toThrow("会话标识冲突");
  });

  it("重命名更新标题、来源与更新时间，未知会话返回未找到", async () => {
    await store().store.createSession({
      sessionId: sessionId(1),
      title: "新会话",
      createdAt: at(0),
    });

    const renamed = await store().store.renameSession({
      sessionId: sessionId(1),
      title: "续保案件 A",
      titleSource: "manual",
      updatedAt: at(5),
    });
    expect(renamed).toMatchObject({
      title: "续保案件 A",
      titleSource: "manual",
      updatedAt: at(5),
      createdAt: at(0),
    });

    // 重命名为相同值也必须成功（不能依赖 affectedRows 判断存在性）。
    await expect(
      store().store.renameSession({
        sessionId: sessionId(1),
        title: "续保案件 A",
        titleSource: "manual",
        updatedAt: at(5),
      }),
    ).resolves.toMatchObject({ title: "续保案件 A" });

    await expect(
      store().store.renameSession({
        sessionId: sessionId(99),
        title: "不存在",
        titleSource: "manual",
        updatedAt: at(6),
      }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
  });

  it("列表按最近更新时间倒序，游标分页不重复也不跳过", async () => {
    for (const n of [1, 2, 3]) {
      await store().store.createSession({
        sessionId: sessionId(n),
        title: `会话 ${n}`,
        createdAt: at(n),
      });
    }

    const firstPage = await store().store.listSessions({ limit: 2 });
    expect(firstPage.map((session) => session.sessionId)).toEqual([
      sessionId(3),
      sessionId(2),
    ]);

    const lastOfFirst = firstPage[firstPage.length - 1];
    expect(lastOfFirst).toBeDefined();
    const secondPage = await store().store.listSessions({
      limit: 2,
      after: {
        updatedAt: lastOfFirst?.updatedAt ?? "",
        sessionId: lastOfFirst?.sessionId ?? "",
      },
    });
    expect(secondPage.map((session) => session.sessionId)).toEqual([
      sessionId(1),
    ]);

    const seen = [...firstPage, ...secondPage].map(
      (session) => session.sessionId,
    );
    expect(new Set(seen).size).toBe(3);
  });

  it("同一时间戳按会话标识倒序保持稳定次序", async () => {
    for (const n of [11, 12]) {
      await store().store.createSession({
        sessionId: sessionId(n),
        title: `同刻会话 ${n}`,
        createdAt: at(0),
      });
    }
    const listed = await store().store.listSessions({ limit: 10 });
    expect(listed.map((session) => session.sessionId)).toEqual([
      sessionId(12),
      sessionId(11),
    ]);
  });

  it("会话详情按消息序号返回有序消息", async () => {
    await store().store.createSession({
      sessionId: sessionId(1),
      title: "新会话",
      createdAt: at(0),
    });
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "请问续保要多少钱",
      createdAt: at(1),
      autoTitle: "请问续保要多少钱",
    });
    await store().store.startAssistantMessage({
      runId: runId(1),
      messageId: messageId(2),
      createdAt: at(2),
    });
    await store().store.appendAssistantDelta({
      runId: runId(1),
      text: "需要",
      updatedAt: at(3),
    });
    await store().store.appendAssistantDelta({
      runId: runId(1),
      text: "行驶证",
      updatedAt: at(4),
    });
    await store().store.setRunFinished({
      runId: runId(1),
      status: "completed",
      updatedAt: at(5),
    });

    const messages = await store().store.getMessages(sessionId(1));
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages[1]?.text).toBe("需要行驶证");
    expect(messages[1]?.status).toBe("completed");
    expect(messages[0]?.status).toBe("accepted");
  });

  it("读取不存在会话的消息返回未找到", async () => {
    await expect(
      store().store.getMessages(sessionId(99)),
    ).rejects.toBeInstanceOf(ChatSessionStoreError);
    await expect(
      store().store.getMessages(sessionId(99)),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
  });

  it("新的仓储实例仍能读取已保存历史（跨进程持久化）", async () => {
    await store().store.createSession({
      sessionId: sessionId(1),
      title: "重启前会话",
      createdAt: at(0),
    });
    await store().store.appendUserMessage({
      sessionId: sessionId(1),
      runId: runId(1),
      messageId: messageId(1),
      text: "重启前的消息",
      createdAt: at(1),
    });
    await store().store.setRunFinished({
      runId: runId(1),
      status: "completed",
      updatedAt: at(2),
    });

    // 用新的连接池与仓储实例读取，模拟 API 重启后的读取路径。
    const restarted = openTestChatStore(requireTarget().config);
    try {
      await expect(
        restarted.store.getSession(sessionId(1)),
      ).resolves.toMatchObject({ title: "重启前会话" });
      const messages = await restarted.store.getMessages(sessionId(1));
      expect(messages.map((message) => message.text)).toEqual(["重启前的消息"]);
      await expect(restarted.store.getRun(runId(1))).resolves.toMatchObject({
        status: "completed",
      });
    } finally {
      await restarted.close();
    }
  });
});
