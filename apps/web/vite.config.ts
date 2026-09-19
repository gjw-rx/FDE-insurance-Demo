import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // 同源代理：前端只请求 /api/...，由 dev server 转发到本地业务 API（默认 127.0.0.1:4300，
    // 可用环境变量覆盖），生产环境由部署网关提供相同路径。
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4300",
        changeOrigin: false,
      },
    },
  },
});
