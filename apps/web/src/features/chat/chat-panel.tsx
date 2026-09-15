import { BotIcon, PersonIcon } from "../../shared/ui/icons";
import { ChatComposer } from "./chat-composer";
import { welcomeMessage } from "./data";

// 对话主区：助手标题、带时间戳的欢迎消息与底部对话输入区（输入区仅本地交互）。
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
      <ChatComposer />
    </main>
  );
}
