import { useState } from "react";
import { latestQuote } from "./data";
import { EyeIcon, EyeOffIcon, FileTextIcon } from "./icons";

const PLATE_MASK = "••••••";
const SUMMARY_MASK = "••••••••••••";

// 最新报价卡片：车牌标签与示例报价摘要，支持「隐藏 / 显示」本地切换。
export function QuoteCard() {
  const [hidden, setHidden] = useState(false);

  return (
    <section className="quote-card" aria-label="最新报价">
      <div className="card-head">
        <FileTextIcon className="card-head__icon card-head__icon--mint" />
        <h2 className="card-head__title">最新报价</h2>
        <button
          type="button"
          className="quote-card__toggle"
          onClick={() => setHidden((value) => !value)}
        >
          {hidden ? (
            <EyeIcon className="quote-card__toggle-icon" />
          ) : (
            <EyeOffIcon className="quote-card__toggle-icon" />
          )}
          {hidden ? "显示" : "隐藏"}
        </button>
      </div>
      <div className="quote-card__content">
        <span className="quote-card__plate">
          {hidden ? PLATE_MASK : latestQuote.plateNo}
        </span>
        <p className="quote-card__summary">
          {hidden ? SUMMARY_MASK : latestQuote.summary}
        </p>
      </div>
    </section>
  );
}
