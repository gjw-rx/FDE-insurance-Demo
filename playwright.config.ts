import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    // 本地复用已运行的 dev server；strictPort 保证端口被无关进程占用时直接失败，不会误连。
    command: "corepack pnpm --filter @renewal/web dev --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
