import type {
  AgentErrorResponse,
  AgentRunAbortResponse,
  AgentRunCreateRequest,
  AgentRunEvent,
  AgentRunSnapshot,
} from "@renewal/contracts/agent";

export type AgentClientErrorKind =
  | "connection"
  | "timeout"
  | "service"
  | "protocol";

export class AgentClientError extends Error {
  readonly kind: AgentClientErrorKind;
  readonly statusCode?: number;
  readonly serviceError?: AgentErrorResponse["error"];

  constructor(
    kind: AgentClientErrorKind,
    message: string,
    detail: {
      readonly statusCode?: number;
      readonly serviceError?: AgentErrorResponse["error"];
    } = {},
  ) {
    super(message);
    this.name = "AgentClientError";
    this.kind = kind;
    if (detail.statusCode !== undefined) this.statusCode = detail.statusCode;
    if (detail.serviceError !== undefined)
      this.serviceError = detail.serviceError;
  }
}

export interface AgentServiceClientOptions {
  readonly baseUrl: string;
  readonly connectTimeoutMs: number;
  readonly responseTimeoutMs: number;
  readonly fetch?: typeof fetch;
}

export interface AgentEventStreamOptions {
  readonly after?: number;
  readonly signal?: AbortSignal;
}

export class AgentServiceClient {
  private readonly baseUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly fetch: typeof fetch;

  /** 规范化并校验 baseUrl，固定超时与 fetch 实现（测试可注入替身）。 */
  constructor(options: AgentServiceClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/$/, "");
    // 构造时校验地址：非法配置立即失败，不让后续请求抛裸 TypeError。
    try {
      new URL(baseUrl);
    } catch {
      throw new AgentClientError("connection", "Agent 服务地址非法");
    }
    this.baseUrl = baseUrl;
    this.connectTimeoutMs = options.connectTimeoutMs;
    this.responseTimeoutMs = options.responseTimeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async createRun(request: AgentRunCreateRequest): Promise<AgentRunSnapshot> {
    return this.requestJson<AgentRunSnapshot>("/internal/agent/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  async abortRun(runId: string): Promise<AgentRunAbortResponse> {
    return this.requestJson<AgentRunAbortResponse>(
      `/internal/agent/runs/${encodeURIComponent(runId)}/abort`,
      { method: "POST" },
    );
  }

  async *streamEvents(
    runId: string,
    options: AgentEventStreamOptions = {},
  ): AsyncGenerator<AgentRunEvent> {
    const path = resolveUrl(
      this.baseUrl,
      `/internal/agent/runs/${encodeURIComponent(runId)}/events`,
    );
    if (options.after !== undefined) {
      path.searchParams.set("after", String(options.after));
    }

    const controller = new AbortController();
    // 调用方取消时中断底层请求，由 catch 分支静默结束迭代。
    const abort = (): void => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.fetchWithTimeout(
        path,
        {
          ...(options.after === undefined
            ? {}
            : { headers: { "last-event-id": String(options.after) } }),
          signal: controller.signal,
        },
        controller,
      );
      if (!response.ok) {
        await this.throwServiceError(response, controller);
      }
      if (response.body === null) {
        throw new AgentClientError("protocol", "Agent SSE 响应没有消息体");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        for (;;) {
          const chunk = await this.withResponseTimeout(
            reader.read(),
            controller,
          );
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });

          let separator = buffer.indexOf("\n\n");
          while (separator >= 0) {
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const data = frame
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (data !== undefined) yield parseEvent(data);
            separator = buffer.indexOf("\n\n");
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (options.signal?.aborted) return;
      if (error instanceof AgentClientError) throw error;
      throw new AgentClientError("connection", "无法连接 Agent 服务");
    } finally {
      options.signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }

  /** 发起 JSON 请求；非 2xx 交给 throwServiceError 映射。 */
  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    try {
      const response = await this.fetchWithTimeout(
        resolveUrl(this.baseUrl, path),
        { ...init, signal: controller.signal },
        controller,
      );
      if (!response.ok) await this.throwServiceError(response, controller);
      return await this.readJson<T>(response, controller);
    } finally {
      controller.abort();
    }
  }

  /** 用连接超时包裹 fetch；超时与连接失败分别映射为 timeout/connection 错误。 */
  private async fetchWithTimeout(
    url: URL,
    init: RequestInit,
    controller: AbortController,
  ): Promise<Response> {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.connectTimeoutMs);

    try {
      return await this.fetch(url, init);
    } catch (error) {
      if (timedOut) {
        throw new AgentClientError("timeout", "连接 Agent 服务超时");
      }
      if (error instanceof AgentClientError) throw error;
      throw new AgentClientError("connection", "无法连接 Agent 服务");
    } finally {
      clearTimeout(timer);
    }
  }

  /** 读取 JSON 响应体；解析失败映射为 protocol 错误。 */
  private async readJson<T>(
    response: Response,
    controller: AbortController,
  ): Promise<T> {
    try {
      return (await this.withResponseTimeout(response.json(), controller)) as T;
    } catch (error) {
      if (error instanceof AgentClientError) throw error;
      throw new AgentClientError("protocol", "Agent 服务返回了非法 JSON");
    }
  }

  /** 读取并校验服务错误体，转换为带稳定错误码的 service 错误。 */
  private async throwServiceError(
    response: Response,
    controller: AbortController,
  ): Promise<never> {
    const body = await this.readJson<unknown>(response, controller);
    if (!isAgentErrorResponse(body)) {
      throw new AgentClientError("protocol", "Agent 服务返回了非法错误响应", {
        statusCode: response.status,
      });
    }
    throw new AgentClientError("service", body.error.message, {
      statusCode: response.status,
      serviceError: body.error,
    });
  }

  /** 给响应读取加超时；超时后中断请求并抛出 timeout 错误。 */
  private async withResponseTimeout<T>(
    operation: Promise<T>,
    controller: AbortController,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AgentClientError("timeout", "等待 Agent 服务响应超时"));
      }, this.responseTimeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/** 拼接请求地址；baseUrl 在构造时已校验，异常输入仍返回明确的 client 错误。 */
function resolveUrl(baseUrl: string, path: string): URL {
  try {
    return new URL(`${baseUrl}${path}`);
  } catch {
    throw new AgentClientError("connection", "Agent 服务地址非法");
  }
}

/** 校验错误响应结构，避免把非契约载荷当作服务错误解析。 */
function isAgentErrorResponse(value: unknown): value is AgentErrorResponse {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const detail = error as Record<string, unknown>;
  return (
    typeof detail["code"] === "string" &&
    typeof detail["message"] === "string" &&
    typeof detail["retryable"] === "boolean"
  );
}

/** 解析 SSE data 帧；非法 JSON 映射为 protocol 错误。 */
function parseEvent(data: string): AgentRunEvent {
  try {
    return JSON.parse(data) as AgentRunEvent;
  } catch {
    throw new AgentClientError("protocol", "Agent SSE 包含非法事件");
  }
}
