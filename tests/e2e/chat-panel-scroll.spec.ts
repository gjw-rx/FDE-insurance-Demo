import { expect, test, type Page } from "@playwright/test";
import { installChatApiMock } from "./chat-api-mock";

// 对话区固定高度验收测试：助手回答变长时只在消息区内部滚动，页面整体不被拉长。
// 用例由 route mock 驱动，不依赖真实 API / insurance-agent / 模型凭据。

/** 桌面基准视口：与设计稿一致，右列卡片能完整摊开。 */
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

/** 长回答行数：保证消息区内容明显超过可视高度。 */
const LONG_ANSWER_LINES = 40;

/** 对话消息区（内部滚动容器）。 */
function messageArea(page: Page) {
  return page.locator(".chat-panel__messages");
}

/** 输入文本并点击发送。 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("输入您想咨询的车险问题...").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

/** 长回答文本：每行独立，便于断言末尾行是否渲染。 */
function longAnswerLines(): string[] {
  return Array.from(
    { length: LONG_ANSWER_LINES },
    (__, index) => `第 ${index + 1} 行回答内容`,
  );
}

/** 打开页面并注入一段会分片流式输出的长回答脚本。 */
async function openWithLongAnswer(page: Page): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  const chat = await installChatApiMock(page, {
    sessions: [{ sessionId: "session-1", title: "新会话" }],
  });
  chat.setRunScript({
    deltas: longAnswerLines().map((line) => `${line}\n`),
    terminal: "run.completed",
  });
  await page.goto("/");
}

/** 页面与外层工作台的高度快照。 */
async function layoutMetrics(page: Page) {
  return page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    workbenchHeight:
      document.querySelector(".workbench")?.getBoundingClientRect().height ?? 0,
  }));
}

test.describe("对话区固定高度与内部滚动", () => {
  test("长回答只在消息区内部滚动：页面不被拉长且视图跟随最新回复", async ({
    page,
  }) => {
    await openWithLongAnswer(page);
    const before = await layoutMetrics(page);

    await send(page, "介绍一下车险续保流程");
    const messages = messageArea(page);
    await expect(messages).toContainText(`第 ${LONG_ANSWER_LINES} 行回答内容`);

    // 消息区自身出现滚动条：内容高度超过可视高度。
    const scroll = await messages.evaluate((element) => {
      const box = element as HTMLElement;
      return {
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
        distanceToBottom: box.scrollHeight - box.scrollTop - box.clientHeight,
      };
    });
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    // 自动跟随：流式输出结束后最新一条回复仍在可视区内。
    expect(scroll.distanceToBottom).toBeLessThanOrEqual(2);

    // 页面与外层工作台高度保持不变：对话变长不再撑高整个界面。
    const after = await layoutMetrics(page);
    expect(after.documentHeight).toBe(before.documentHeight);
    expect(after.workbenchHeight).toBe(before.workbenchHeight);
    expect(after.documentHeight).toBeLessThanOrEqual(after.viewportHeight);
  });

  test("向上回看历史后发送新消息：视图回到最新回复", async ({ page }) => {
    await openWithLongAnswer(page);
    await send(page, "介绍一下车险续保流程");

    const messages = messageArea(page);
    await expect(messages).toContainText(`第 ${LONG_ANSWER_LINES} 行回答内容`);

    // 模拟用户拖动滚动条回看历史。
    await messages.evaluate((element) => {
      (element as HTMLElement).scrollTop = 0;
    });
    await expect
      .poll(() => messages.evaluate((element) => element.scrollTop))
      .toBe(0);

    await send(page, "那需要准备哪些材料");
    // 用户主动发送后重新贴底，新问题与后续回答都在可视区内。
    await expect
      .poll(() =>
        messages.evaluate(
          (element) =>
            element.scrollHeight - element.scrollTop - element.clientHeight,
        ),
      )
      .toBeLessThanOrEqual(2);
  });
});
