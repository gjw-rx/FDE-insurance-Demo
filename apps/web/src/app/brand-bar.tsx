import brandLogo from "../assets/brand-logo.png";
import { currentUser } from "./current-user";

// 应用品牌栏：品牌图形标、产品名、用户问候与退出入口。
export function BrandBar() {
  return (
    <header className="brand-bar">
      <div className="brand-bar__identity">
        <img className="brand-mark" src={brandLogo} alt="" />
        <span className="brand-bar__product-name">AI智能车险助手</span>
      </div>
      <div className="brand-bar__user">
        <span className="brand-bar__avatar" aria-hidden="true" />
        <span className="brand-bar__greeting">你好,{currentUser.name}</span>
        <a className="brand-bar__logout" href="#">
          退出
        </a>
      </div>
    </header>
  );
}
