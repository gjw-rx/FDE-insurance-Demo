# Web 工程骨架

该应用采用 React + TypeScript + Vite，承载材料上传、五项资料确认、会话、报价和核保进度界面。当前已实现工作台首屏静态壳（见归档 change `openspec/changes/archive/2026-09-15-front-init/`）：按 `designs/insurance-assistant.png` 原型还原四个区域，并按 `designs/designs/dialog/export.png` 补充对话输入区（见归档 change `openspec/changes/archive/2026-09-15-dialog-function/`）；交互仅用前端本地状态，不调用后端接口。

```text
src/
├── app/                            # 应用入口与首屏静态壳
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 首屏布局组合
│   ├── styles.css                  # 全局样式与 design tokens（颜色/圆角/阴影/字体栈）
│   ├── data.ts                     # 静态示例数据（保司清单、车牌、欢迎文案、用户名）
│   ├── icons.tsx                   # 手写内联 SVG 图标
│   ├── brand-bar.tsx               # 应用品牌栏
│   ├── chat-panel.tsx              # 对话主区（助手标题、欢迎消息与输入区）
│   ├── chat-composer.tsx           # 对话输入区（文本输入、上传入口、发送按钮）
│   ├── quote-card.tsx              # 最新报价卡片（隐藏/显示切换）
│   └── insurer-settings-card.tsx   # 保司设置卡片（单选切换）
├── features/
│   ├── chat/                       # 对话和快速保险问答（预留，待接 API）
│   └── renewal/                    # 材料、五项资料、报价与核保进度（预留，待接 API）
└── shared/
    ├── api/                        # HTTP/SSE 客户端（预留）
    └── ui/                         # 无业务语义的通用组件（预留）
```

Web 只依赖 `@renewal/contracts`，不直接依赖领域实体、Pi SDK 或保险公司 SDK。
