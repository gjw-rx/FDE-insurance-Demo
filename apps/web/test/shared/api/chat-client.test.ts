import { describe, expect, it, vi } from "vitest";
import type { AgentRunEvent } from "@renewal/contracts/agent";
import {
  ChatClientError,
  createChatRun,
  streamChatEvents,
} from "../../../src/shared/api/chat-client";

/**
 * 传输客户端测试：注入 fetch 替身验证 SSE 分帧、错误映射与取消。
 * 不访问任何真实网络。
 */

/** 构造 SSE 可读流响应。 */
function sseResponse(chunks: readonly string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    ...init,
  });
}

/** 构造基础事件。 */
function event(
  type: AgentRunEvent["type"],
  cursor: number,
  extra: Record<string, unknown> = {},
): AgentRunEvent {
  return {
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    cursor,
    at: "2026-09-15T00:00:00.000Z",
    type,
    ...extra,
  } as AgentRunEvent;
}

/** JSON 响应。 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const snapshot = {
  agentName: "insurance-agent",
  sessionId: "session-1",
  runId: "run-1",
  status: "accepted" as const,
  createdAt: "2026-09-15T00:00:00.000Z",
};

describe("createChatRun", () => {
  it("POST 创建 run 并返回快照", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, snapshot));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createChatRun({
        sessionId: "session-1",
        runId: "run-1",
        message: "你好",
      }),
    ).resolves.toEqual(snapshot);

    expect(fetchMock).toHaveBeenCalledWith("/api/chat/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-1",
        runId: "run-1",
        message: "你好",
      }),
    });
    vi.unstubAllGlobals();
  });

  it("非 2xx 映射为 server 错误且不透出服务端详情", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(503, {
        error: { code: "SERVICE_NOT_READY", message: "内部详情" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createChatRun({ sessionId: "s", runId: "r", message: "m" }),
    ).rejects.toMatchObject({ kind: "server" });
    vi.unstubAllGlobals();
  });

  it("网络失败映射为 network 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    await expect(
      createChatRun({ sessionId: "s", runId: "r", message: "m" }),
    ).rejects.toMatchObject({ kind: "network" });
    vi.unstubAllGlobals();
  });
});

describe("streamChatEvents", () => {
  it("分块跨边界的 SSE 帧被正确解析", async () => {
    // 一个 JSON 事件被拆到两个 chunk 中间，验证缓冲逻辑。
    const frame = `id: 1\ndata: ${JSON.stringify(event("answer.delta", 1, { text: "第一段" }))}\n\n`;
    const terminal = `id: 2\ndata: ${JSON.stringify(event("run.completed", 2))}\n\n`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([frame.slice(0, 20), frame.slice(20), terminal]),
        ),
    );

    const events: AgentRunEvent[] = [];
    await streamChatEvents("run-1", (e) => events.push(e));

    expect(events.map((e) => e.type)).toEqual([
      "answer.delta",
      "run.completed",
    ]);
    vi.unstubAllGlobals();
  });

  it("多帧 chunk 中每帧都会被解析", async () => {
    const frames = [
      `id: 1\ndata: ${JSON.stringify(event("run.accepted", 1))}\n\n`,
      `id: 2\ndata: ${JSON.stringify(event("agent.started", 2))}\n\n`,
      `id: 3\ndata: ${JSON.stringify(event("run.completed", 3))}\n\n`,
    ].join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse([frames])));

    const events: AgentRunEvent[] = [];
    await streamChatEvents("run-1", (e) => events.push(e));

    expect(events.map((e) => e.cursor)).toEqual([1, 2, 3]);
    vi.unstubAllGlobals();
  });

  it("非法 JSON 帧映射为 stream 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(sseResponse(["data: not-json\n\n"])),
    );
    await expect(
      streamChatEvents("run-1", () => undefined),
    ).rejects.toMatchObject({ kind: "stream" });
    vi.unstubAllGlobals();
  });

  it("非 2xx 响应映射为 server 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(404, { error: { code: "RUN_NOT_FOUND" } }),
        ),
    );
    await expect(
      streamChatEvents("run-1", () => undefined),
    ).rejects.toMatchObject({ kind: "server" });
    vi.unstubAllGlobals();
  });

  it("未见终态提前结束映射为 stream 错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            `id: 1\ndata: ${JSON.stringify(event("answer.delta", 1, { text: "部分" }))}\n\n`,
          ]),
        ),
    );
    await expect(
      streamChatEvents("run-1", () => undefined),
    ).rejects.toMatchObject({ kind: "stream" });
    vi.unstubAllGlobals();
  });

  it("取消后静默结束", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );
    await expect(
      streamChatEvents("run-1", () => undefined, { signal: controller.signal }),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
