import { expect, test } from "@playwright/test";
import { installChatApiMock, offlineChatApi } from "./chat-api-mock";

// front-init 验收测试：覆盖 delta spec workbench-shell 的全部 scenario。
// 页面为纯静态壳，无后端依赖；Playwright 通过 webServer 拉起 Vite dev server。

test.describe("工作台首屏区域结构", () => {
  test("页面加载完成：四区域展示且无模拟浏览器工具栏", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible(); // 应用品牌栏
    await expect(page.getByRole("main", { name: "" })).toBeVisible(); // 对话主区
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();
    await expect(page.getByRole("region", { name: "保司设置" })).toBeVisible();

    // 品牌栏：图形标 + 产品名；不出现其他品牌文案
    const identity = page.locator(".brand-bar__identity");
    await expect(identity.locator("img.brand-mark")).toBeVisible();
    await expect(identity).toHaveText("AI智能车险助手");

    // 模拟浏览器工具栏不出现（原型中的窗口控制与导航图标）
    await expect(page.getByTitle("关闭")).toHaveCount(0);
    await expect(page.getByTitle("最小化")).toHaveCount(0);
    await expect(page.getByTitle("最大化")).toHaveCount(0);
    await expect(page.getByTitle("后退")).toHaveCount(0);
    await expect(page.getByTitle("前进")).toHaveCount(0);
    await expect(page.getByTitle("刷新")).toHaveCount(0);
  });

  test("欢迎消息内容：助手名称、副标题与带时间戳的欢迎文案", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "AI智能车险助手" }),
    ).toBeVisible();
    await expect(page.getByText("在线为您提供专业车险报价")).toBeVisible();
    await expect(page.getByText("2024-05-31 16:25:28")).toBeVisible();
    const bubble = page.locator(".chat-message__text");
    await expect(bubble).toContainText(
      "您好！我是智能车险助手，很高兴为您服务。",
    );
    await expect(bubble).toContainText("行驶证、身份证/营业执照");
    await expect(bubble).toContainText("车牌号或VIN码");
  });
});

test.describe("最新报价卡片信息隐藏切换", () => {
  test("隐藏报价信息：车牌与摘要被遮蔽，入口变为「显示」", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("粤B196YS")).toBeVisible();
    await page.getByRole("button", { name: "隐藏" }).click();

    await expect(page.getByText("粤B196YS")).toHaveCount(0);
    await expect(page.locator(".quote-card__plate")).toHaveText("••••••");
    await expect(page.locator(".quote-card__summary")).toHaveText(
      "••••••••••••",
    );
    await expect(page.getByRole("button", { name: "显示" })).toBeVisible();
  });

  test("恢复显示报价信息：信息恢复可读，入口切回「隐藏」", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "隐藏" }).click();
    await page.getByRole("button", { name: "显示" }).click();

    await expect(page.getByText("粤B196YS")).toBeVisible();
    await expect(page.getByText(/交强险/)).toBeVisible();
    await expect(page.getByRole("button", { name: "隐藏" })).toBeVisible();
  });
});

test.describe("保司选择状态切换", () => {
  test("初始选择状态：四家保司展示，太平洋保险为已选择", async ({ page }) => {
    await page.goto("/");

    for (const name of ["中国平安保险", "太平洋保险", "国寿财", "阳光保险"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("PING AN INSURANCE")).toBeVisible();
    await expect(page.getByText("CPIC INSURANCE")).toBeVisible();
    await expect(page.getByText("CHINA LIFE P&C")).toBeVisible();
    await expect(page.getByText("SUNSHINE INSURANCE")).toBeVisible();

    // 初始状态与静态示例数据一致：太平洋保险已选择，其余请选择
    const states = page.locator(".insurer-item__state");
    await expect(states).toHaveCount(4);
    await expect(states.nth(1)).toHaveText("已选择");
    for (const index of [0, 2, 3]) {
      await expect(states.nth(index)).toHaveText("请选择");
    }
  });

  test("切换选中保司：新选中生效，原选中变回请选择", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator(".insurer-item__state").nth(1)).toHaveText(
      "已选择",
    );
    page.locator(".insurer-item").nth(0).click(); // 中国平安保险

    const states = page.locator(".insurer-item__state");
    await expect(states.nth(0)).toHaveText("已选择");
    await expect(states.nth(1)).toHaveText("请选择");
    await expect(states.nth(2)).toHaveText("请选择");
    await expect(states.nth(3)).toHaveText("请选择");
  });

  test("取消选中一家保司：状态变回请选择且无网络请求", async ({ page }) => {
    // 会话区域需要后端参与：用空历史替身避免首屏请求失败干扰本用例。
    await installChatApiMock(page, { sessions: [] });
    await page.goto("/");

    const failedRequests: string[] = [];
    page.on("requestfailed", (request) => failedRequests.push(request.url()));
    page.on("response", (response) => {
      if (response.status() >= 400) failedRequests.push(response.url());
    });

    await page.locator(".insurer-item").nth(1).click(); // 取消太平洋保险
    const states = page.locator(".insurer-item__state");
    await expect(states.nth(1)).toHaveText("请选择");
    for (const index of [0, 2, 3]) {
      await expect(states.nth(index)).toHaveText("请选择");
    }
    expect(failedRequests).toEqual([]);
  });
});

test.describe("桌面优先自适应布局", () => {
  test("基准桌面视口：对话主区居左，两张卡片居右纵排", async ({ page }) => {
    await page.setViewportSize({ width: 1212, height: 786 });
    await page.goto("/");

    const chat = page.getByRole("main");
    const quote = page.getByRole("region", { name: "最新报价" });
    const insurer = page.getByRole("region", { name: "保司设置" });

    const chatBox = await chat.boundingBox();
    const quoteBox = await quote.boundingBox();
    const insurerBox = await insurer.boundingBox();
    expect(chatBox).not.toBeNull();
    expect(quoteBox).not.toBeNull();
    expect(insurerBox).not.toBeNull();

    // 对话主区居左，报价卡片在其右侧；两张卡片右列纵向排列
    expect(quoteBox!.x).toBeGreaterThan(chatBox!.x + chatBox!.width);
    expect(insurerBox!.y).toBeGreaterThan(quoteBox!.y);

    // 对话主区与右列区域等高对齐（允许 1px 渲染误差）
    const sideBox = await page.locator(".workbench-side").boundingBox();
    expect(sideBox).not.toBeNull();
    expect(Math.abs(chatBox!.y - sideBox!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(chatBox!.height - sideBox!.height)).toBeLessThanOrEqual(1);
  });

  test("较窄桌面视口：无横向滚动，卡片堆叠且文本可读", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/");

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // 卡片堆叠到对话区下方
    const chatBox = await page.getByRole("main").boundingBox();
    const quoteBox = await page
      .getByRole("region", { name: "最新报价" })
      .boundingBox();
    expect(chatBox).not.toBeNull();
    expect(quoteBox).not.toBeNull();
    expect(quoteBox!.y).toBeGreaterThan(chatBox!.y + chatBox!.height - 1);

    // 文本保持可读（可见且不零尺寸）
    await expect(page.getByText("粤B196YS")).toBeVisible();
    await expect(page.getByText("中国平安保险", { exact: true })).toBeVisible();
  });
});

test.describe("无后端服务的静态展示", () => {
  test("无后端环境打开页面：区域完整展示，本地交互可用", async ({ page }) => {
    // 显式模拟后端不可达：不依赖开发机是否在默认端口跑着真实 API。
    await offlineChatApi(page);
    // 页面不依赖任何 API；仅放行 Vite dev server 自身的资源请求（baseURL 在 playwright.config.ts 固定为 localhost:5173）
    const DEV_SERVER_ORIGIN = "http://localhost:5173";
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== DEV_SERVER_ORIGIN) {
        externalRequests.push(request.url());
      }
    });

    await page.goto("/");

    // 四个区域完整展示；首屏历史会话请求失败只影响会话区域
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();
    await expect(page.getByRole("region", { name: "保司设置" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI智能车险助手" }),
    ).toBeVisible();
    await expect(page.locator(".chat-composer")).toBeVisible();

    // 历史会话区域展示自身的加载失败状态与重试入口，不影响其余区域
    await expect(page.getByText("历史会话加载失败")).toBeVisible();
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();

    // 报价隐藏切换与保司选择切换均可用
    await page.getByRole("button", { name: "隐藏" }).click();
    await expect(page.getByRole("button", { name: "显示" })).toBeVisible();
    await page.locator(".insurer-item").nth(2).click();
    await expect(page.locator(".insurer-item__state").nth(2)).toHaveText(
      "已选择",
    );

    expect(externalRequests).toEqual([]);
  });
});
