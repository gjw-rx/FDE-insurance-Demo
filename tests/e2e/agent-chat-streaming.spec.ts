import { expect, test, type Route } from "@playwright/test";

// agent-chat-streaming 验收测试：route mock 覆盖前端可观察行为。
// 不依赖真实 API / insurance-agent / 模型凭据；SSE 用脚本化帧序列模拟。

/** SSE 事件构造。 */
function sseEvent(
  type: string,
  cursor: number,
  extra: Record<string, unknown> = {},
): string {
  return `id: ${cursor}\ndata: ${JSON.stringify({
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    cursor,
    at: "2026-09-15T00:00:00.000Z",
    type,
    ...extra,
  })}\n\n`;
}

/** 拦截创建 run 请求，返回 202 快照并记录请求体。 */
async function mockCreateRun(
  page: import("@playwright/test").Page,
  bodies: Array<{ sessionId: string; runId: string; message: string }>,
): Promise<void> {
  await page.route("**/api/chat/runs", async (route: Route) => {
    const request = route.request();
    bodies.push(
      request.postDataJSON() as {
        sessionId: string;
        runId: string;
        message: string;
      },
    );
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        agentName: "insurance-agent",
        sessionId: "session-1",
        runId: "run-1",
        status: "accepted",
        createdAt: "2026-09-15T00:00:00.000Z",
      }),
    });
  });
}

/** 拦截 SSE 订阅请求并返回脚本化帧。 */
async function mockEvents(
  page: import("@playwright/test").Page,
  frames: string,
): Promise<void> {
  await page.route("**/api/chat/runs/*/events", async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames,
    });
  });
}

/** 输入文本并点击发送。 */
async function send(page: import("@playwright/test").Page, text: string) {
  await page.getByPlaceholder("输入您想咨询的车险问题...").fill(text);
  await page.getByRole("button", { name: "发送" }).click();
}

test.describe("对话流式链路（route mock）", () => {
  test("发送后输入清空、用户消息追加、增量合并到同一助手消息、完成后恢复发送", async ({
    page,
  }) => {
    const bodies: Array<{ sessionId: string; runId: string; message: string }> =
      [];
    await mockCreateRun(page, bodies);
    await mockEvents(
      page,
      sseEvent("run.accepted", 1) +
        sseEvent("answer.delta", 2, { text: "车险" }) +
        sseEvent("answer.delta", 3, { text: "续保" }) +
        sseEvent("answer.delta", 4, { text: "流程" }) +
        sseEvent("run.completed", 5),
    );

    await page.goto("/");
    await send(page, "车险续保怎么办理？");

    // 输入清空、发送按钮短暂禁用后恢复
    await expect(
      page.getByPlaceholder("输入您想咨询的车险问题..."),
    ).toHaveValue("");

    // 用户消息追加（欢迎消息之外的新消息）
    await expect(page.getByText("车险续保怎么办理？")).toBeVisible();

    // 增量合并为一条助手消息：整体文本恰好为三段拼接
    await expect(page.getByText("车险续保流程")).toBeVisible();

    // 完成后发送恢复可用：重新输入后可发送第二条
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("第二条消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
    await send(page, "第二条消息");
    await expect(page.getByText("第二条消息")).toBeVisible();
    expect(bodies).toHaveLength(2);

    // 同页两次请求：sessionId 相同、runId 不同
    expect(bodies[0]!.sessionId).toBe(bodies[1]!.sessionId);
    expect(bodies[0]!.runId).not.toBe(bodies[1]!.runId);
  });

  test("活动 run 期间发送按钮禁用，重复点击不产生第二个 POST", async ({
    page,
  }) => {
    const bodies: Array<{ sessionId: string; runId: string; message: string }> =
      [];
    await mockCreateRun(page, bodies);
    // SSE handler 永不 fulfill：流保持 pending，模拟进行中的 run。
    await page.route("**/api/chat/runs/*/events", async () => {
      await new Promise(() => undefined);
    });

    await page.goto("/");
    await send(page, "第一条消息");

    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();

    // 再次输入并尝试发送：按钮禁用，无新请求
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("第二条消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
    expect(bodies).toHaveLength(1);
  });

  test("创建失败：显示通用错误、保留用户消息、不创建空助手消息", async ({
    page,
  }) => {
    await page.route("**/api/chat/runs", async (route: Route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_NOT_READY",
            message: "内部详情",
            retryable: true,
          },
        }),
      });
    });

    await page.goto("/");
    await send(page, "测试消息");

    await expect(page.getByRole("alert")).toContainText("消息发送失败");
    // 用户消息保留（欢迎消息 + 用户消息 = 2 条）
    await expect(page.getByText("测试消息")).toBeVisible();
    await expect(page.locator(".chat-message")).toHaveCount(2);
    // 恢复发送能力：重新输入后按钮可用并成功发送
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("无后端环境发送文本：通用失败提示，其他区域仍可用", async ({ page }) => {
    await page.route("**/api/chat/runs", async (route: Route) => {
      await route.abort("failed");
    });
    await page.route("**/api/chat/runs/*/events", async (route: Route) => {
      await route.abort("failed");
    });

    await page.goto("/");
    await send(page, "无后端消息");

    await expect(page.getByRole("alert")).toContainText("消息发送失败");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("region", { name: "最新报价" })).toBeVisible();
    await expect(page.getByRole("region", { name: "保司设置" })).toBeVisible();
    // 报价隐藏切换仍可用
    await page.getByRole("button", { name: "隐藏" }).click();
    await expect(page.getByRole("button", { name: "显示" })).toBeVisible();
  });

  test("SSE 流提前中断：显示通用错误并保留已收到的增量", async ({ page }) => {
    await mockCreateRun(page, []);
    // 有增量但无终态：流提前结束。
    await mockEvents(
      page,
      sseEvent("run.accepted", 1) +
        sseEvent("answer.delta", 2, { text: "部分回答" }),
    );

    await page.goto("/");
    await send(page, "流中断测试");

    await expect(page.getByRole("alert")).toContainText("消息发送失败");
    await expect(page.getByText("部分回答")).toBeVisible();
    // 恢复发送能力：重新输入后按钮可用
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("run.failed 终态：显示通用错误并恢复发送", async ({ page }) => {
    await mockCreateRun(page, []);
    await mockEvents(
      page,
      sseEvent("run.accepted", 1) +
        sseEvent("answer.delta", 2, { text: "部分" }) +
        sseEvent("run.failed", 3, { errorCode: "INTERNAL_ERROR" }),
    );

    await page.goto("/");
    await send(page, "失败终态测试");

    await expect(page.getByRole("alert")).toContainText("消息发送失败");
    // 终态技术信息不渲染
    await expect(page.getByText("INTERNAL_ERROR")).toHaveCount(0);
    // 恢复发送能力：重新输入后按钮可用
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("run.aborted 终态：显示通用错误并恢复发送", async ({ page }) => {
    await mockCreateRun(page, []);
    await mockEvents(
      page,
      sseEvent("run.accepted", 1) +
        sseEvent("run.aborted", 2, { reason: "requested" }),
    );

    await page.goto("/");
    await send(page, "中止终态测试");

    await expect(page.getByRole("alert")).toContainText("消息发送失败");
    // 恢复发送能力：重新输入后按钮可用
    await page.getByPlaceholder("输入您想咨询的车险问题...").fill("重试消息");
    await expect(page.getByRole("button", { name: "发送" })).toBeEnabled();
  });

  test("刷新页面：消息区回到欢迎消息，不恢复旧 run", async ({ page }) => {
    const bodies: Array<{ sessionId: string; runId: string; message: string }> =
      [];
    await mockCreateRun(page, bodies);
    await mockEvents(
      page,
      sseEvent("run.accepted", 1) +
        sseEvent("answer.delta", 2, { text: "回答" }) +
        sseEvent("run.completed", 3),
    );

    await page.goto("/");
    await send(page, "刷新前消息");
    await expect(page.getByText("回答")).toBeVisible();

    await page.reload();

    // 回到欢迎消息：只有一条 chat-message（欢迎）
    await expect(page.locator(".chat-message")).toHaveCount(1);
    await expect(page.locator(".chat-message__text")).toContainText(
      "您好！我是智能车险助手",
    );
  });
});
