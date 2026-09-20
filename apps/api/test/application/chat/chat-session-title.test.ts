import { describe, expect, it } from "vitest";
import { CHAT_SESSION_TITLE_MAX_LENGTH } from "@renewal/contracts";
import {
  deriveTitleFromMessage,
  normalizeTitle,
  truncateTitle,
  validateRenamedTitle,
} from "../../../src/application/chat/chat-session-title.js";

/** 标题规范化单元测试：自动命名与手动重命名共用同一组规则。 */

describe("normalizeTitle", () => {
  it("去除首尾空白并折叠内部连续空白", () => {
    expect(normalizeTitle("  你好    世界  ")).toBe("你好 世界");
  });

  it("把多行消息折叠为单行文本", () => {
    expect(normalizeTitle("第一行\n第二行\t第三行")).toBe(
      "第一行 第二行 第三行",
    );
  });

  it("只有空白时返回 null", () => {
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("\n\t ")).toBeNull();
    expect(normalizeTitle("")).toBeNull();
  });
});

describe("truncateTitle", () => {
  it("未超长时原样返回", () => {
    const input = "续保问题";
    expect(truncateTitle(input)).toBe(input);
  });

  it("超长时按上限确定性截断", () => {
    const input = "啊".repeat(CHAT_SESSION_TITLE_MAX_LENGTH + 5);
    const result = truncateTitle(input);
    expect([...result]).toHaveLength(CHAT_SESSION_TITLE_MAX_LENGTH);
    expect(result).toBe("啊".repeat(CHAT_SESSION_TITLE_MAX_LENGTH));
  });

  it("按码点而非 UTF-16 单元截断，不产生半个字符", () => {
    const input = "😀".repeat(CHAT_SESSION_TITLE_MAX_LENGTH + 10);
    const result = truncateTitle(input);
    expect([...result]).toHaveLength(CHAT_SESSION_TITLE_MAX_LENGTH);
    expect(result).not.toContain("\uFFFD");
    expect(result.includes("\uD83D") && !result.includes("\uD83D\uDE00")).toBe(
      false,
    );
  });
});

describe("deriveTitleFromMessage", () => {
  it("由首条消息生成单行标题", () => {
    expect(deriveTitleFromMessage(" 我的车险\n要续保 ")).toBe(
      "我的车险 要续保",
    );
  });

  it("超长消息被截断到上限", () => {
    const result = deriveTitleFromMessage(
      "险".repeat(CHAT_SESSION_TITLE_MAX_LENGTH + 3),
    );
    expect(result).not.toBeNull();
    expect([...(result ?? "")]).toHaveLength(CHAT_SESSION_TITLE_MAX_LENGTH);
  });

  it("空白消息返回 null，由调用方保持默认标题", () => {
    expect(deriveTitleFromMessage("   \n ")).toBeNull();
  });
});

describe("validateRenamedTitle", () => {
  it("接受合法标题并归一化", () => {
    expect(validateRenamedTitle("  续保咨询  ")).toBe("续保咨询");
  });

  it("拒绝空、纯空白、超长与非字符串输入", () => {
    expect(validateRenamedTitle("")).toBeNull();
    expect(validateRenamedTitle("   ")).toBeNull();
    expect(
      validateRenamedTitle("险".repeat(CHAT_SESSION_TITLE_MAX_LENGTH + 1)),
    ).toBeNull();
    expect(validateRenamedTitle(123)).toBeNull();
    expect(validateRenamedTitle(null)).toBeNull();
    expect(validateRenamedTitle(undefined)).toBeNull();
  });

  it("恰好等于上限时接受", () => {
    const title = "险".repeat(CHAT_SESSION_TITLE_MAX_LENGTH);
    expect(validateRenamedTitle(title)).toBe(title);
  });
});
