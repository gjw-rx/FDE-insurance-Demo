import type { RowDataPacket } from "mysql2/promise";

/**
 * 真实数据库测试的行读取辅助。
 *
 * mysql2 的行类型带有索引签名，直接取值会泄漏 `any`。这里统一收窄为 `unknown`，
 * 由调用方的断言决定期望类型。
 */
export function readCell(
 row: RowDataPacket | undefined,
 column: string,
): unknown {
 if (row === undefined) return undefined;
 const value: unknown = row[column];
 return value;
}
