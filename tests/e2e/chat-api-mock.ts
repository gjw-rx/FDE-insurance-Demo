import type { Page, Route } from "@playwright/test";

/**
 * 会话 + 对话链路的路由替身。
 *
 * 在浏览器侧模拟业务 API 的会话接口与 run/SSE 接口，让 E2E 不依赖真实 API、
 * insurance-agent 或模型凭据。替身内部维护会话状态，因此「首条消息自动命名」
 * 「刷新后恢复历史」「切换会话」等跨请求行为可以被真实验证。
 *
 * 断言与日志不保存消息正文以外的敏感数据；这里的文本都是合成数据。
 */

/** 替身会话里的消息。 */
export interface MockMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly status: string;
}

/** 替身会话。 */
export interface MockSession {
  readonly sessionId: string;
  title: string;
  titleSource: "default" | "first-message" | "manual";
  readonly createdAt: string;
  updatedAt: string;
  readonly messages: MockMessage[];
}

/** 创建替身会话的入参。 */
export interface MockSessionInput {
  readonly sessionId: string;
  readonly title?: string;
  readonly titleSource?: "default" | "first-message" | "manual";
  readonly updatedAt?: string;
  readonly messages?: readonly MockMessage[];
}

/** SSE 脚本：增量、终态，或保持挂起。 */
export interface MockRunScript {
  readonly deltas?: readonly string[];
  readonly terminal?: "run.completed" | "run.failed" | "run.aborted";
  /** true 时不发送终态且保持连接打开，模拟进行中的 run。 */
  readonly pending?: boolean;
  /** true 时发送增量后直接结束连接（无终态），模拟上游意外中断。 */
  readonly endWithoutTerminal?: boolean;
}

/** 记录一次 run 创建请求。 */
export interface MockRunPost {
  readonly sessionId: string;
  readonly runId: string;
  readonly message: string;
}

export interface ChatApiMock {
  readonly sessions: MockSession[];
  readonly runPosts: MockRunPost[];
  readonly renameCalls: Array<{
    readonly sessionId: string;
    readonly title: string;
  }>;
  /** 会话列表接口是否失败（用于「加载失败 + 重试」场景）。 */
  failSessionList(fail: boolean): void;
  /** 新建会话接口是否失败。 */
  failCreateSession(fail: boolean): void;
  /** 重命名接口是否失败。 */
  failRename(fail: boolean): void;
  /** 创建 run 接口是否失败（返回 503）。 */
  failRunCreate(fail: boolean): void;
  /** 设置下一次 run 的 SSE 脚本。 */
  setRunScript(script: MockRunScript): void;
  /** 会话列表返回的下一页游标；null 表示没有更多。 */
  setNextCursor(cursor: string | null): void;
}

const BASE_TIME = "2026-09-20T00:00:00.000Z";

/** 标题上限与 API 保持一致，用于模拟首条消息自动命名。 */
const TITLE_MAX = 60;

/** 由首条消息派生标题（与 API 规则一致：折叠空白 + 按码点截断）。 */
function deriveTitle(message: string): string {
  const collapsed = message.replace(/\s+/gu, " ").trim();
  return [...collapsed].slice(0, TITLE_MAX).join("");
}

/** 判定路径是否属于会话集合接口。 */
function isSessionsCollection(url: URL): boolean {
  return url.pathname === "/api/chat/sessions";
}

/** 从会话详情路径中取出 sessionId。 */
function sessionIdFrom(url: URL): string {
  const prefix = "/api/chat/sessions/";
  return decodeURIComponent(url.pathname.slice(prefix.length));
}

/** 按服务端规则排序：updatedAt 倒序，同一时间戳用 sessionId 倒序。 */
function sortSessions(list: readonly MockSession[]): MockSession[] {
  return [...list].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? 1 : -1;
    return 0;
  });
}

/** 构造 SSE 帧文本。 */
function buildFrames(
  sessionId: string,
  runId: string,
  script: MockRunScript,
): string {
  const frames: string[] = [];
  let cursor = 1;
  const push = (type: string, extra: Record<string, unknown> = {}): void => {
    frames.push(
      `id: ${cursor}\ndata: ${JSON.stringify({
        agentName: "insurance-agent",
        sessionId,
        runId,
        cursor,
        at: BASE_TIME,
        type,
        ...extra,
      })}\n\n`,
    );
    cursor += 1;
  };

  push("run.accepted");
  push("agent.started");
  for (const text of script.deltas ?? []) push("answer.delta", { text });
  if (script.pending === true || script.endWithoutTerminal === true) {
    return frames.join("");
  }
  const terminal = script.terminal ?? "run.completed";
  if (terminal === "run.completed") push("run.completed");
  else if (terminal === "run.failed")
    push("run.failed", { errorCode: "INTERNAL_ERROR" });
  else push("run.aborted", { reason: "requested" });
  return frames.join("");
}

/**
 * 安装会话与 run 接口替身。
 *
 * 必须在 `page.goto()` 之前调用。
 */
export async function installChatApiMock(
  page: Page,
  options: { readonly sessions?: readonly MockSessionInput[] } = {},
): Promise<ChatApiMock> {
  const sessions: MockSession[] = (options.sessions ?? []).map((input) => ({
    sessionId: input.sessionId,
    title: input.title ?? "新会话",
    titleSource: input.titleSource ?? "default",
    createdAt: BASE_TIME,
    updatedAt: input.updatedAt ?? BASE_TIME,
    messages: [...(input.messages ?? [])],
  }));

  const runPosts: MockRunPost[] = [];
  const renameCalls: Array<{ sessionId: string; title: string }> = [];
  let listFails = false;
  let createFails = false;
  let renameFails = false;
  let runCreateFails = false;
  let nextCursor: string | null = null;
  let runScript: MockRunScript = { terminal: "run.completed" };
  let sessionCounter = sessions.length;

  /** 找到会话；找不到返回 undefined。 */
  const findSession = (sessionId: string): MockSession | undefined =>
    sessions.find((session) => session.sessionId === sessionId);

  // 先注册兵底路由：Playwright 按注册逆序匹配，因此它必须最先注册才能作为最低优先级。
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "RUN_NOT_FOUND",
            message: "替身未实现该接口",
            retryable: false,
          },
        }),
      });
    },
  );

  const json = async (
    route: Route,
    status: number,
    body: unknown,
  ): Promise<void> => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  };

  const error = async (
    route: Route,
    status: number,
    code: string,
  ): Promise<void> => {
    await json(route, status, {
      error: { code, message: "替身错误", retryable: false },
    });
  };

  // 会话集合：GET 列表 / POST 新建。
  await page.route(
    (url) => isSessionsCollection(url),
    async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        if (createFails) {
          await error(route, 503, "CHAT_SESSION_STORE_UNAVAILABLE");
          return;
        }
        sessionCounter += 1;
        const created: MockSession = {
          sessionId: `session-${sessionCounter}`,
          title: "新会话",
          titleSource: "default",
          createdAt: BASE_TIME,
          updatedAt: BASE_TIME,
          messages: [],
        };
        sessions.unshift(created);
        await json(route, 201, {
          session: {
            sessionId: created.sessionId,
            title: created.title,
            titleSource: created.titleSource,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          },
        });
        return;
      }

      if (listFails) {
        await error(route, 503, "CHAT_SESSION_STORE_UNAVAILABLE");
        return;
      }
      const body: Record<string, unknown> = {
        sessions: sortSessions(sessions).map((session) => ({
          sessionId: session.sessionId,
          title: session.title,
          titleSource: session.titleSource,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })),
      };
      if (nextCursor !== null) body["nextCursor"] = nextCursor;
      await json(route, 200, body);
    },
  );

  // 会话详情：GET / PATCH。
  await page.route(
    (url) => url.pathname.startsWith("/api/chat/sessions/"),
    async (route) => {
      const sessionId = sessionIdFrom(new URL(route.request().url()));
      const session = findSession(sessionId);
      if (session === undefined) {
        await error(route, 404, "CHAT_SESSION_NOT_FOUND");
        return;
      }
      if (route.request().method() === "PATCH") {
        if (renameFails) {
          await error(route, 503, "CHAT_SESSION_STORE_UNAVAILABLE");
          return;
        }
        const body = route.request().postDataJSON() as { title?: unknown };
        const title = typeof body.title === "string" ? body.title.trim() : "";
        renameCalls.push({ sessionId, title });
        if (title.length === 0) {
          await error(route, 400, "INVALID_REQUEST");
          return;
        }
        session.title = title;
        session.titleSource = "manual";
        session.updatedAt = BASE_TIME;
        await json(route, 200, {
          session: {
            sessionId: session.sessionId,
            title: session.title,
            titleSource: session.titleSource,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          },
        });
        return;
      }

      await json(route, 200, {
        session: {
          sessionId: session.sessionId,
          title: session.title,
          titleSource: session.titleSource,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        messages: session.messages.map((message, index) => ({
          messageId: `${session.sessionId}-m${index}`,
          sessionId: session.sessionId,
          runId: `${session.sessionId}-run${index}`,
          role: message.role,
          status: message.status,
          text: message.text,
          createdAt: session.createdAt,
        })),
      });
    },
  );

  // 创建 run。
  await page.route(
    (url) => url.pathname === "/api/chat/runs",
    async (route) => {
      const body = route.request().postDataJSON() as MockRunPost;
      runPosts.push(body);
      if (runCreateFails) {
        await error(route, 503, "SERVICE_NOT_READY");
        return;
      }
      // 模拟服务端：先保存用户消息，并按首条消息自动命名。
      const session = findSession(body.sessionId);
      if (session !== undefined) {
        session.messages.push({
          role: "user",
          text: body.message,
          status: "accepted",
        });
        if (session.titleSource === "default") {
          const derived = deriveTitle(body.message);
          if (derived.length > 0) {
            session.title = derived;
            session.titleSource = "first-message";
          }
        }
        session.updatedAt = BASE_TIME;
      }
      await json(route, 202, {
        agentName: "insurance-agent",
        sessionId: body.sessionId,
        runId: body.runId,
        status: "accepted",
        createdAt: BASE_TIME,
      });
    },
  );

  // run 事件流。
  await page.route(
    (url) =>
      url.pathname.startsWith("/api/chat/runs/") &&
      url.pathname.endsWith("/events"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const runId = decodeURIComponent(
        path.slice("/api/chat/runs/".length, -"/events".length),
      );
      const post = runPosts.find((item) => item.runId === runId);
      const sessionId = post?.sessionId ?? "session-unknown";

      // 模拟服务端保存助手回答，使终态后的详情同步拿到完整回答。
      const session = findSession(sessionId);
      if (session !== undefined && (runScript.deltas?.length ?? 0) > 0) {
        const text = (runScript.deltas ?? []).join("");
        const terminal = runScript.terminal ?? "run.completed";
        session.messages.push({
          role: "assistant",
          text,
          status:
            runScript.pending === true
              ? "streaming"
              : terminal === "run.completed"
                ? "completed"
                : "failed",
        });
      }

      if (runScript.pending === true) {
        // 不 fulfill：请求保持未完成，模拟仍在执行的 run。
        await new Promise(() => undefined);
        return;
      }
      const frames = buildFrames(sessionId, runId, runScript);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: frames,
      });
    },
  );

  return {
    sessions,
    runPosts,
    renameCalls,
    failSessionList: (fail) => {
      listFails = fail;
    },
    failCreateSession: (fail) => {
      createFails = fail;
    },
    failRename: (fail) => {
      renameFails = fail;
    },
    failRunCreate: (fail) => {
      runCreateFails = fail;
    },
    setRunScript: (script) => {
      runScript = script;
    },
    setNextCursor: (cursor) => {
      nextCursor = cursor;
    },
  };
}

/** 单条 SSE 帧构造（供需要手工拼装的用例使用）。 */
export function sseEvent(
  type: string,
  cursor: number,
  extra: Record<string, unknown> = {},
): string {
  return `id: ${cursor}\ndata: ${JSON.stringify({
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    cursor,
    at: BASE_TIME,
    type,
    ...extra,
  })}\n\n`;
}

/**
 * 模拟后端不可达：所有 `/api/**` 请求连接失败。
 *
 * 用于「无后端服务的静态展示」场景，避免依赖开发机上是否有真实 API 监听默认端口。
 */
export async function offlineChatApi(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      await route.abort("connectionrefused");
    },
  );
}
