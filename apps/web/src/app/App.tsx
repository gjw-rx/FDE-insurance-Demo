import { BrandBar } from "./brand-bar";
import { ChatWorkspace } from "../features/chat/chat-workspace";
import { InsurerSettingsCard } from "../features/renewal/insurer-settings-card";
import { QuoteCard } from "../features/renewal/quote-card";

// 工作台首屏静态壳：按原型组合品牌栏、对话主区与右列两张卡片。
// 会话状态由 features/chat 的容器持有，这里只负责顶层组合。
export function App() {
  return (
    <div className="workbench">
      <BrandBar />
      <div className="workbench-grid">
        <main className="chat-panel">
          <ChatWorkspace />
        </main>
        <aside className="workbench-side">
          <QuoteCard />
          <InsurerSettingsCard />
        </aside>
      </div>
    </div>
  );
}
