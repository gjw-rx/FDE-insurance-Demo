import { describe, expect, it } from "vitest";
import type {
  AgentRunCreateRequest,
  AgentRunEvent,
  AgentRunSnapshot,
} from "@renewal/contracts";
import type { ChatLogger } from "../../../src/application/chat/chat-logger.js";
import type { ChatRunAgentClient } from "../../../src/application/chat/chat-run-coordinator.js";
import { createApiApp } from "../../../src/bootstrap/application.js";
import { createFakeDatabase } from "../../support/fake-database.js";
import { InMemoryChatSessionStore } from "../../../src/infrastructure/persistence/in-memory-chat-session-store.js";

/**
 * 会话 HTTP 接口集成测试。
 *
 * 使用 Fastify `inject` 走真实路由与真实进程内仓储；只替换 Agent client，
 * 因此不需要真实模型凭据。覆盖创建、分页、详情、重命名、错误码与日志脱敏。
 */

/** 不被调用的 Agent 替身：会话接口不应触发任何 Agent 调用。 */
class UnusedAgent implements ChatRunAgentClient {
  readonly createCalls: AgentRunCreateRequest[] = [];

  async createRun(request: AgentRunCreateRequest): Promise<AgentRunSnapshot> {
    this.createCalls.push(request);
    return {
      agentName: "insurance-agent",
      sessionId: request.sessionId,
      runId: request.runId,
      status: "accepted",
      createdAt: "2026-09-20T00:00:00.000Z",
    };
  }

  async *streamEvents(): AsyncGenerator<AgentRunEvent> {
    // 会话接口不订阅事件流。
  }
}

/** 记录日志字段，用于脱敏断言。 */
class CapturingLogger implements ChatLogger {
  readonly entries: Array<{
    readonly event: string;
    readonly fields: Record<string, string | number | boolean>;
  }> = [];

  info(
    event: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    this.entries.push({ event, fields: fields ?? {} });
  }

  warn(
    event: string,
    fields?: Record<string, string | number | boolean>,
  ): void {
    this.entries.push({ event, fields: fields ?? {} });
  }
}

/** 创建待测应用（Fastify inject，不监听端口）。 */
function createApp() {
  const agent = new UnusedAgent();
  const logger = new CapturingLogger();
  const sessionStore = new InMemoryChatSessionStore();
  const database = createFakeDatabase();
  const app = createApiApp({
    agentClient: agent,
    sessionStore,
    logger,
    database,
  });
  return { app, agent, logger, sessionStore, database };
}

/** 通过 HTTP 创建会话并返回摘要。 */
async function createSession(
  app: ReturnType<typeof createApp>["app"],
): Promise<{ readonly sessionId: string; readonly title: string }> {
  const response = await app.server.inject({
    method: "POST",
    url: "/api/chat/sessions",
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ session: { sessionId: string; title: string } }>()
    .session;
}

describe("POST /api/chat/sessions", () => {
  it("创建默认标题的空会话", async () => {
    const { app } = createApp();
    const response = await app.server.inject({
      method: "POST",
      url: "/api/chat/sessions",
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json<{
      session: {
        sessionId: string;
        title: string;
        titleSource: string;
        createdAt: string;
      };
    }>();
    expect(payload.session.title).toBe("新会话");
    expect(payload.session.titleSource).toBe("default");
    expect(payload.session.sessionId.length).toBeGreaterThan(0);
    expect(payload.session.createdAt).toBe(
      response.json<{ session: { updatedAt: string } }>().session.updatedAt,
    );
  });

  it("新会话没有历史消息", async () => {
    const { app } = createApp();
    const session = await createSession(app);

    const detail = await app.server.inject({
      method: "GET",
      url: `/api/chat/sessions/${session.sessionId}`,
    });

    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ messages: unknown[] }>().messages).toEqual([]);
  });
});

describe("GET /api/chat/sessions", () => {
  it("没有会话时返回空列表且没有游标", async () => {
    const { app } = createApp();
    const response = await app.server.inject({
      method: "GET",
      url: "/api/chat/sessions",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sessions: [] });
  });

  it("按最近更新时间倒序返回摘要", async () => {
    const { app } = createApp();
    const first = await createSession(app);
    const second = await createSession(app);

    // 让第一个会话更新一次，从而排到最前。
    await app.server.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${first.sessionId}`,
      payload: { title: "最近更新" },
    });

    const response = await app.server.inject({
      method: "GET",
      url: "/api/chat/sessions",
    });
    const sessions = response.json<{
      sessions: Array<{ sessionId: string; title: string }>;
    }>().sessions;

    expect(sessions.map((session) => session.sessionId)).toEqual([
      first.sessionId,
      second.sessionId,
    ]);
    expect(sessions[0]?.title).toBe("最近更新");
  });

  it("limit 与 cursor 支持翻页且不重复", async () => {
    const { app } = createApp();
    const created: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      created.push((await createSession(app)).sessionId);
    }

    // 真实时钟只到毫秒，先等待再更新以保证该会话严格最新。
    await new Promise((resolve) => setTimeout(resolve, 5));
    const mostRecent = created[1];
    expect(mostRecent).toBeDefined();
    await app.server.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${mostRecent}`,
      payload: { title: "最后更新" },
    });

    const page1 = await app.server.inject({
      method: "GET",
      url: "/api/chat/sessions?limit=2",
    });
    const first = page1.json<{
      sessions: Array<{ sessionId: string }>;
      nextCursor?: string;
    }>();
    expect(first.sessions).toHaveLength(2);
    expect(first.sessions[0]?.sessionId).toBe(mostRecent);
    expect(first.nextCursor).toBeDefined();

    const page2 = await app.server.inject({
      method: "GET",
      url: `/api/chat/sessions?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? "")}`,
    });
    const second = page2.json<{
      sessions: Array<{ sessionId: string }>;
      nextCursor?: string;
    }>();
    expect(second.sessions).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();

    // 两页合并覆盖全部会话，且没有重复条目。
    const seen = [
      ...first.sessions.map((session) => session.sessionId),
      ...second.sessions.map((session) => session.sessionId),
    ];
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it("非法 limit 与非法 cursor 返回 400", async () => {
    const { app } = createApp();

    for (const url of [
      "/api/chat/sessions?limit=0",
      "/api/chat/sessions?limit=abc",
      "/api/chat/sessions?limit=1000",
      "/api/chat/sessions?cursor=not-a-cursor",
    ]) {
      const response = await app.server.inject({ method: "GET", url });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "INVALID_REQUEST",
      );
    }
  });
});

describe("GET /api/chat/sessions/:sessionId", () => {
  it("不存在的会话返回 404 CHAT_SESSION_NOT_FOUND", async () => {
    const { app } = createApp();
    const response = await app.server.inject({
      method: "GET",
      url: "/api/chat/sessions/missing",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "CHAT_SESSION_NOT_FOUND",
    );
  });
});

describe("PATCH /api/chat/sessions/:sessionId", () => {
  it("重命名成功后详情与列表一致更新", async () => {
    const { app } = createApp();
    const session = await createSession(app);

    const rename = await app.server.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${session.sessionId}`,
      payload: { title: "  续保案件 A  " },
    });

    expect(rename.statusCode).toBe(200);
    const renamed = rename.json<{
      session: { title: string; titleSource: string };
    }>().session;
    expect(renamed.title).toBe("续保案件 A");
    expect(renamed.titleSource).toBe("manual");

    const detail = await app.server.inject({
      method: "GET",
      url: `/api/chat/sessions/${session.sessionId}`,
    });
    expect(detail.json<{ session: { title: string } }>().session.title).toBe(
      "续保案件 A",
    );
  });

  it("空标题返回 400 且保留原标题", async () => {
    const { app } = createApp();
    const session = await createSession(app);
    await app.server.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${session.sessionId}`,
      payload: { title: "原标题" },
    });

    for (const payload of [
      { title: "" },
      { title: "   " },
      { title: 123 },
      {},
    ]) {
      const response = await app.server.inject({
        method: "PATCH",
        url: `/api/chat/sessions/${session.sessionId}`,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe(
        "INVALID_REQUEST",
      );
    }

    const detail = await app.server.inject({
      method: "GET",
      url: `/api/chat/sessions/${session.sessionId}`,
    });
    expect(detail.json<{ session: { title: string } }>().session.title).toBe(
      "原标题",
    );
  });

  it("不存在或非法会话返回 404", async () => {
    const { app } = createApp();
    const response = await app.server.inject({
      method: "PATCH",
      url: "/api/chat/sessions/missing",
      payload: { title: "新标题" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      "CHAT_SESSION_NOT_FOUND",
    );
  });
});

describe("会话接口日志脱敏", () => {
  it("日志只含稳定事件、ID 与错误码，不含标题正文", async () => {
    const { app, logger } = createApp();
    const secret = "身份证号110101199001011234";
    const session = await createSession(app);

    await app.server.inject({
      method: "PATCH",
      url: `/api/chat/sessions/${session.sessionId}`,
      payload: { title: secret },
    });
    await app.server.inject({
      method: "GET",
      url: "/api/chat/sessions/missing",
    });

    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("身份证号");
    expect(logger.entries.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        "chat.session.created",
        "chat.session.renamed",
        "chat.session.detail-failed",
      ]),
    );
    // 失败日志只记录稳定错误码。
    const failed = logger.entries.find(
      (entry) => entry.event === "chat.session.detail-failed",
    );
    expect(failed?.fields["code"]).toBe("CHAT_SESSION_NOT_FOUND");
  });
});
