import type { AgentRunEvent, AgentRunSnapshot } from "@renewal/contracts/agent";

/**
 * 对话流式传输客户端：POST 创建 run + fetch 解析 SSE 事件流。
 *
 * 只做传输，不含对话业务语义；所有请求走同源 `/api` 相对路径，
 * 由 Vite dev proxy 或生产网关转发到业务 API。错误统一抛出
 * ChatClientError，不透出服务端原始错误详情。
 */

export type ChatClientErrorKind = "network" | "server" | "stream";

export class ChatClientError extends Error {
  readonly kind: ChatClientErrorKind;

  constructor(kind: ChatClientErrorKind, message: string) {
    super(message);
    this.name = "ChatClientError";
    this.kind = kind;
  }
}

export interface ChatStreamOptions {
  readonly signal?: AbortSignal;
}

export interface ChatRequestOptions {
  readonly signal?: AbortSignal;
}

/** 创建一个对话 run。失败抛 ChatClientError。 */
export async function createChatRun(
  request: {
    readonly sessionId: string;
    readonly runId: string;
    readonly message: string;
  },
  options: ChatRequestOptions = {},
): Promise<AgentRunSnapshot> {
  let response: Response;
  try {
    response = await fetch("/api/chat/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      // exactOptionalPropertyTypes 下不能传 undefined；仅存在时才携带。
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    // 取消也走这里；调用方通过 signal.aborted 区分取消与失败。
    throw new ChatClientError("network", "无法连接服务，请稍后重试");
  }
  if (!response.ok) {
    throw new ChatClientError("server", "服务暂时不可用，请稍后重试");
  }
  try {
    return (await response.json()) as AgentRunSnapshot;
  } catch {
    throw new ChatClientError("server", "服务响应异常，请稍后重试");
  }
}

/** 订阅一个 run 的 SSE 事件流；按到达顺序回调。未收到终态即结束视为失败。 */
export async function streamChatEvents(
  runId: string,
  onEvent: (event: AgentRunEvent) => void,
  options: ChatStreamOptions = {},
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `/api/chat/runs/${encodeURIComponent(runId)}/events`,
      {
        // exactOptionalPropertyTypes 下不能传 undefined；仅存在时才携带。
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
  } catch {
    if (options.signal?.aborted) return;
    throw new ChatClientError("network", "无法连接服务，请稍后重试");
  }
  if (!response.ok) {
    throw new ChatClientError("server", "服务暂时不可用，请稍后重试");
  }
  if (response.body === null) {
    throw new ChatClientError("stream", "服务响应异常，请稍后重试");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminal = false;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const dataLine = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (dataLine !== undefined) {
          let event: AgentRunEvent;
          try {
            event = JSON.parse(dataLine.slice(6)) as AgentRunEvent;
          } catch {
            throw new ChatClientError("stream", "服务响应异常，请稍后重试");
          }
          if (isTerminalEvent(event)) sawTerminal = true;
          onEvent(event);
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (options.signal?.aborted) return;
    if (error instanceof ChatClientError) throw error;
    throw new ChatClientError("stream", "连接中断，请稍后重试");
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  if (!sawTerminal) {
    throw new ChatClientError("stream", "连接中断，请稍后重试");
  }
}

/** 终态事件类型，从契约类型派生。 */
function isTerminalEvent(event: AgentRunEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.aborted"
  );
}
