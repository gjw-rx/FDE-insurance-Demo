/**
 * 配置错误。
 *
 * 只携带出错的字段路径与规则说明，不携带任何配置值，因此可以安全地出现在
 * 启动失败日志中：数据库连接地址、用户名和密码不会通过该错误泄露。
 */
export type ApiConfigErrorCode = "config-invalid";

export class ApiConfigError extends Error {
  readonly code: ApiConfigErrorCode;
  readonly field: string;

  constructor(code: ApiConfigErrorCode, field: string, message: string) {
    super(message);
    this.name = "ApiConfigError";
    this.code = code;
    this.field = field;
  }
}
