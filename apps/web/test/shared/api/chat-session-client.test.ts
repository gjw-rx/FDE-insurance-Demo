import { describe, expect, it, vi } from "vitest";
import {
  ChatSessionClientError,
  createChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
} from "../../../src/shared/api/chat-session-client";

/**
 * 会话传输客户端测试：注入 fetch 替身验证请求形状、分页参数与错误映射。
 * 不访问任何真实网络。
 */

/** JSON 响应。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const summary = {
  sessionId: "session-1",
  title: "新会话",
  titleSource: "default" as const,
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-20T00:00:00.000Z",
};

describe("createChatSession", () => {
  it("POST 创建会话并返回摘要", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { session: summary }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createChatSession()).resolves.toEqual(summary);
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/sessions", {
      method: "POST",
    });
    vi.unstubAllGlobals();
  });

  it("网络失败映射为 network 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(createChatSession()).rejects.toMatchObject({
      kind: "network",
    });
    vi.unstubAllGlobals();
  });

  it("非法 JSON 响应映射为 server 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 201 })),
    );
    await expect(createChatSession()).rejects.toMatchObject({
      kind: "server",
    });
    vi.unstubAllGlobals();
  });
});

describe("listChatSessions", () => {
  it("不带参数时请求默认列表", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { sessions: [summary] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listChatSessions()).resolves.toEqual({ sessions: [summary] });
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/sessions", {
      method: "GET",
    });
    vi.unstubAllGlobals();
  });

  it("携带 limit 与 cursor 组成查询串", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { sessions: [], nextCursor: "next-token" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listChatSessions({ limit: 2, cursor: "abc def" }),
    ).resolves.toEqual({ sessions: [], nextCursor: "next-token" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/sessions?limit=2&cursor=abc+def",
      { method: "GET" },
    );
    vi.unstubAllGlobals();
  });

  it("400 映射为 server 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: { code: "INVALID_REQUEST", message: "limit 非法" },
        }),
      ),
    );
    await expect(listChatSessions({ limit: 0 })).rejects.toMatchObject({
      kind: "server",
      status: 400,
    });
    vi.unstubAllGlobals();
  });
});

describe("getChatSession", () => {
  it("读取会话详情并对 sessionId 做 URL 编码", async () => {
    const detail = { session: summary, messages: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, detail));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatSession("a/b c")).resolves.toEqual(detail);
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/sessions/a%2Fb%20c", {
      method: "GET",
    });
    vi.unstubAllGlobals();
  });

  it("404 映射为 not-found 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: "CHAT_SESSION_NOT_FOUND", message: "不存在" },
        }),
      ),
    );
    await expect(getChatSession("missing")).rejects.toBeInstanceOf(
      ChatSessionClientError,
    );
    await expect(getChatSession("missing")).rejects.toMatchObject({
      kind: "not-found",
      status: 404,
    });
    vi.unstubAllGlobals();
  });

  it("取消时抛出 network 错误，由调用方通过 signal.aborted 区分", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );
    await expect(
      getChatSession("session-1", { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "network" });
    vi.unstubAllGlobals();
  });
});

describe("renameChatSession", () => {
  it("PATCH 提交标题并返回更新后的摘要", async () => {
    const renamed = { ...summary, title: "续保案件 A", titleSource: "manual" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { session: renamed }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renameChatSession("session-1", "续保案件 A")).resolves.toEqual(
      renamed,
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/sessions/session-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "续保案件 A" }),
    });
    vi.unstubAllGlobals();
  });

  it("失败时抛出 server 错误且不回显服务端消息", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(503, {
          error: {
            code: "CHAT_SESSION_STORE_UNAVAILABLE",
            message: "内部详情",
          },
        }),
      ),
    );
    await expect(renameChatSession("session-1", "标题")).rejects.toMatchObject({
      kind: "server",
      status: 503,
    });
    vi.unstubAllGlobals();
  });
});
