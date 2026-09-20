import { describe, expect, it } from "vitest";
import type {
  AgentRunEvent,
  ChatMessage,
  ChatSessionSummary,
} from "@renewal/contracts";
import {
  appendUserMessage,
  applyRunEvent,
  assistantMessageKey,
  formatTimestamp,
  isTerminalEvent,
  toMessageViews,
  userMessageKey,
  type ChatMessageView,
} from "../../../src/features/chat/messages";
import {
  compareSessions,
  formatRelativeTime,
  mergeSessionPage,
  upsertSessionSummary,
} from "../../../src/features/chat/session-list";

/**
 * 对话消息合并与列表合并的纯逻辑测试。
 *
 * 这些规则决定「增量是否合并到同一条助手消息」「切换会话后消息是否串台」等
 * 用户可见行为，因此独立于渲染层用单元测试锁定。
 */

const NOW = new Date("2026-09-20T08:30:05.000Z");

/** 事件构造器。 */
function event(
  type: AgentRunEvent["type"],
  cursor: number,
  extra: Record<string, unknown> = {},
): AgentRunEvent {
  return {
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    cursor,
    at: "2026-09-20T00:00:00.000Z",
    type,
    ...extra,
  } as AgentRunEvent;
}

/** 持久消息构造器。 */
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: "message-1",
    sessionId: "session-1",
    runId: "run-1",
    role: "user",
    status: "accepted",
    text: "你好",
    createdAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

/** 会话摘要构造器。 */
function summary(
  overrides: Partial<ChatSessionSummary> = {},
): ChatSessionSummary {
  return {
    sessionId: "session-1",
    title: "新会话",
    titleSource: "default",
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("消息视图转换", () => {
  it("持久消息按顺序转换为视图并保留状态", () => {
    const views = toMessageViews([
      message({ messageId: "m1" }),
      message({
        messageId: "m2",
        role: "assistant",
        status: "completed",
        text: "回答",
      }),
    ]);

    expect(views.map((view) => view.key)).toEqual(["m1", "m2"]);
    expect(views[1]?.status).toBe("completed");
    expect(views[1]?.text).toBe("回答");
  });

  it("时间戳格式化为本地文本", () => {
    expect(formatTimestamp("2026-09-20T00:00:00.000Z")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});

describe("appendUserMessage", () => {
  it("追加带有 runId 派生 key 的用户消息", () => {
    const messages = appendUserMessage([], "run-1", "续保问题", NOW);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.key).toBe(userMessageKey("run-1"));
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.text).toBe("续保问题");
  });
});

describe("applyRunEvent", () => {
  it("首个增量创建助手消息，后续增量追加到同一条", () => {
    let messages: ChatMessageView[] = [];
    messages = applyRunEvent(
      messages,
      "run-1",
      event("answer.delta", 1, { text: "车险" }),
      NOW,
    );
    messages = applyRunEvent(
      messages,
      "run-1",
      event("answer.delta", 2, { text: "续保" }),
      NOW,
    );
    messages = applyRunEvent(
      messages,
      "run-1",
      event("answer.delta", 3, { text: "流程" }),
      NOW,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.key).toBe(assistantMessageKey("run-1"));
    expect(messages[0]?.text).toBe("车险续保流程");
    expect(messages[0]?.status).toBe("streaming");
  });

  it("run.completed 把助手消息置为 completed 且不追加新消息", () => {
    let messages: ChatMessageView[] = [];
    messages = applyRunEvent(
      messages,
      "run-1",
      event("answer.delta", 1, { text: "回答" }),
      NOW,
    );
    messages = applyRunEvent(messages, "run-1", event("run.completed", 2), NOW);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe("completed");
  });

  it("失败与中止终态把助手消息置为 failed", () => {
    for (const terminal of ["run.failed", "run.aborted"] as const) {
      let messages: ChatMessageView[] = [];
      messages = applyRunEvent(
        messages,
        "run-1",
        event("answer.delta", 1, { text: "部分" }),
        NOW,
      );
      messages = applyRunEvent(
        messages,
        "run-1",
        event(
          terminal,
          2,
          terminal === "run.failed"
            ? { errorCode: "INTERNAL_ERROR" }
            : { reason: "requested" },
        ),
        NOW,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0]?.status).toBe("failed");
      // 终态技术信息不进入界面文本
      expect(JSON.stringify(messages)).not.toContain("INTERNAL_ERROR");
      expect(JSON.stringify(messages)).not.toContain("requested");
    }
  });

  it("无增量的失败终态不创建空助手消息", () => {
    const messages = applyRunEvent(
      [],
      "run-1",
      event("run.failed", 1, { errorCode: "INTERNAL_ERROR" }),
      NOW,
    );

    expect(messages).toHaveLength(0);
  });

  it("非终态且非增量的中间事件不改变消息列表", () => {
    const before = appendUserMessage([], "run-1", "你好", NOW);
    const after = applyRunEvent(
      before,
      "run-1",
      event("agent.started", 1),
      NOW,
    );

    expect(after.map((item) => item.key)).toEqual(
      before.map((item) => item.key),
    );
    expect(after[0]?.text).toBe("你好");
  });

  it("不同 run 的增量互不合并，避免会话内消息串台", () => {
    let messages: ChatMessageView[] = [];
    messages = applyRunEvent(
      messages,
      "run-1",
      event("answer.delta", 1, { text: "第一条" }),
      NOW,
    );
    messages = applyRunEvent(
      messages,
      "run-2",
      event("answer.delta", 1, { text: "第二条" }),
      NOW,
    );

    expect(messages).toHaveLength(2);
    expect(messages.map((item) => item.text)).toEqual(["第一条", "第二条"]);
  });
});

describe("isTerminalEvent", () => {
  it("只把三种终态判定为终态", () => {
    expect(isTerminalEvent(event("run.completed", 1))).toBe(true);
    expect(
      isTerminalEvent(event("run.failed", 1, { errorCode: "INTERNAL_ERROR" })),
    ).toBe(true);
    expect(
      isTerminalEvent(event("run.aborted", 1, { reason: "requested" })),
    ).toBe(true);
    expect(isTerminalEvent(event("answer.delta", 1, { text: "x" }))).toBe(
      false,
    );
    expect(isTerminalEvent(event("run.accepted", 1))).toBe(false);
  });
});

describe("会话列表合并", () => {
  it("插入或更新后按最近更新时间倒序", () => {
    const older = summary({
      sessionId: "session-1",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const newer = summary({
      sessionId: "session-2",
      updatedAt: "2026-09-20T01:00:00.000Z",
    });

    expect(
      upsertSessionSummary([older], newer).map((item) => item.sessionId),
    ).toEqual(["session-2", "session-1"]);
  });

  it("更新时间相同时用 sessionId 倒序，保证顺序稳定", () => {
    const a = summary({
      sessionId: "a",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const b = summary({
      sessionId: "b",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });

    expect([a, b].sort(compareSessions).map((item) => item.sessionId)).toEqual([
      "b",
      "a",
    ]);
  });

  it("分页追加不产生重复条目", () => {
    const first = summary({
      sessionId: "session-1",
      updatedAt: "2026-09-20T02:00:00.000Z",
    });
    const second = summary({
      sessionId: "session-2",
      updatedAt: "2026-09-20T01:00:00.000Z",
    });

    const merged = mergeSessionPage([first], [first, second]);

    expect(merged.map((item) => item.sessionId)).toEqual([
      "session-1",
      "session-2",
    ]);
  });

  it("更新已有条目时替换旧摘要而不是保留两份", () => {
    const before = summary({
      title: "新会话",
      updatedAt: "2026-09-20T00:00:00.000Z",
    });
    const after = summary({
      title: "续保问题",
      titleSource: "first-message",
      updatedAt: "2026-09-20T03:00:00.000Z",
    });

    const merged = upsertSessionSummary([before], after);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe("续保问题");
  });
});

describe("formatRelativeTime", () => {
  // 用本地时间构造基准与样本：相对时间按本地日历天分组，硬编码 UTC 会随运行时时区变化。
  const reference = new Date(2026, 8, 20, 16, 30, 0);
  const at = (hoursAgo: number): string =>
    new Date(
      reference.getFullYear(),
      reference.getMonth(),
      reference.getDate(),
      reference.getHours() - hoursAgo,
      reference.getMinutes(),
      0,
    ).toISOString();
  const yesterday = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() - 1,
    10,
    0,
    0,
  ).toISOString();
  const earlier = new Date(
    reference.getFullYear(),
    reference.getMonth(),
    reference.getDate() - 5,
    10,
    0,
    0,
  ).toISOString();

  it("一分钟内显示「刚刚」", () => {
    expect(
      formatRelativeTime(
        new Date(reference.getTime() - 30_000).toISOString(),
        reference,
      ),
    ).toBe("刚刚");
  });

  it("一小时内显示分钟数", () => {
    expect(
      formatRelativeTime(
        new Date(reference.getTime() - 25 * 60_000).toISOString(),
        reference,
      ),
    ).toBe("25 分钟前");
  });

  it("当天更早显示小时数", () => {
    expect(formatRelativeTime(at(2), reference)).toBe("2 小时前");
  });

  it("前一天显示「昨天」", () => {
    expect(formatRelativeTime(yesterday, reference)).toBe("昨天");
  });

  it("更早显示月-日", () => {
    const target = new Date(earlier);
    const pad = (value: number): string => String(value).padStart(2, "0");
    expect(formatRelativeTime(earlier, reference)).toBe(
      `${pad(target.getMonth() + 1)}-${pad(target.getDate())}`,
    );
  });

  it("时钟偏差导致的未来时间按「刚刚」处理，不出现负数", () => {
    expect(
      formatRelativeTime(
        new Date(reference.getTime() + 60_000).toISOString(),
        reference,
      ),
    ).toBe("刚刚");
  });

  it("非法时间戳返回空串而不是 Invalid Date", () => {
    expect(formatRelativeTime("not-a-date", reference)).toBe("");
  });
});
