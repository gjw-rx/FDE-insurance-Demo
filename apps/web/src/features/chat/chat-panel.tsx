import { useLayoutEffect, useRef } from "react";
import { BotIcon, PersonIcon } from "../../shared/ui/icons";
import { ChatComposer } from "./chat-composer";
import { welcomeMessage } from "./data";
import type { ChatMessageView } from "./messages";

/**
 * 对话主区（展示组件）。
 *
 * 只负责渲染助手标题、欢迎消息、当前会话消息与底部输入区；消息集合、加载状态、
 * 失败提示与提交回调都由 `chat-workspace.tsx` 提供。欢迎消息是固定首屏内容，
 * 与会话消息无关，因此任一会话为空时都保留该气泡。
 *
 * 消息区高度由工作台固定高度决定（见 app/styles.css），新增消息只在消息区内部
 * 滚动；这里负责把视图保持在最新一条消息上。
 */

export interface ChatPanelProps {
  readonly messages: readonly ChatMessageView[];
  /** 会话详情正在加载（切换会话时短暂出现）。 */
  readonly loading: boolean;
  /** 会话详情加载失败提示；空串表示无错误。 */
  readonly detailError: string;
  /** 是否已选中可用会话；未选中时不能发送。 */
  readonly hasSession: boolean;
  /** 活动 run 期间禁用发送。 */
  readonly disabled: boolean;
  /** 发送失败提示；空串表示无错误。 */
  readonly error: string;
  readonly onSubmit: (text: string) => void;
}

export function ChatPanel({
  messages,
  loading,
  detailError,
  hasSession,
  disabled,
  error,
  onSubmit,
}: ChatPanelProps) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // 是否跟随最新消息；用户向上回看历史时为 false，避免流式输出把视图强行拉回底部。
  const stickToBottomRef = useRef(true);

  // 切换会话时重置跟随：新打开的会话默认从最新一条消息看起。
  useLayoutEffect(() => {
    if (loading) stickToBottomRef.current = true;
  }, [loading]);

  // 贴底滚动必须在浏览器绘制前完成，否则会看到一帧停留在旧位置。
  useLayoutEffect(() => {
    const container = messagesRef.current;
    if (container === null || !stickToBottomRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, loading]);

  /** 滚动事件只记录用户是否还在底部，不直接改滚动位置。 */
  function handleMessagesScroll(): void {
    const container = messagesRef.current;
    if (container === null) return;
    // 留 24px 容差：亚像素与平滑滚动下仍视为「在底部」，避免提前停止跟随。
    stickToBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      24;
  }

  /** 主动发送即恢复跟随：刚发出的问题与随后的回答都应可见。 */
  function handleSubmit(text: string): void {
    stickToBottomRef.current = true;
    onSubmit(text);
  }

  return (
    <section className="chat-panel__main">
      <div className="chat-panel__header">
        <div className="chat-panel__avatar">
          <BotIcon className="chat-panel__avatar-icon" />
        </div>
        <div className="chat-panel__intro">
          <h1 className="chat-panel__name">AI智能车险助手</h1>
          <p className="chat-panel__subtitle">在线为您提供专业车险报价</p>
        </div>
      </div>

      {/* 消息区可键盘聚焦：内部滚动区不能只靠鼠标访问 */}
      <div
        className="chat-panel__messages"
        ref={messagesRef}
        onScroll={handleMessagesScroll}
        tabIndex={0}
        aria-live="polite"
      >
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

        {loading ? (
          <p className="chat-panel__loading" role="status">
            正在加载会话内容…
          </p>
        ) : null}
      </div>

      {detailError ? (
        <p className="chat-panel__error" role="status">
          {detailError}
        </p>
      ) : null}

      <ChatComposer
        disabled={disabled || !hasSession}
        onSubmit={handleSubmit}
        error={error}
      />
    </section>
  );
}
