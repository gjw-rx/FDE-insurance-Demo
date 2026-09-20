/**
 * 会话链路的可观测性端口。
 *
 * 只接受稳定事件名与非敏感字段（ID、枚举、计数）。标题与消息正文属于用户内容，
 * 不允许进入日志，因此字段类型被限制为标量，实现也不需要序列化嵌套对象。
 */
export type ChatLogFieldValue = string | number | boolean;

export interface ChatLogger {
  info(event: string, fields?: Record<string, ChatLogFieldValue>): void;
  warn(event: string, fields?: Record<string, ChatLogFieldValue>): void;
}

/** 默认实现：不输出。测试与嵌入式调用可显式注入真实实现。 */
export const silentChatLogger: ChatLogger = {
  info(): void {
    // 默认静默。
  },
  warn(): void {
    // 默认静默。
  },
};
