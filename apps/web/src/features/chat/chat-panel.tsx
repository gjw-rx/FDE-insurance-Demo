import { useEffect, useRef, useState } from "react";
import type { AgentRunEvent } from "@renewal/contracts/agent";
import { BotIcon, PersonIcon } from "../../shared/ui/icons";
import { createChatRun, streamChatEvents } from "../../shared/api/chat-client";
import { ChatComposer } from "./chat-composer";
import { welcomeMessage } from "./data";

/**
 * 对话主区：助手标题、欢迎消息、动态对话消息与底部对话输入区。
 *
 * 提交与消息状态收敛在面板层：页面生命周期内共用一个临时 sessionId，
 * 每次发送生成新的 runId；同一时刻只允许一个活动 run。
 */

/** 动态对话消息的最小视图模型。 */
interface ChatMessageView {
  readonly key: string;
  readonly role: "user" | "assistant";
  /** 消息时间戳（本地时间）。 */
  readonly timestamp: string;
  /** 按事件顺序拼接的回答文本；用户消息为原始输入。 */
  text: string;
}

/** 通用失败提示；不透出后端原始错误详情。 */
const SEND_ERROR_TEXT = "消息发送失败，请稍后重试";

/** 格式化消息时间戳（本地时间）。 */
function formatTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 终态事件：恢复发送；失败/中止类终态同时展示通用错误。 */
function isTerminalEvent(event: AgentRunEvent): boolean {
  return (
    event.type === "run.completed" ||
    event.type === "run.failed" ||
    event.type === "run.aborted"
  );
}

/** 页面生命周期内稳定的临时会话标识（非访问凭证）。 */
const sessionId = crypto.randomUUID();

export function ChatPanel() {
  // 消息不持久化：刷新即回到欢迎消息，不恢复旧 run。
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [error, setError] = useState("");
  // 卸载时取消进行中的 SSE 订阅。
  const abortRef = useRef<AbortController | null>(null);
  // 请求执行期间禁止重复提交（覆盖创建前后的短窗口）。
  const sendingRef = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  /** 处理单个 Agent 事件：增量拼接到该 run 的助手消息，终态恢复发送。 */
  function applyEvent(runId: string, event: AgentRunEvent): void {
    if (event.type === "answer.delta") {
      setMessages((current) => {
        const index = current.findIndex((message) => message.key === runId);
        if (index === -1) {
          // 首个增量创建助手消息。
          return [
            ...current,
            {
              key: runId,
              role: "assistant",
              timestamp: formatTime(new Date()),
              text: event.text,
            },
          ];
        }
        const next = [...current];
        next[index] = { ...next[index]!, text: next[index]!.text + event.text };
        return next;
      });
      return;
    }
    if (isTerminalEvent(event)) {
      if (event.type !== "run.completed") {
        setError(SEND_ERROR_TEXT);
      }
      setActiveRunId(null);
    }
  }

  /** 提交非空文本：追加用户消息并创建 run；失败时保留消息并提示。 */
  function handleSubmit(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0 || sendingRef.current || activeRunId !== null) {
      return;
    }
    sendingRef.current = true;
    setError("");
    const runId = crypto.randomUUID();

    setMessages((current) => [
      ...current,
      {
        key: `user-${runId}`,
        role: "user",
        timestamp: formatTime(new Date()),
        text: trimmed,
      },
    ]);
    setActiveRunId(runId);

    void (async () => {
      // 同一 controller 覆盖 POST 与 SSE：卸载时两者都可被取消。
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await createChatRun(
          { sessionId, runId, message: trimmed },
          { signal: controller.signal },
        );
      } catch {
        if (!controller.signal.aborted) {
          // 创建失败：保留用户消息，不创建空助手消息。
          setError(SEND_ERROR_TEXT);
        }
        setActiveRunId(null);
        return;
      }

      try {
        await streamChatEvents(runId, (event) => applyEvent(runId, event), {
          signal: controller.signal,
        });
      } catch {
        // 流中断/失败终态：保留已收到的增量并提示（卸载触发的取消除外）。
        if (!controller.signal.aborted) setError(SEND_ERROR_TEXT);
      } finally {
        // 终态已恢复时保持 null；流异常时兜底恢复发送。
        setActiveRunId((current) => (current === runId ? null : current));
      }
    })().finally(() => {
      sendingRef.current = false;
      // 覆盖 POST 失败提前返回的路径，统一清理取消句柄。
      abortRef.current = null;
    });
  }

  return (
    <main className="chat-panel">
      <div className="chat-panel__header">
        <div className="chat-panel__avatar">
          <BotIcon className="chat-panel__avatar-icon" />
        </div>
        <div className="chat-panel__intro">
          <h1 className="chat-panel__name">AI智能车险助手</h1>
          <p className="chat-panel__subtitle">在线为您提供专业车险报价</p>
        </div>
      </div>
      <div className="chat-panel__messages" aria-live="polite">
        <div className="chat-message">
          <div className="chat-message__avatar">
            <PersonIcon className="chat-message__avatar-icon" />
          </div>
          <div className="chat-message__body">
            <time className="chat-message__time">
              {welcomeMessage.timestamp}
            </time>
            <div className="chat-message__bubble">
              <p className="chat-message__text">{welcomeMessage.text}</p>
            </div>
          </div>
        </div>
        {messages.map((message) => (
          <div className="chat-message" key={message.key}>
            <div className="chat-message__avatar">
              {message.role === "assistant" ? (
                <BotIcon className="chat-message__avatar-icon" />
              ) : (
                <PersonIcon className="chat-message__avatar-icon" />
              )}
            </div>
            <div className="chat-message__body">
              <time className="chat-message__time">{message.timestamp}</time>
              <div className="chat-message__bubble">
                <p className="chat-message__text">{message.text}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <ChatComposer
        disabled={activeRunId !== null}
        onSubmit={handleSubmit}
        error={error}
      />
    </main>
  );
}
