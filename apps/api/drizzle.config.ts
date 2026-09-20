import { defineConfig } from "drizzle-kit";

/**
 * Drizzle 迁移配置。
 *
 * 本 change 只建立空业务基线：`drizzle/schema.ts` 不含任何表定义，
 * 因此生成的迁移不包含业务 DDL，只建立迁移版本记录（`__drizzle_migrations`）。
 * 业务表定义属于后续独立 change。
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
