import { beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import type { DatabaseConfig } from "../../src/platform/config/database_config.js";
import { createMySqlPool } from "../../src/platform/database/mysql_database.js";
import { resolveIntegrationTarget } from "../support/database_test_target.js";
import { migrateTestEnv } from "../support/migrate_test_env.js";
import { runMigrate } from "../support/migrate_command_runner.js";
import { readCell } from "../support/mysql_row.js";

/**
 * 会话业务表结构集成测试（需要真实数据库）。
 *
 * 验证对象是「已应用到真实 MySQL 的结构」，而不是 schema 源码或迁移文件：
 * 只有查询 `information_schema` 才能证明字段、中文注释、索引与禁用项真的进入了
 * 数据库。结构以 change `persist-chat-sessions-with-mysql` 已 review 的候选 DDL 为准。
 *
 * 未配置 `DATABASE_TEST_URL` 时整个文件跳过并给出原因，不计为通过。
 */

const resolution = resolveIntegrationTarget();
if (!resolution.ok) {
  process.stderr.write(`[integration] 未执行原因：${resolution.reason}\n`);
}

function requireTarget() {
  if (!resolution.ok) {
    throw new Error(`集成测试目标不可用：${resolution.reason}`);
  }
  return resolution.target;
}

/** 字段数量上限（规则：单表少于 30 列）。 */
const MAX_COLUMNS = 30;
/** 索引数量上限（规则：单表少于 5 个索引）。 */
const MAX_INDEXES = 5;

/** 批准版 DDL 的字段类型（列名 → information_schema 的 column_type）。 */
const EXPECTED_COLUMN_TYPES: Record<string, Record<string, string>> = {
  chat_session: {
    session_id: "char(36)",
    title: "varchar(60)",
    title_source: "varchar(20)",
    created_at: "datetime(3)",
    updated_at: "datetime(3)",
    next_message_order: "bigint unsigned",
  },
  chat_message: {
    message_id: "char(36)",
    session_id: "char(36)",
    run_id: "char(36)",
    message_order: "bigint unsigned",
    role: "varchar(16)",
    status: "varchar(20)",
    text: "longtext",
    created_at: "datetime(3)",
  },
  chat_run: {
    run_id: "char(36)",
    session_id: "char(36)",
    agent_name: "varchar(100)",
    status: "varchar(20)",
    snapshot_json: "json",
    created_at: "datetime(3)",
    updated_at: "datetime(3)",
    finished_at: "datetime(3)",
    abort_reason: "varchar(20)",
    error_code: "varchar(80)",
  },
};

/** 批准版 DDL 中允许为 NULL 的字段，其余字段必须 NOT NULL。 */
const EXPECTED_NULLABLE: Record<string, readonly string[]> = {
  chat_message: [],
  chat_run: ["snapshot_json", "finished_at", "abort_reason", "error_code"],
  chat_session: [],
};

/** 批准版 DDL 的索引定义：索引名 → 唯一性与列顺序。 */
const EXPECTED_INDEXES: Record<
  string,
  readonly {
    readonly name: string;
    readonly unique: boolean;
    readonly columns: readonly string[];
  }[]
> = {
  chat_session: [
    { name: "PRIMARY", unique: true, columns: ["session_id"] },
    {
      name: "idx_chat_session_updated",
      unique: false,
      columns: ["updated_at", "session_id"],
    },
  ],
  chat_message: [
    { name: "PRIMARY", unique: true, columns: ["message_id"] },
    {
      name: "uq_chat_message_run_role",
      unique: true,
      columns: ["run_id", "role"],
    },
    {
      name: "idx_chat_message_session_order",
      unique: false,
      columns: ["session_id", "message_order"],
    },
  ],
  chat_run: [
    { name: "PRIMARY", unique: true, columns: ["run_id"] },
    {
      name: "idx_chat_run_session_status",
      unique: false,
      columns: ["session_id", "status"],
    },
    {
      name: "idx_chat_run_status_updated",
      unique: false,
      columns: ["status", "updated_at"],
    },
  ],
};

const TABLE_NAMES = Object.keys(EXPECTED_COLUMN_TYPES);

type PoolWork<T> = (pool: ReturnType<typeof createMySqlPool>) => Promise<T>;

/** 借一个连接池执行查询并在结束时关闭，避免测试泄漏连接。 */
async function withPool<T>(
  config: DatabaseConfig,
  work: PoolWork<T>,
): Promise<T> {
  const pool = createMySqlPool(config);
  try {
    return await work(pool);
  } finally {
    await pool.end();
  }
}

interface ColumnFact {
  readonly name: string;
  readonly columnType: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly comment: string;
}

async function readColumns(
  config: DatabaseConfig,
  table: string,
): Promise<readonly ColumnFact[]> {
  return withPool(config, async (pool) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select column_name as columnName, column_type as columnType, data_type as dataType,
              is_nullable as isNullable, column_comment as columnComment
         from information_schema.columns
        where table_schema = database() and table_name = ?
        order by ordinal_position`,
      [table],
    );
    return rows.map((row) => ({
      name: String(readCell(row, "columnName")),
      columnType: String(readCell(row, "columnType")).toLowerCase(),
      dataType: String(readCell(row, "dataType")).toLowerCase(),
      nullable: String(readCell(row, "isNullable")).toUpperCase() === "YES",
      comment: String(readCell(row, "columnComment")),
    }));
  });
}

interface IndexFact {
  readonly name: string;
  readonly unique: boolean;
  readonly columns: readonly string[];
}

async function readIndexes(
  config: DatabaseConfig,
  table: string,
): Promise<readonly IndexFact[]> {
  return withPool(config, async (pool) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select index_name as indexName, non_unique as nonUnique, column_name as columnName
         from information_schema.statistics
        where table_schema = database() and table_name = ?
        order by index_name, seq_in_index`,
      [table],
    );
    const byIndex = new Map<string, { unique: boolean; columns: string[] }>();
    for (const row of rows) {
      const name = String(readCell(row, "indexName"));
      const entry = byIndex.get(name) ?? {
        unique: Number(readCell(row, "nonUnique")) === 0,
        columns: [],
      };
      entry.columns.push(String(readCell(row, "columnName")));
      byIndex.set(name, entry);
    }
    return [...byIndex.entries()].map(([name, value]) => ({
      name,
      unique: value.unique,
      columns: value.columns,
    }));
  });
}

async function readTableComment(
  config: DatabaseConfig,
  table: string,
): Promise<string> {
  return withPool(config, async (pool) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select table_comment as tableComment
         from information_schema.tables
        where table_schema = database() and table_name = ?`,
      [table],
    );
    return String(readCell(rows[0], "tableComment"));
  });
}

/** 统计指定约束类型的数量（外键、取值校验约束等）。 */
async function countConstraints(
  config: DatabaseConfig,
  constraintType: string,
): Promise<number> {
  return withPool(config, async (pool) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select count(*) as total from information_schema.table_constraints
        where constraint_schema = database() and constraint_type = ?`,
      [constraintType],
    );
    return Number(readCell(rows[0], "total"));
  });
}

/** 统计使用 MySQL ENUM 类型的字段数量。 */
async function countEnumColumns(config: DatabaseConfig): Promise<number> {
  return withPool(config, async (pool) => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `select count(*) as total from information_schema.columns
        where table_schema = database() and data_type = 'enum'`,
    );
    return Number(readCell(rows[0], "total"));
  });
}

describe.skipIf(!resolution.ok)("会话业务表结构（真实数据库）", () => {
  beforeAll(async () => {
    // 结构断言依赖迁移已应用；这里显式执行一次，避免依赖文件执行顺序。
    const result = await runMigrate(migrateTestEnv());
    expect(result.code).toBe(0);
  });

  it("三张业务表均已创建，且字段与索引数量在规则上限内", async () => {
    const config = requireTarget().config;
    for (const table of TABLE_NAMES) {
      const columns = await readColumns(config, table);
      const indexes = await readIndexes(config, table);
      expect(columns.length).toBeGreaterThan(0);
      expect(columns.length).toBeLessThan(MAX_COLUMNS);
      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes.length).toBeLessThan(MAX_INDEXES);
    }
  });

  it("字段名、类型与非空约束与批准版 DDL 一致", async () => {
    const config = requireTarget().config;
    for (const table of TABLE_NAMES) {
      const columns = await readColumns(config, table);
      const expectedTypes = EXPECTED_COLUMN_TYPES[table] ?? {};
      const expectedNullable = EXPECTED_NULLABLE[table] ?? [];

      expect(columns.map((column) => column.name)).toEqual(
        Object.keys(expectedTypes),
      );
      for (const column of columns) {
        expect(column.columnType).toBe(expectedTypes[column.name]);
        expect(column.nullable).toBe(expectedNullable.includes(column.name));
      }
    }
  });

  it("每个字段与每张表都有中文注释", async () => {
    const config = requireTarget().config;
    for (const table of TABLE_NAMES) {
      const tableComment = await readTableComment(config, table);
      expect(tableComment.trim().length).toBeGreaterThan(0);

      const columns = await readColumns(config, table);
      for (const column of columns) {
        expect(
          column.comment.trim().length,
          `${table}.${column.name} 缺少字段注释`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("索引名称、唯一性与列顺序与批准版 DDL 一致", async () => {
    const config = requireTarget().config;
    for (const table of TABLE_NAMES) {
      const indexes = await readIndexes(config, table);
      const expected = EXPECTED_INDEXES[table] ?? [];
      const actual = [...indexes]
        .map((index) => ({
          name: index.name,
          unique: index.unique,
          columns: [...index.columns],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const wanted = [...expected]
        .map((index) => ({
          name: index.name,
          unique: index.unique,
          columns: [...index.columns],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(actual).toEqual(wanted);
    }
  });

  it("结构不使用外键、ENUM 类型与取值校验约束", async () => {
    const config = requireTarget().config;
    await expect(countConstraints(config, "FOREIGN KEY")).resolves.toBe(0);
    await expect(countConstraints(config, "CHECK")).resolves.toBe(0);
    await expect(countEnumColumns(config)).resolves.toBe(0);
  });
});
