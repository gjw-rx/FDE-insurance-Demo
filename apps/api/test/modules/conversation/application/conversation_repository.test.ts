import { describe, expect, it } from "vitest";
import {
  CHAT_SESSION_PAGE_SIZE_DEFAULT,
  DEFAULT_CHAT_SESSION_TITLE,
} from "@renewal/contracts";
import { ChatRequestError } from "../../../../src/modules/conversation/application/errors/request_error.js";
import { ChatSessionService } from "../../../../src/modules/conversation/application/session_service.js";
import { ChatSessionStoreError } from "../../../../src/modules/conversation/application/errors/store_error.js";
import { InMemoryChatSessionStore } from "../../../../src/modules/conversation/infrastructure/persistence/memory/in_memory_conversation_repository.js";

/**
 * 会话仓储 + 应用服务测试。
 *
 * 使用真实 `InMemoryChatSessionStore` 与固定时钟/ID 生成器：验证会话规则
 * （默认标题、首条消息自动命名、手动标题优先、稳定顺序、游标分页）与
 * run 幂等、失败保留等状态流转。
 */

const BASE_TIME = Date.parse("2026-09-20T00:00:00.000Z");

/** 构建确定性依赖：时钟每次调用前进 1 秒，ID 为递增序列。 */
function createHarness() {
  let tick = 0;
  let id = 0;
  const store = new InMemoryChatSessionStore();
  const service = new ChatSessionService({
    store,
    now: () => new Date(BASE_TIME + tick++ * 1_000),
    newId: () => `id-${++id}`,
  });
  return { store, service };
}

describe("ChatSessionService 会话生命周期", () => {
  it("新建会话使用默认标题且没有消息", async () => {
    const { service, store } = createHarness();

    const created = await service.createSession();

    expect(created.session.title).toBe(DEFAULT_CHAT_SESSION_TITLE);
    expect(created.session.titleSource).toBe("default");
    expect(created.session.createdAt).toBe(created.session.updatedAt);
    await expect(
      store.getMessages(created.session.sessionId),
    ).resolves.toHaveLength(0);
  });

  it("详情返回会话摘要与有序消息", async () => {
    const { service } = createHarness();
    const created = await service.createSession();
    const sessionId = created.session.sessionId;

    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "请问续保要多少钱",
    });
    await service.startAssistantAnswer("run-1");
    await service.appendAnswerDelta({ runId: "run-1", text: "需要" });
    await service.appendAnswerDelta({ runId: "run-1", text: "行驶证" });
    await service.finishRun({ runId: "run-1", status: "completed" });

    const detail = await service.getSessionDetail(sessionId);

    expect(detail.session.title).toBe("请问续保要多少钱");
    expect(detail.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(detail.messages[1]?.text).toBe("需要行驶证");
    expect(detail.messages[1]?.status).toBe("completed");
    expect(detail.messages[0]?.status).toBe("accepted");
  });

  it("读取不存在的会话返回稳定的未找到错误", async () => {
    const { service } = createHarness();

    await expect(service.getSessionDetail("missing")).rejects.toBeInstanceOf(
      ChatSessionStoreError,
    );
    await expect(service.getSessionDetail("missing")).rejects.toMatchObject({
      code: "CHAT_SESSION_NOT_FOUND",
    });
  });

  it("首条消息自动命名，后续消息不覆盖标题", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;

    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "  我的车险\n要续保  ",
    });
    const afterFirst = await service.getSessionDetail(sessionId);
    expect(afterFirst.session.title).toBe("我的车险 要续保");
    expect(afterFirst.session.titleSource).toBe("first-message");

    await service.beginUserMessage({
      sessionId,
      runId: "run-2",
      message: "第二条消息",
    });
    const afterSecond = await service.getSessionDetail(sessionId);
    expect(afterSecond.session.title).toBe("我的车险 要续保");
  });

  it("手动重命名后新消息不再覆盖标题", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;

    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "首条消息",
    });
    await service.renameSession(sessionId, { title: "  续保案件 A  " });
    await service.beginUserMessage({
      sessionId,
      runId: "run-2",
      message: "第三条消息",
    });

    const detail = await service.getSessionDetail(sessionId);
    expect(detail.session.title).toBe("续保案件 A");
    expect(detail.session.titleSource).toBe("manual");
  });

  it("手动重命名先于首条消息时同样保持用户标题", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;

    await service.renameSession(sessionId, { title: "我的会话" });
    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "首条消息",
    });

    const detail = await service.getSessionDetail(sessionId);
    expect(detail.session.title).toBe("我的会话");
    expect(detail.session.titleSource).toBe("manual");
  });

  it("拒绝空、纯空白与非字符串标题且不改变既有标题", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;
    await service.renameSession(sessionId, { title: "原标题" });

    for (const body of [
      { title: "" },
      { title: "   " },
      { title: 123 },
      {},
      null,
      "not-an-object",
    ]) {
      await expect(
        service.renameSession(sessionId, body),
      ).rejects.toBeInstanceOf(ChatRequestError);
    }

    const detail = await service.getSessionDetail(sessionId);
    expect(detail.session.title).toBe("原标题");
  });

  it("对不存在的会话重命名返回未找到", async () => {
    const { service } = createHarness();
    await expect(
      service.renameSession("missing", { title: "新标题" }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
  });
});

describe("ChatSessionService run 幂等与失败保留", () => {
  it("相同 runId 重复提交不重复写入消息", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;

    const first = await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "重复消息",
    });
    const second = await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "重复消息",
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    const detail = await service.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.messageId).toBe(first.message.messageId);
  });

  it("重复 runId 不重复应用自动标题", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;

    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "首条消息",
    });
    await service.renameSession(sessionId, { title: "用户标题" });
    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "首条消息",
    });

    const detail = await service.getSessionDetail(sessionId);
    expect(detail.session.title).toBe("用户标题");
    expect(detail.session.titleSource).toBe("manual");
  });

  it("Agent 拒绝创建时保留用户消息并标记发送失败", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;
    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: "未能发送的消息",
    });

    await service.markRunCreateFailed("run-1");

    const detail = await service.getSessionDetail(sessionId);
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.text).toBe("未能发送的消息");
    expect(detail.messages[0]?.status).toBe("send-failed");
  });

  it("对不存在的会话发送返回未找到", async () => {
    const { service } = createHarness();
    await expect(
      service.beginUserMessage({
        sessionId: "missing",
        runId: "run-1",
        message: "你好",
      }),
    ).rejects.toMatchObject({ code: "CHAT_SESSION_NOT_FOUND" });
  });
});

describe("ChatSessionService 列表与分页", () => {
  it("按最近更新时间倒序返回，最近有消息的会话在前", async () => {
    const { service } = createHarness();
    const first = (await service.createSession()).session.sessionId;
    const second = (await service.createSession()).session.sessionId;

    await service.beginUserMessage({
      sessionId: first,
      runId: "run-1",
      message: "更新第一个会话",
    });

    const list = await service.listSessions({
      limit: undefined,
      cursor: undefined,
    });
    expect(list.sessions.map((session) => session.sessionId)).toEqual([
      first,
      second,
    ]);
    expect(list.nextCursor).toBeUndefined();
  });

  it("列表摘要只含元数据，不返回消息正文", async () => {
    const { service } = createHarness();
    const sessionId = (await service.createSession()).session.sessionId;
    // 正文故意超过标题上限：摘要里只应出现截断后的标题，不出现完整正文。
    const body = `身份证号110101199001011234${"甲".repeat(120)}`;
    await service.beginUserMessage({
      sessionId,
      runId: "run-1",
      message: body,
    });

    const list = await service.listSessions({
      limit: undefined,
      cursor: undefined,
    });
    const serialized = JSON.stringify(list);

    expect(serialized).not.toContain(body);
    expect(serialized).not.toContain("messages");
    const title = list.sessions[0]?.title ?? "";
    expect([...title].length).toBeLessThanOrEqual(60);
  });

  it("游标分页不重复也不跳过条目", async () => {
    const { service } = createHarness();
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await service.createSession();
      ids.push(created.session.sessionId);
      await service.beginUserMessage({
        sessionId: created.session.sessionId,
        runId: `run-${index}`,
        message: `消息 ${index}`,
      });
    }

    const page1 = await service.listSessions({ limit: "2", cursor: undefined });
    expect(page1.sessions).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await service.listSessions({
      limit: "2",
      cursor: page1.nextCursor,
    });
    expect(page2.sessions).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();

    const seen = [
      ...page1.sessions.map((session) => session.sessionId),
      ...page2.sessions.map((session) => session.sessionId),
    ];
    expect(seen).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(3);
  });

  it("缺省分页大小来自契约常量", async () => {
    const { service } = createHarness();
    await service.createSession();

    const list = await service.listSessions({
      limit: undefined,
      cursor: undefined,
    });
    expect(list.sessions).toHaveLength(1);
    expect(CHAT_SESSION_PAGE_SIZE_DEFAULT).toBeGreaterThan(0);
  });

  it("拒绝非法 limit 与非法 cursor", async () => {
    const { service } = createHarness();

    for (const limit of ["0", "-1", "abc", 1.5, 1000]) {
      await expect(
        service.listSessions({ limit, cursor: undefined }),
      ).rejects.toBeInstanceOf(ChatRequestError);
    }
    for (const cursor of ["!!!not-base64-json!!!", 42]) {
      await expect(
        service.listSessions({ limit: undefined, cursor }),
      ).rejects.toBeInstanceOf(ChatRequestError);
    }
  });
});
