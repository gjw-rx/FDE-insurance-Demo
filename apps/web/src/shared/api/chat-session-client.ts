import type {
  ChatSessionDetailResponse,
  ChatSessionListResponse,
  ChatSessionResponse,
  ChatSessionSummary,
} from "@renewal/contracts";

/**
 * 会话资源传输客户端。
 *
 * 只做传输：请求同源 `/api/chat/sessions*`，把失败统一映射为
 * `ChatSessionClientError`，不透出服务端原始错误详情。会话业务语义（当前会话、
 * 消息合并）由 `features/chat` 负责，因此本模块不依赖任何 feature。
 */

export type ChatSessionClientErrorKind = "network" | "not-found" | "server";

export class ChatSessionClientError extends Error {
  readonly kind: ChatSessionClientErrorKind;
  /** HTTP 状态码；网络失败时缺省。 */
  readonly status?: number;

  constructor(
    kind: ChatSessionClientErrorKind,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "ChatSessionClientError";
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

export interface ChatSessionRequestOptions {
  readonly signal?: AbortSignal;
}

/** 把响应状态映射为客户端错误；404 单独区分，便于界面提示会话已不存在。 */
function toError(response: Response): ChatSessionClientError {
  if (response.status === 404) {
    return new ChatSessionClientError("not-found", "会话不存在", 404);
  }
  return new ChatSessionClientError(
    "server",
    "服务暂时不可用，请稍后重试",
    response.status,
  );
}

/** 发起会话请求并解析 JSON；取消由调用方通过 signal.aborted 区分。 */
async function request<T>(
  path: string,
  init: RequestInit,
  options: ChatSessionRequestOptions,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      // exactOptionalPropertyTypes 下不能传 undefined；仅存在时才携带。
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch {
    throw new ChatSessionClientError("network", "无法连接服务，请稍后重试");
  }
  if (!response.ok) throw toError(response);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ChatSessionClientError("server", "服务响应异常，请稍后重试");
  }
}

/** 新建会话。 */
export async function createChatSession(
  options: ChatSessionRequestOptions = {},
): Promise<ChatSessionSummary> {
  const payload = await request<ChatSessionResponse>(
    "/api/chat/sessions",
    { method: "POST" },
    options,
  );
  return payload.session;
}

/** 分页列出会话；缺省返回服务端默认页大小。 */
export async function listChatSessions(
  params: { readonly limit?: number; readonly cursor?: string } = {},
  options: ChatSessionRequestOptions = {},
): Promise<ChatSessionListResponse> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor !== undefined) query.set("cursor", params.cursor);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return request<ChatSessionListResponse>(
    `/api/chat/sessions${suffix}`,
    { method: "GET" },
    options,
  );
}

/** 读取会话详情（摘要 + 有序消息）。 */
export async function getChatSession(
  sessionId: string,
  options: ChatSessionRequestOptions = {},
): Promise<ChatSessionDetailResponse> {
  return request<ChatSessionDetailResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET" },
    options,
  );
}

/** 重命名会话；标题为空或超长时服务端返回 400，映射为 server 错误。 */
export async function renameChatSession(
  sessionId: string,
  title: string,
  options: ChatSessionRequestOptions = {},
): Promise<ChatSessionSummary> {
  const payload = await request<ChatSessionResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    },
    options,
  );
  return payload.session;
}
