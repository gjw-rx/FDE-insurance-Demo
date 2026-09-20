import { describe, expect, it } from "vitest";
import { resolveIntegrationTarget } from "./database-test-target.js";

/**
 * 集成测试安全护栏测试。
 *
 * 这些用例不需要真实数据库，因此始终运行：护栏本身失效会让破坏性测试连到
 * 非测试库，属于必须守住的安全边界。
 */

describe("集成测试目标护栏", () => {
  it("未设置 DATABASE_TEST_URL 时不执行，且不回退到运行时 DATABASE_URL", () => {
    const result = resolveIntegrationTarget({
      DATABASE_URL:
        "mysql://runtime_user:runtime_password@prod.internal:3306/renewal",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("DATABASE_TEST_URL");
      expect(result.reason).not.toContain("runtime_password");
    }
  });

  it("目标库名不含 test 时拒绝执行破坏性测试", () => {
    const result = resolveIntegrationTarget({
      DATABASE_TEST_URL:
        "mysql://test_user:test_password@prod.internal:3306/renewal",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("DATABASE_TEST_ALLOW_MUTATION");
      expect(result.reason).not.toContain("test_password");
    }
  });

  it("库名包含 test 时接受，并给出脱敏目标摘要", () => {
    const result = resolveIntegrationTarget({
      DATABASE_TEST_URL:
        "mysql://test_user:test_password@mysql.internal:3307/renewal_test",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.describeTarget).toBe(
        "mysql.internal:3307/renewal_test",
      );
      expect(result.target.describeTarget).not.toContain("test_password");
    }
  });

  it("显式允许例外时接受非 test 库名", () => {
    const result = resolveIntegrationTarget({
      DATABASE_TEST_URL:
        "mysql://test_user:test_password@mysql.internal:3306/renewal_it",
      DATABASE_TEST_ALLOW_MUTATION: "true",
    });

    expect(result.ok).toBe(true);
  });

  it("非法连接串被拒绝，且原因不含凭据", () => {
    const result = resolveIntegrationTarget({
      DATABASE_TEST_URL:
        "mysql://test_user:super-secret-password@mysql.internal:0/renewal_test",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain("super-secret-password");
      expect(result.reason).not.toContain("mysql.internal");
    }
  });
});
