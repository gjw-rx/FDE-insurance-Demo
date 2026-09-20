import type {
  AgentRunEvent,
  ChatMessage,
  ChatMessageRole,
  ChatMessageStatus,
} from "@renewal/contracts";

/**
 * 对话消息视图与事件合并规则。
 *
 * 抽成纯函数模块，便于在不引入 DOM 测试环境的前提下用单元测试验证
 * 「增量合并为一条助手消息」「终态判定」「消息顺序」等行为。
 */

/** 界面使用的消息视图模型。 */
export interface ChatMessageView {
  /** React key：持久消息用 messageId，流式消息用 runId 派生值。 */
  readonly key: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  /** 已格式化到秒的本地时间文本。 */
  readonly timestamp: string;
  text: string;
}

/** 格式化 ISO 时间戳为本地「年-月-日 时:分:秒」。 */
export function formatTimestamp(iso: string): string {
  return formatTime(new Date(iso));
}

/** 格式化 Date 为本地「年-月-日 时:分:秒」。 */
export function formatTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 持久消息 → 视图模型。 */
export function toMessageView(message: ChatMessage): ChatMessageView {
  return {
    key: message.messageId,
    role: message.role,
    status: message.status,
    timestamp: formatTimestamp(message.createdAt),
    text: message.text,
  };
}

/** 持久消息集合 → 视图模型集合。 */
export function toMessageViews(
  messages: readonly ChatMessage[],
): ChatMessageView[] {
  return messages.map(toMessageView);
}

/** 终态事件：恢复发送能力，失败类终态同时展示通用错误。 */
export function isTerminalEvent(event: AgentRunEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.aborted"
  );
}

/** 用户消息 key：同一次发送的用户消息与助手消息通过 runId 关联。 */
export function userMessageKey(runId: string): string {
  return `user-${runId}`;
}

/** 助手消息 key。 */
export function assistantMessageKey(runId: string): string {
  return `assistant-${runId}`;
}

/** 追加乐观展示的用户消息（已提交但回答尚未返回）。 */
export function appendUserMessage(
  messages: readonly ChatMessageView[],
  runId: string,
  text: string,
  now: Date,
): ChatMessageView[] {
  return [
    ...messages,
    {
      key: userMessageKey(runId),
      role: "user",
      status: "accepted",
      timestamp: formatTime(now),
      text,
    },
  ];
}

/**
 * 把单个 run 事件合并到消息列表。
 *
 * 同一 run 的所有 `answer.delta` 追加到同一条助手消息，而不是每条增量新建消息；
 * 终态事件只更新状态，不向界面暴露技术信息。
 */
export function applyRunEvent(
  messages: readonly ChatMessageView[],
  runId: string,
  event: AgentRunEvent,
  now: Date,
): ChatMessageView[] {
  if (event.type === "answer.delta") {
    const key = assistantMessageKey(runId);
    const index = messages.findIndex((message) => message.key === key);
    if (index === -1) {
      return [
        ...messages,
        {
          key,
          role: "assistant",
          status: "streaming",
          timestamp: formatTime(now),
          text: event.text,
        },
      ];
    }
    return messages.map((message, current) =>
      current === index
        ? { ...message, text: message.text + event.text }
        : message,
    );
  }

  if (!isTerminalEvent(event)) return [...messages];

  const status: ChatMessageStatus =
    event.type === "run.completed" ? "completed" : "failed";
  return messages.map((message) =>
    message.role === "assistant" && message.key === assistantMessageKey(runId)
      ? { ...message, status }
      : message,
  );
}

/** 按消息 key 判断列表中是否存在某条消息。 */
export function hasMessage(
  messages: readonly ChatMessageView[],
  key: string,
): boolean {
  return messages.some((message) => message.key === key);
}
