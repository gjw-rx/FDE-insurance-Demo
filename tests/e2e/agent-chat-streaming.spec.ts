import { expect, test, type Page } from "@playwright/test";
import { installChatApiMock, type ChatApiMock } from "./chat-api-mock";

// agent-chat-streaming 验收测试：route mock 覆盖前端可观察行为。
// 不依赖真实 API / insurance-agent / 模型凭据；SSE 由替身按脚本回放。

/** 输入文本并点击发送。 */
async function send(page: Page, text: string): Promise<void> {
  await page.getByPlaceholder("输入您想咨询的车险问题...").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

/**
 * 对话区定位器。
 *
 * 首条消息会被服务端用作会话标题，全局文本查询会同时命中会话列表与消息区，
 * 因此消息断言必须限定在对话区内。
 */
function messageArea(page: Page) {
  return page.locator(".chat-panel__messages");
}

/** 会话栏上的当前会话标题。 */
function sessionBarTitle(page: Page) {
  return page.locator(".chat-session-bar__title");
}

/** 新建会话按钮（文本与设计稿一致为「新会话」，需精确匹配以免命中共名的会话项）。 */
function createSessionButton(page: Page) {
  return page.getByRole("button", { name: "新会话", exact: true });
}

/** 展开会话面板：会话列表默认收在会话栏图标的后面。 */
async function openSessionPanel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "展开会话列表" }).click();
}

/** 安装替身并打开页面。 */
async function openWithMock(
  page: Page,
  options: Parameters<typeof installChatApiMock>[1] = {},
): Promise<ChatApiMock> {
  const chat = await installChatApiMock(page, options);
  await page.goto("/");
  return chat;
}

/** 一个包含已保存问答的历史会话。 */
function sessionWithHistory() {
  return {
    sessionId: "session-history",
    title: "历史续保咨询",
    titleSource: "first-message" as const,
    updatedAt: "2026-09-20T01:00:00.000Z",
    messages: [
      { role: "user" as const, text: "上次问的续保问题", status: "accepted" },
      { role: "assistant" as const, text: "上次的回答", status: "completed" },
    ],
  };
}

test.describe("对话流式链路（route mock）", () => {
  test("发送后输入清空、增量合并到同一助手消息、完成后恢复发送", async ({
    page,
  }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.setRunScript({
      deltas: ["车险", "续保", "流程"],
      terminal: "run.completed",
    });

    await send(page, "车险续保怎么办理？");

    await expect(
      page.getByPlaceholder("输入您想咨询的车险问题..."),
    ).toHaveValue("");
    await expect(
      messageArea(page).getByText("车险续保怎么办理？"),
    ).toBeVisible();
    // 增量合并为一条助手消息：整体文本恰好为三段拼接
    await expect(messageArea(page).getByText("车险续保流程")).toBeVisible();

    // 完成后发送恢复可用：重新输入后可发送第二条
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("第二条消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
    await send(page, "第二条消息");
    await expect(messageArea(page).getByText("第二条消息")).toBeVisible();

    // 同一会话的两次发送使用同一 sessionId、不同 runId
    expect(chat.runPosts).toHaveLength(2);
    expect(chat.runPosts[0]!.sessionId).toBe("session-1");
    expect(chat.runPosts[0]!.runId).not.toBe(chat.runPosts[1]!.runId);
  });

  test("活动 run 期间发送按钮禁用，重复点击不产生第二个 POST", async ({
    page,
  }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.setRunScript({ pending: true });

    await send(page, "第一条消息");

    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("第二条消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(chat.runPosts).toHaveLength(1);
  });

  test("创建失败：显示通用错误、保留用户消息、不创建空助手消息", async ({
    page,
  }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.failRunCreate(true);

    await send(page, "测试消息");

    await expect(page.locator(".chat-composer__error")).toContainText(
      "消息发送失败",
    );
    // 用户消息保留（欢迎消息 + 用户消息 = 2 条），且没有助手消息
    await expect(messageArea(page).getByText("测试消息")).toBeVisible();
    await expect(page.locator(".chat-message")).toHaveCount(2);
    // 恢复发送能力
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("SSE 流提前中断：显示通用错误并保留已收到的增量", async ({ page }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    // 有增量但无终态：上游意外中断。
    chat.setRunScript({ deltas: ["部分回答"], endWithoutTerminal: true });

    await send(page, "流中断测试");

    await expect(page.locator(".chat-composer__error")).toContainText(
      "消息发送失败",
    );
    await expect(messageArea(page).getByText("部分回答")).toBeVisible();
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("run.failed 终态：显示通用错误、恢复发送且不渲染技术信息", async ({
    page,
  }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.setRunScript({ deltas: ["部分"], terminal: "run.failed" });

    await send(page, "失败终态测试");

    await expect(page.locator(".chat-composer__error")).toContainText(
      "消息发送失败",
    );
    await expect(page.getByText("INTERNAL_ERROR")).toHaveCount(0);
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("run.aborted 终态：显示通用错误并恢复发送", async ({ page }) => {
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.setRunScript({ deltas: ["部分"], terminal: "run.aborted" });

    await send(page, "中止终态测试");

    await expect(page.locator(".chat-composer__error")).toContainText(
      "消息发送失败",
    );
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("无后端环境发送文本：通用失败提示，其他区域仍可用", async ({ page }) => {
    // 会话列表正常但 run 创建不可用：等价于对话链路降级。
    const chat = await openWithMock(page, {
      sessions: [{ sessionId: "session-1", title: "新会话" }],
    });
    chat.failRunCreate(true);

    await send(page, "无后端消息");

    await expect(page.locator(".chat-composer__error")).toContainText(
      "消息发送失败",
    );
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();
    await expect(page.getByRole("region", { name: "保司设置" })).toBeVisible();
    await page.getByRole("button", { name: "隐藏" }).click();
    await expect(page.getByRole("button", { name: "显示" })).toBeVisible();
  });
});

test.describe("会话管理（route mock）", () => {
  test("首次打开没有历史会话：显示空状态并提供新建入口", async ({ page }) => {
    await openWithMock(page, { sessions: [] });

    // 未选中会话时不能发送，会话栏提示从新建开始
    await expect(sessionBarTitle(page)).toHaveText("未选择会话");
    await expect(page.locator(".chat-session-bar__time")).toContainText(
      "点击「新会话」开始对话",
    );
    await expect(createSessionButton(page)).toBeEnabled();
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

    // 展开面板后显示空状态
    await openSessionPanel(page);
    await expect(
      page.getByText("还没有历史会话", { exact: false }),
    ).toBeVisible();
  });

  test("新建会话：默认标题为「新会话」且没有历史消息", async ({ page }) => {
    await openWithMock(page, { sessions: [] });

    await createSessionButton(page).click();

    await expect(sessionBarTitle(page)).toHaveText("新会话");
    // 只有欢迎消息
    await expect(page.locator(".chat-message")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

    await openSessionPanel(page);
    await expect(page.locator(".chat-session-item__name")).toHaveText("新会话");
  });

  test("首条消息自动命名并同步会话栏与会话列表", async ({ page }) => {
    const chat = await openWithMock(page, { sessions: [] });
    chat.setRunScript({ deltas: ["需要行驶证"], terminal: "run.completed" });

    await createSessionButton(page).click();
    await expect(sessionBarTitle(page)).toHaveText("新会话");

    await send(page, "我的车险要续保");

    await expect(sessionBarTitle(page)).toHaveText("我的车险要续保");
    await openSessionPanel(page);
    await expect(page.locator(".chat-session-item__name")).toHaveText(
      "我的车险要续保",
    );
  });

  test("切换历史会话恢复已保存消息，且不混合两个会话的消息", async ({
    page,
  }) => {
    await openWithMock(page, {
      sessions: [
        {
          sessionId: "session-old",
          title: "较早会话",
          titleSource: "first-message",
          updatedAt: "2026-09-20T00:00:00.000Z",
          messages: [
            { role: "user", text: "较早会话的问题", status: "accepted" },
            { role: "assistant", text: "较早会话的回答", status: "completed" },
          ],
        },
        sessionWithHistory(),
      ],
    });

    // 默认打开最近更新的会话（session-history）
    await expect(messageArea(page).getByText("上次问的续保问题")).toBeVisible();
    await expect(messageArea(page).getByText("较早会话的问题")).toHaveCount(0);

    await openSessionPanel(page);
    await page
      .locator(".chat-session-item__select", { hasText: "较早会话" })
      .click();

    await expect(messageArea(page).getByText("较早会话的问题")).toBeVisible();
    await expect(messageArea(page).getByText("较早会话的回答")).toBeVisible();
    await expect(messageArea(page).getByText("上次问的续保问题")).toHaveCount(
      0,
    );
    // 选中会话后面板自动收起，会话栏同步到新会话
    await expect(page.locator(".chat-session-panel")).toHaveCount(0);
    await expect(sessionBarTitle(page)).toHaveText("较早会话");
  });

  test("手动重命名：列表标题更新且提交一次 PATCH", async ({ page }) => {
    const chat = await openWithMock(page, { sessions: [sessionWithHistory()] });

    await openSessionPanel(page);
    await page.getByRole("button", { name: /重命名会话/ }).click();
    const input = page.getByLabel("会话标题");
    await expect(input).toHaveValue("历史续保咨询");

    // 回归：重命名表单不能被会话面板裁切。toBeVisible() 对被 overflow 裁切的元素仍会
    // 报可见，因此直接断言保存/取消按钮落在面板边界内。
    const panelBox = await page.locator(".chat-session-panel").boundingBox();
    const panelBottom = panelBox!.y + panelBox!.height;
    for (const name of ["保存", "取消"]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      expect(box, `${name} 按钮应有布局盒`).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(panelBottom + 1);
    }

    await input.fill("续保案件 A");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.locator(".chat-session-item__name")).toHaveText(
      "续保案件 A",
    );
    await expect(sessionBarTitle(page)).toHaveText("续保案件 A");
    expect(chat.renameCalls).toEqual([
      { sessionId: "session-history", title: "续保案件 A" },
    ]);
  });

  test("空标题被本地校验拒绝且不提交请求", async ({ page }) => {
    const chat = await openWithMock(page, { sessions: [sessionWithHistory()] });

    await openSessionPanel(page);
    await page.getByRole("button", { name: /重命名会话/ }).click();
    await page.getByLabel("会话标题").fill("   ");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("会话标题不能为空")).toBeVisible();
    expect(chat.renameCalls).toHaveLength(0);
    // 原标题保留在输入框中，未被清空
    await expect(page.getByLabel("会话标题")).toHaveValue("   ");
  });

  test("重命名失败：显示通用提示并保留原标题", async ({ page }) => {
    const chat = await openWithMock(page, { sessions: [sessionWithHistory()] });
    chat.failRename(true);

    await openSessionPanel(page);
    await page.getByRole("button", { name: /重命名会话/ }).click();
    await page.getByLabel("会话标题").fill("新标题");
    await page.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("重命名失败，请稍后重试")).toBeVisible();
    await page.getByRole("button", { name: "取消" }).click();
    await expect(page.locator(".chat-session-item__name")).toHaveText(
      "历史续保咨询",
    );
    await expect(sessionBarTitle(page)).toHaveText("历史续保咨询");
  });

  test("刷新页面：加载历史列表并默认打开最近更新的会话", async ({ page }) => {
    await openWithMock(page, { sessions: [sessionWithHistory()] });

    await expect(messageArea(page).getByText("上次问的续保问题")).toBeVisible();
    await expect(messageArea(page).getByText("上次的回答")).toBeVisible();

    await page.reload();

    // 欢迎消息 + 历史问答
    await expect(page.locator(".chat-message")).toHaveCount(3);
    await expect(messageArea(page).getByText("上次问的续保问题")).toBeVisible();
    await expect(messageArea(page).getByText("上次的回答")).toBeVisible();
  });

  test("活动 run 期间禁止新建、切换与重命名会话", async ({ page }) => {
    const chat = await openWithMock(page, {
      sessions: [
        sessionWithHistory(),
        {
          sessionId: "session-other",
          title: "另一个会话",
          titleSource: "manual",
          updatedAt: "2026-09-20T02:00:00.000Z",
        },
      ],
    });
    chat.setRunScript({ pending: true });

    await send(page, "进行中的消息");

    await expect(createSessionButton(page)).toBeDisabled();

    // 面板仍可展开查看，但会话项与重命名入口不可用
    await openSessionPanel(page);
    await expect(
      page.locator(".chat-session-item__select").first(),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /重命名会话/ }).first(),
    ).toBeDisabled();
  });

  test("会话列表加载失败：显示失败与重试，重试成功后展示历史", async ({
    page,
  }) => {
    const chat = await installChatApiMock(page, {
      sessions: [sessionWithHistory()],
    });
    chat.failSessionList(true);
    await page.goto("/");

    await expect(page.locator(".chat-session-bar__error")).toContainText(
      "历史会话加载失败",
    );
    // 失败不误呈现为空状态；空状态文案只在展开的面板内
    await expect(
      page.getByText("还没有历史会话", { exact: false }),
    ).toHaveCount(0);
    // 其余区域仍可用
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();

    chat.failSessionList(false);
    await page.locator(".chat-session-bar__retry").click();

    await expect(sessionBarTitle(page)).toHaveText("历史续保咨询");
    await expect(page.locator(".chat-session-bar__error")).toHaveCount(0);

    // 重试后展开面板可看到会话条目
    await openSessionPanel(page);
    await expect(page.locator(".chat-session-item__name")).toHaveText(
      "历史续保咨询",
    );
  });
});
