import { BrandBar } from "./brand-bar";
import { ChatPanel } from "./chat-panel";
import { InsurerSettingsCard } from "./insurer-settings-card";
import { QuoteCard } from "./quote-card";

// 工作台首屏静态壳：按原型组合品牌栏、对话主区与右列两张卡片（见 design.md D2/D5）。
export function App() {
  return (
    <div className="workbench">
      <BrandBar />
      <div className="workbench-grid">
        <ChatPanel />
        <aside className="workbench-side">
          <QuoteCard />
          <InsurerSettingsCard />
        </aside>
      </div>
    </div>
  );
}
