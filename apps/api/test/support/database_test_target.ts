import {
  describeDatabaseTarget,
  loadDatabaseConfig,
  type DatabaseConfig,
} from "../../src/platform/config/database_config.js";

/**
 * 集成测试目标解析与安全护栏。
 *
 * 真实数据库测试会创建迁移记录表并执行写操作，因此必须能证明目标是非生产库：
 * - 只读取 `DATABASE_TEST_URL`，绝不回退到运行时 `DATABASE_URL`，避免误连运行库；
 * - 复用与运行时同一套配置校验，不绕过 TLS 与连接边界约束；
 * - 目标库名必须包含 `test`，否则必须显式设置 `DATABASE_TEST_ALLOW_MUTATION=true`。
 *
 * 护栏不满足时返回原因而不抛错，使上层把用例标记为「未执行」而不是「通过」。
 */

export interface IntegrationTarget {
  readonly config: DatabaseConfig;
  /** 脱敏目标摘要（host:port/database），可安全写入测试计划与证据。 */
  readonly describeTarget: string;
}

export type IntegrationTargetResolution =
  | { readonly ok: true; readonly target: IntegrationTarget }
  | { readonly ok: false; readonly reason: string };

/** 运行时数据库变量名：集成测试禁止复用它。 */
const RUNTIME_URL_VAR = "DATABASE_URL";
const TEST_URL_VAR = "DATABASE_TEST_URL";
const ALLOW_MUTATION_VAR = "DATABASE_TEST_ALLOW_MUTATION";

export function resolveIntegrationTarget(
  env: NodeJS.ProcessEnv = process.env,
): IntegrationTargetResolution {
  const testUrl = env[TEST_URL_VAR]?.trim();
  if (testUrl === undefined || testUrl === "") {
    return {
      ok: false,
      reason: `未设置 ${TEST_URL_VAR}（集成测试不复用 ${RUNTIME_URL_VAR}）：真实数据库用例未执行`,
    };
  }

  let config: DatabaseConfig;
  try {
    // 复用运行时同款校验：结构、TLS 模式与连接边界问题都在此被拒绝。
    config = loadDatabaseConfig({
      env: { ...env, [RUNTIME_URL_VAR]: testUrl },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知配置错误";
    // 配置错误本身不回显连接地址、用户名或密码。
    return { ok: false, reason: `${TEST_URL_VAR} 校验失败：${message}` };
  }

  const databaseName = config.target.database.toLowerCase();
  const mutationAllowed =
    env[ALLOW_MUTATION_VAR]?.trim().toLowerCase() === "true";
  if (!databaseName.includes("test") && !mutationAllowed) {
    return {
      ok: false,
      reason: `目标库名不包含 test 且未设置 ${ALLOW_MUTATION_VAR}=true，拒绝执行破坏性测试`,
    };
  }

  return {
    ok: true,
    target: {
      config,
      describeTarget: describeDatabaseTarget(config.target),
    },
  };
}
