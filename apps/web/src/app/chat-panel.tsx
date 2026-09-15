import { welcomeMessage } from "./data";
import { BotIcon, PersonIcon } from "./icons";

// 对话主区：助手标题与带时间戳的欢迎消息（静态展示，无输入框）。
export function ChatPanel() {
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
      <div className="chat-message">
        <div className="chat-message__avatar">
          <PersonIcon className="chat-message__avatar-icon" />
        </div>
        <div className="chat-message__body">
          <time className="chat-message__time">{welcomeMessage.timestamp}</time>
          <div className="chat-message__bubble">
            <p className="chat-message__text">{welcomeMessage.text}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
