/**
 * 输入校验错误。
 *
 * 只承载稳定的 `INVALID_REQUEST` 码与面向用户的脱敏说明；消息不得回显用户输入
 * 内容（标题正文属于用户数据，不能进入错误响应或日志）。
 */
export class ChatRequestError extends Error {
 readonly code = "INVALID_REQUEST" as const;

 constructor(message: string) {
  super(message);
  this.name = "ChatRequestError";
 }
}
