/**
 * 集成测试的迁移环境构造。
 *
 * 迁移命令只接受运行时变量 `DATABASE_URL`，而集成测试只允许通过
 * `DATABASE_TEST_URL` 指定目标，因此这里把测试目标映射到迁移进程的入口变量。
 * 该映射只在测试进程内构造，不会写入仓库或日志。
 */
export function migrateTestEnv(): NodeJS.ProcessEnv {
 return {
  ...process.env,
  DATABASE_URL: process.env["DATABASE_TEST_URL"] ?? "",
 };
}
