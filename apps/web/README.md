# Web 工程骨架

该应用采用 React + TypeScript + Vite，承载材料上传、五项资料确认、会话、报价和核保进度界面。当前已实现工作台首屏静态壳（见归档 change `openspec/changes/archive/2026-09-15-front-init/`）：按 `designs/insurance-assistant.png` 原型还原四个区域，并按 `designs/designs/dialog/export.png` 补充对话输入区（见归档 change `openspec/changes/archive/2026-09-15-dialog-function/`）；交互仅用前端本地状态，不调用后端接口。

```text
src/
├── app/                            # 应用入口与页面外壳
│   ├── main.tsx                    # 应用入口
│   ├── App.tsx                     # 首屏布局组合
│   ├── brand-bar.tsx               # 应用品牌栏
│   ├── current-user.ts             # 外壳使用的静态用户信息
│   └── styles.css                  # 全局样式与 design tokens（颜色/圆角/阴影/字体栈）
├── features/
│   ├── chat/                       # 对话主区、输入区与静态欢迎消息
│   └── renewal/                    # 报价、保司设置与静态续保数据
├── shared/
│   ├── api/                        # HTTP/SSE 客户端（预留）
│   └── ui/                         # 无业务语义的通用 UI（当前为内联 SVG 图标）
└── assets/                         # 图片等静态资源
```

Web 只依赖 `@renewal/contracts`，不直接依赖领域实体、Pi SDK 或保险公司 SDK。
