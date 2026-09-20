import { expect, test, type Page } from "@playwright/test";
import { installChatApiMock } from "./chat-api-mock";

// dialog-function 验收测试：覆盖 delta spec workbench-shell 的新增与修改场景。
// 输入区仅本地交互，不发起任何网络请求；越界类型场景用 setInputFiles 向隐藏 input 注入 fixture 文件。

const DEV_SERVER_ORIGIN = "http://localhost:5173";

// 测试文件：内容不被读取或上传，仅用于触发选择事件。
const IMAGE_FIXTURE = "tests/e2e/fixtures/driving-license.png";
const PDF_FIXTURE = "tests/e2e/fixtures/id-card.pdf";
const TEXT_FIXTURE = "tests/e2e/fixtures/notes.txt";

// 键盘交互用例共用的 API 替身：预置一个历史会话使输入区可用，并让 run 保持进行中。
async function mockChatApi(page: Page) {
  const chat = await installChatApiMock(page, {
    sessions: [{ sessionId: "session-1", title: "历史会话" }],
  });
  // 不发送任何事件且不结束响应：模拟进行中的 run，只验证提交行为本身。
  chat.setRunScript({ pending: true });
  return chat;
}

test.describe("工作台首屏区域结构（含对话输入区）", () => {
  test("页面加载完成：四区域与底部输入区展示，无模拟浏览器工具栏", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.getByRole("banner")).toBeVisible(); // 应用品牌栏
    await expect(page.getByRole("main")).toBeVisible(); // 对话主区
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();
    await expect(page.getByRole("region", { name: "保司设置" })).toBeVisible();
    await expect(page.locator(".chat-composer")).toBeVisible(); // 对话输入区

    // 模拟浏览器工具栏不出现
    await expect(page.getByTitle("关闭")).toHaveCount(0);
    await expect(page.getByTitle("后退")).toHaveCount(0);
    await expect(page.getByTitle("前进")).toHaveCount(0);
    await expect(page.getByTitle("刷新")).toHaveCount(0);
  });

  test("欢迎消息内容：助手名称、副标题、带时间戳的欢迎文案与输入区共存", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "AI智能车险助手" }),
    ).toBeVisible();
    await expect(page.getByText("在线为您提供专业车险报价")).toBeVisible();
    await expect(page.getByText("2024-05-31 16:25:28")).toBeVisible();
    const bubble = page.locator(".chat-message__text");
    await expect(bubble).toContainText("行驶证、身份证/营业执照");
    await expect(bubble).toContainText("车牌号或VIN码");
    await expect(page.locator(".chat-composer")).toBeVisible();
  });

  test("输入区底部对齐：贴附对话主区内容底部，不与右列卡片重叠", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1212, height: 786 });
    await page.goto("/");

    const chatBox = await page.getByRole("main").boundingBox();
    const composerBox = await page.locator(".chat-composer").boundingBox();
    expect(chatBox).not.toBeNull();
    expect(composerBox).not.toBeNull();

    // 输入区位于对话主区内部，且贴附其内容底部：只保留卡片自身的下内边距
    // （设计稿 `designs/designs/dialog/export.png` 为 20px，允许 1px 渲染误差）
    const chatBottom = chatBox!.y + chatBox!.height;
    const composerBottom = composerBox!.y + composerBox!.height;
    expect(composerBox!.y).toBeGreaterThan(chatBox!.y);
    expect(chatBottom - composerBottom).toBeGreaterThanOrEqual(0);
    expect(chatBottom - composerBottom).toBeLessThanOrEqual(21);
  });
});

test.describe("对话输入区结构与文件类型提示", () => {
  test("输入区各元素展示：占位文案、上传入口、类型提示与发送按钮", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByPlaceholder("输入您想咨询的车险问题..."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "上传文件" })).toBeVisible();
    await expect(
      page.getByText("仅支持图片、PDF", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
  });

  test("其余区域展示不变：品牌栏、报价卡片、保司卡片与欢迎消息内容保持一致", async ({
    page,
  }) => {
    await page.goto("/");

    // 品牌栏
    const identity = page.locator(".brand-bar__identity");
    await expect(identity.locator("img.brand-mark")).toBeVisible();
    await expect(identity).toHaveText("AI智能车险助手");
    await expect(page.getByRole("link", { name: "退出" })).toBeVisible();

    // 最新报价卡片
    await expect(page.getByText("粤B196YS")).toBeVisible();
    await expect(page.getByText(/交强险/)).toBeVisible();
    await expect(page.getByRole("button", { name: "隐藏" })).toBeVisible();

    // 保司设置卡片
    for (const name of ["中国平安保险", "太平洋保险", "国寿财", "阳光保险"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.locator(".insurer-item__state").nth(1)).toHaveText(
      "已选择",
    );

    // 欢迎消息
    await expect(page.locator(".chat-message__text")).toContainText(
      "您好！我是智能车险助手，很高兴为您服务。",
    );
  });
});

test.describe("对话输入区键盘交互", () => {
  test("按 Enter 发送：清空输入、追加用户消息并产生一次请求", async ({
    page,
  }) => {
    const { runPosts: posts } = await mockChatApi(page);
    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    await input.fill("交强险和商业险有什么区别？");
    await input.press("Enter");

    await expect(input).toHaveValue("");
    // 限定在对话区：首条消息会被自动用做会话标题，全局文本会出现同名元素。
    await expect(
      page
        .locator(".chat-panel__messages")
        .getByText("交强险和商业险有什么区别？"),
    ).toBeVisible();
    expect(posts).toHaveLength(1);
  });

  test("Shift+Enter 换行：输入保留多行且不发送", async ({ page }) => {
    const { runPosts: posts } = await mockChatApi(page);
    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    await input.fill("第一行");
    await input.press("Shift+Enter");
    await input.pressSequentially("第二行");

    await expect(input).toHaveValue("第一行\n第二行");
    // 仅保留欢迎消息，未追加用户消息
    await expect(page.locator(".chat-message")).toHaveCount(1);
    expect(posts).toHaveLength(0);
  });

  test("空输入或纯空白时按 Enter 不发送", async ({ page }) => {
    const { runPosts: posts } = await mockChatApi(page);
    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    await input.press("Enter");
    await input.fill("   ");
    await input.press("Enter");

    await expect(page.locator(".chat-message")).toHaveCount(1);
    expect(posts).toHaveLength(0);
  });

  test("输入法组合态按 Enter：只上屏不发送", async ({ page }) => {
    const { runPosts: posts } = await mockChatApi(page);
    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    await input.fill("车险");
    // 模拟候选未上屏时的 Enter：isComposing 为真，必须被忽略。
    await input.dispatchEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
    });

    await expect(input).toHaveValue("车险");
    await expect(page.locator(".chat-message")).toHaveCount(1);
    expect(posts).toHaveLength(0);
  });
});

test.describe("对话输入区本地交互", () => {
  test("空输入时发送不可用", async ({ page }) => {
    await mockChatApi(page);
    await page.goto("/");

    const send = page.getByRole("button", { name: "发送" });
    await expect(send).toBeDisabled();

    // 仅空白字符同样视为空输入
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("   ");
    await expect(send).toBeDisabled();
  });

  test("输入内容后发送并清空：追加用户消息并产生一次业务 API 请求", async ({
    page,
  }) => {
    // 替身预置一个会话，run 保持进行中以验证发送后的界面状态。
    const { runPosts: posts } = await mockChatApi(page);

    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    const send = page.getByRole("button", { name: "发送" });

    await input.fill("我的车险续保要多少钱？");
    await expect(send).toBeEnabled();
    await send.click();

    await expect(input).toHaveValue("");
    // 用户消息追加：欢迎 + 用户消息 = 2 条
    await expect(page.locator(".chat-message")).toHaveCount(2);
    await expect(
      page.locator(".chat-panel__messages").getByText("我的车险续保要多少钱？"),
    ).toBeVisible();
    // 活动 run 期间发送按钮不可用
    await expect(send).toBeDisabled();
    expect(posts).toHaveLength(1);
  });

  test("选择图片或 PDF 文件：不出现错误提示", async ({ page }) => {
    await page.goto("/");

    const fileInput = page.locator(".chat-composer__file-input");
    await expect(page.locator(".chat-composer__file-input")).toHaveAttribute(
      "accept",
      "image/*,.pdf",
    );

    await fileInput.setInputFiles(IMAGE_FIXTURE);
    await expect(page.locator(".chat-composer__error")).toHaveCount(0);

    await fileInput.setInputFiles(PDF_FIXTURE);
    await expect(page.locator(".chat-composer__error")).toHaveCount(0);
  });

  test("选择越界类型文件：显示固定提示且不记录该文件", async ({ page }) => {
    await page.goto("/");

    const fileInput = page.locator(".chat-composer__file-input");
    await fileInput.setInputFiles(TEXT_FIXTURE);

    await expect(
      page.getByText("仅支持图片、PDF 格式的文件", { exact: true }),
    ).toBeVisible();

    // 文件选择器被重置，未记录任何文件
    const selectedCount = await fileInput.evaluate(
      (element) => (element as HTMLInputElement).files?.length ?? 0,
    );
    expect(selectedCount).toBe(0);

    // 重新选择合法文件后提示消失
    await fileInput.setInputFiles(PDF_FIXTURE);
    await expect(page.locator(".chat-composer__error")).toHaveCount(0);
  });

  test("输入区网络边界：文本发送只调业务 API，文件选择无上传请求", async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== DEV_SERVER_ORIGIN) {
        externalRequests.push(request.url());
      }
    });
    const { runPosts: posts } = await mockChatApi(page);

    await page.goto("/");

    const input = page.getByPlaceholder("输入您想咨询的车险问题...");
    await input.fill("粤B196YS");
    await page.getByRole("button", { name: "发送" }).click();
    await page
      .locator(".chat-composer__file-input")
      .setInputFiles(IMAGE_FIXTURE);

    await expect(input).toHaveValue("");
    await expect(page.locator(".chat-message")).toHaveCount(2);
    // 文本发送只产生同源业务 API 请求，文件选择不产生上传
    expect(posts).toHaveLength(1);
    expect(externalRequests).toEqual([]);
  });
});
