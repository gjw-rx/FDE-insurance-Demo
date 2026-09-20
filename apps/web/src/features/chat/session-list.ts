import type { ChatSessionSummary } from "@renewal/contracts";

/**
 * 会话列表的本地合并规则。
 *
 * 与服务端列表排序保持一致（updatedAt 倒序，同一时间戳用 sessionId 倒序），
 * 这样本地插入或更新的条目顺序不会和下一次分页返回的顺序冲突。
 */

/** 与会话列表排序一致的比较器。 */
export function compareSessions(
  a: ChatSessionSummary,
  b: ChatSessionSummary,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? 1 : -1;
  return 0;
}

/** 插入或替换单个会话摘要，并按服务端规则重新排序。 */
export function upsertSessionSummary(
  sessions: readonly ChatSessionSummary[],
  summary: ChatSessionSummary,
): ChatSessionSummary[] {
  const others = sessions.filter(
    (session) => session.sessionId !== summary.sessionId,
  );
  return [...others, summary].sort(compareSessions);
}

/** 追加一页更早的会话，按 sessionId 去重后重新排序。 */
export function mergeSessionPage(
  sessions: readonly ChatSessionSummary[],
  page: readonly ChatSessionSummary[],
): ChatSessionSummary[] {
  const merged = new Map<string, ChatSessionSummary>();
  for (const session of sessions) merged.set(session.sessionId, session);
  for (const session of page) merged.set(session.sessionId, session);
  return [...merged.values()].sort(compareSessions);
}

/**
 * 会话列表与会话栏使用的相对时间文本。
 *
 * 只做展示格式化，不参与排序；`now` 可注入以便测试确定性。
 */
export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "";
  const diffMs = now.getTime() - target.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  // 时钟偏差导致的“未来”时间按“刚刚”处理，不显示负数。
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} 分钟前`;

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (target.getTime() >= startOfToday) {
    return `${Math.floor(diffMs / hour)} 小时前`;
  }
  if (target.getTime() >= startOfToday - day) return "昨天";

  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}
