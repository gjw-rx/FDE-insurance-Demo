import type { ChatLogger } from "../../modules/conversation/application/logger.js";

/**
 * JSON 行会话日志实现。
 *
 * 每行一个 JSON 对象，便于部署侧按行采集；只写稳定事件名与标量字段
 * （ID、枚举、计数），调用方无法通过该接口写入标题或消息正文。
 */

/** 日志输出端：与 `process.stdout`/`process.stderr` 结构兼容的最小接口。 */
export interface ChatLogSink {
  write(chunk: string): boolean;
}

export interface JsonLineChatLoggerStreams {
  readonly out: ChatLogSink;
  readonly err: ChatLogSink;
}

/** 创建 JSON 行日志器；info 走 stdout，warn 走 stderr。 */
export function createJsonLineChatLogger(
  streams?: JsonLineChatLoggerStreams,
): ChatLogger {
  const out: ChatLogSink = streams?.out ?? process.stdout;
  const err: ChatLogSink = streams?.err ?? process.stderr;
  const write = (
    target: ChatLogSink,
    event: string,
    fields: Record<string, string | number | boolean> | undefined,
  ): void => {
    target.write(`${JSON.stringify({ event, ...fields })}\n`);
  };
  return {
    info(event, fields): void {
      write(out, event, fields);
    },
    warn(event, fields): void {
      write(err, event, fields);
    },
  };
}
