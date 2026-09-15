import { useState } from "react";
import { initiallySelectedInsurerId, insurerOptions } from "./data";
import { Settings2Icon } from "./icons";

// 保司设置卡片：四家保司清单，「请选择 / 已选择」单选切换（同一时刻至多一家已选择）。
export function InsurerSettingsCard() {
  const [selectedId, setSelectedId] = useState<string | null>(
    initiallySelectedInsurerId,
  );

  return (
    <section className="insurer-card" aria-label="保司设置">
      <div className="card-head">
        <Settings2Icon className="card-head__icon" />
        <h2 className="card-head__title">保司设置</h2>
      </div>
      <ul className="insurer-card__list">
        {insurerOptions.map((insurer) => {
          const selected = insurer.id === selectedId;
          return (
            <li key={insurer.id}>
              <button
                type="button"
                className={`insurer-item${selected ? " insurer-item--selected" : ""}`}
                onClick={() => setSelectedId(selected ? null : insurer.id)}
                aria-pressed={selected}
              >
                <span className="insurer-item__identity">
                  <span
                    className="insurer-item__logo"
                    style={{ backgroundColor: insurer.brandColor }}
                  />
                  <span className="insurer-item__labels">
                    <span className="insurer-item__name">{insurer.name}</span>
                    <span className="insurer-item__english-name">
                      {insurer.englishName}
                    </span>
                  </span>
                </span>
                <span className="insurer-item__state">
                  {selected ? "已选择" : "请选择"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
