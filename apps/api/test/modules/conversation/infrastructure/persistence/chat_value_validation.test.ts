import { describe, expect, it } from "vitest";
import { ChatSessionStoreError } from "../../../../../src/modules/conversation/application/errors/store_error.js";
import {
  AGENT_RUN_NON_TERMINAL_STATUSES,
  assertWritableMessageStatus,
  assertWritableRunFinishStatus,
  assertWritableRunStatus,
  assertWritableTitleSource,
  isNonTerminalRunStatus,
  parseRunSnapshot,
  readMessageRole,
  readMessageStatus,
  readRunStatus,
  readTitleSource,
} from "../../../../../src/modules/conversation/infrastructure/persistence/value_validation.js";

/**
 * 受控取值校验测试（不需要数据库）。
 *
 * 覆盖两个方向：写入前拒绝契约外取值（在产生数据库副作用之前），读取到契约外取值时
 * 返回稳定的存储不可用错误而不是把未知取值透传出去。
 */

/** 模拟「库中被人工写入或旧版本遗留」的取值。 */
const UNKNOWN_VALUE = "not-a-contract-value";

describe("受控取值写入校验", () => {
  it("拒绝契约外的标题来源、消息状态与 run 状态", () => {
    expect(() => assertWritableTitleSource(UNKNOWN_VALUE)).toThrow(
      /取值不在契约内/,
    );
    expect(() => assertWritableMessageStatus(UNKNOWN_VALUE)).toThrow(
      /取值不在契约内/,
    );
    expect(() => assertWritableRunStatus(UNKNOWN_VALUE)).toThrow(
      /取值不在契约内/,
    );
    expect(() => assertWritableRunFinishStatus("running")).toThrow(
      /取值不在契约内/,
    );
  });

  it("接受契约内取值", () => {
    expect(() => assertWritableTitleSource("manual")).not.toThrow();
    expect(() => assertWritableMessageStatus("streaming")).not.toThrow();
    expect(() => assertWritableRunStatus("accepted")).not.toThrow();
    expect(() => assertWritableRunFinishStatus("aborted")).not.toThrow();
  });
});

describe("受控取值读取校验", () => {
  it("读取契约外取值时返回稳定的存储不可用错误", () => {
    for (const read of [
      () => readTitleSource(UNKNOWN_VALUE),
      () => readMessageRole(UNKNOWN_VALUE),
      () => readMessageStatus(UNKNOWN_VALUE),
      () => readRunStatus(UNKNOWN_VALUE),
    ]) {
      expect(read).toThrow(ChatSessionStoreError);
      expect(read).toThrowError(
        expect.objectContaining({ code: "CHAT_SESSION_STORE_UNAVAILABLE" }),
      );
    }
  });

  it("错误消息只包含字段名，不回显库中取值", () => {
    try {
      readMessageStatus(UNKNOWN_VALUE);
      throw new Error("应当抛出错误");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatSessionStoreError);
      expect((error as Error).message).not.toContain(UNKNOWN_VALUE);
    }
  });

  it("读取契约内取值原样返回", () => {
    expect(readTitleSource("first-message")).toBe("first-message");
    expect(readMessageRole("assistant")).toBe("assistant");
    expect(readMessageStatus("send-failed")).toBe("send-failed");
    expect(readRunStatus("aborted")).toBe("aborted");
  });
});

describe("run 状态集合", () => {
  it("非终态集合是终态集合的补集", () => {
    expect([...AGENT_RUN_NON_TERMINAL_STATUSES]).toEqual([
      "accepted",
      "running",
    ]);
    expect(isNonTerminalRunStatus("accepted")).toBe(true);
    expect(isNonTerminalRunStatus("running")).toBe(true);
    for (const terminal of ["completed", "failed", "aborted"]) {
      expect(isNonTerminalRunStatus(terminal)).toBe(false);
    }
    expect(isNonTerminalRunStatus(UNKNOWN_VALUE)).toBe(false);
  });
});

describe("Agent 快照解析", () => {
  const validSnapshot = {
    agentName: "insurance-agent",
    sessionId: "session-1",
    runId: "run-1",
    status: "accepted",
    createdAt: "2026-09-20T00:00:00.000Z",
  };

  it("缺省快照返回 undefined", () => {
    expect(parseRunSnapshot(null)).toBeUndefined();
    expect(parseRunSnapshot(undefined)).toBeUndefined();
  });

  it("解析合法快照，并保留可选字段", () => {
    expect(parseRunSnapshot(validSnapshot)).toEqual(validSnapshot);
    expect(
      parseRunSnapshot({
        ...validSnapshot,
        status: "aborted",
        finishedAt: "2026-09-20T00:00:05.000Z",
        abortReason: "timeout",
      }),
    ).toMatchObject({ status: "aborted", abortReason: "timeout" });
  });

  it("拒绝结构不完整或取值非法的快照", () => {
    expect(() => parseRunSnapshot({})).toThrow(ChatSessionStoreError);
    expect(() =>
      parseRunSnapshot({ ...validSnapshot, status: UNKNOWN_VALUE }),
    ).toThrow(ChatSessionStoreError);
    expect(() =>
      parseRunSnapshot({ ...validSnapshot, abortReason: UNKNOWN_VALUE }),
    ).toThrow(ChatSessionStoreError);
    expect(() => parseRunSnapshot("not-json")).toThrow(ChatSessionStoreError);
  });
});
