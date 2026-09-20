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
        onSubmit={onSubmit}
        error={error}
      />
    </section>
  );
}
