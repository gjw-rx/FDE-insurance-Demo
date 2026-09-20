import { useEffect, useRef } from "react";
import type { ChatSessionSummary } from "@renewal/contracts";
import {
  ChevronDownIcon,
  CloseIcon,
  ListIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
} from "../../shared/ui/icons";
import { formatRelativeTime } from "./session-list";

/**
 * 会话栏与会话面板。
 *
 * 按设计稿 `designs/insurance-assistant.html` 实现：对话区顶部一条会话栏展示当前
 * 会话标题与更新时间，左侧图标展开「所有会话」面板查看全部历史会话。纯展示组件，
 * 异步与竞态处理集中在 `chat-workspace.tsx`。
 *
 * 与设计稿的两处有意差异：
 * - 面板内不提供「搜索会话」输入框（会话搜索属于本需求非目标）。
 * - 不渲染设计稿中与会话列表图标功能重叠的「最近会话」按钮，并在会话项上补充
 *   重命名入口（设计稿未包含该操作，但重命名是已确认需求）。
 */

export interface ChatSessionsProps {
  readonly sessions: readonly ChatSessionSummary[];
  readonly currentSessionId: string | null;
  readonly status: "loading" | "ready" | "error";
  /** 列表加载/新建失败提示；空串表示无错误。 */
  readonly error: string;
  /** 重命名校验或请求失败提示；空串表示无错误。 */
  readonly renameError: string;
  /** 活动 run 期间禁用新建、切换与重命名。 */
  readonly disabled: boolean;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** 会话面板是否展开。 */
  readonly open: boolean;
  /** 正在重命名的会话与草稿；null 表示没有进行中的重命名。 */
  readonly editing: {
    readonly sessionId: string;
    readonly value: string;
  } | null;
  readonly onTogglePanel: () => void;
  readonly onClosePanel: () => void;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
  readonly onCreate: () => void;
  readonly onSelect: (sessionId: string) => void;
  readonly onStartRename: (sessionId: string) => void;
  readonly onCancelRename: () => void;
  readonly onRenameDraftChange: (value: string) => void;
  readonly onSubmitRename: () => void;
}

const PANEL_ID = "chat-session-panel";

export function ChatSessions({
  sessions,
  currentSessionId,
  status,
  error,
  renameError,
  disabled,
  hasMore,
  loadingMore,
  open,
  editing,
  onTogglePanel,
  onClosePanel,
  onRetry,
  onLoadMore,
  onCreate,
  onSelect,
  onStartRename,
  onCancelRename,
  onRenameDraftChange,
  onSubmitRename,
}: ChatSessionsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const current =
    sessions.find((session) => session.sessionId === currentSessionId) ?? null;

  // 面板展开时支持 Escape 关闭与点击外部关闭；不锁定页面滚动（非模态浮层）。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClosePanel();
    };
    const onPointerDown = (event: MouseEvent): void => {
      const container = containerRef.current;
      if (container === null) return;
      if (!container.contains(event.target as Node)) onClosePanel();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClosePanel]);

  return (
    <div className="chat-session-nav" ref={containerRef}>
      <div className="chat-session-bar">
        <button
          type="button"
          className="chat-session-bar__toggle"
          onClick={onTogglePanel}
          aria-expanded={open}
          aria-controls={PANEL_ID}
          aria-label={open ? "收起会话列表" : "展开会话列表"}
        >
          <ListIcon className="chat-session-bar__toggle-icon" />
        </button>

        <div className="chat-session-bar__current">
          <div className="chat-session-bar__title-row">
            <span className="chat-session-bar__title">
              {current?.title ?? "未选择会话"}
            </span>
            <ChevronDownIcon className="chat-session-bar__caret" />
          </div>
          {status === "error" ? (
            // 列表失败状态必须在会话栏可见：否则折叠面板会把它隐藏起来。
            <span className="chat-session-bar__error" role="status">
              <span>{error}</span>
              <button
                type="button"
                className="chat-session-bar__retry"
                onClick={onRetry}
              >
                重试
              </button>
            </span>
          ) : (
            <span className="chat-session-bar__time">
              {current === null
                ? "点击「新会话」开始对话"
                : `${formatRelativeTime(current.updatedAt)}更新`}
            </span>
          )}
        </div>

        <button
          type="button"
          className="chat-session-bar__create"
          onClick={onCreate}
          disabled={disabled}
        >
          <PlusIcon className="chat-session-bar__create-icon" />
          新会话
        </button>
      </div>

      {open ? (
        <div
          className="chat-session-panel"
          id={PANEL_ID}
          role="dialog"
          aria-label="所有会话"
        >
          <div className="chat-session-panel__head">
            <h2 className="chat-session-panel__title">所有会话</h2>
            <button
              type="button"
              className="chat-session-panel__close"
              onClick={onClosePanel}
              aria-label="关闭会话面板"
            >
              <CloseIcon className="chat-session-panel__close-icon" />
            </button>
          </div>

          <div className="chat-session-panel__group">
            <span>最近</span>
            <span className="chat-session-panel__count">
              {sessions.length} 个会话
            </span>
          </div>

          {status === "loading" ? (
            <p className="chat-session-panel__hint" role="status">
              正在加载历史会话…
            </p>
          ) : null}

          {error ? (
            <div className="chat-session-panel__error" role="status">
              <span>{error}</span>
              <button
                type="button"
                className="chat-session-panel__retry"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          ) : null}

          {status === "ready" && sessions.length === 0 ? (
            <p className="chat-session-panel__hint" role="status">
              还没有历史会话，点击「新会话」开始对话。
            </p>
          ) : null}

          {sessions.length > 0 ? (
            <ul className="chat-session-panel__list">
              {sessions.map((session) => {
                const isCurrent = session.sessionId === currentSessionId;
                const isEditing = editing?.sessionId === session.sessionId;
                return (
                  <li
                    key={session.sessionId}
                    className={
                      isCurrent
                        ? "chat-session-item chat-session-item--current"
                        : "chat-session-item"
                    }
                  >
                    {isEditing ? (
                      <form
                        className="chat-session-item__rename-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          onSubmitRename();
                        }}
                      >
                        <label
                          className="chat-session-item__rename-label"
                          htmlFor={`rename-${session.sessionId}`}
                        >
                          会话标题
                        </label>
                        <input
                          id={`rename-${session.sessionId}`}
                          className="chat-session-item__rename-input"
                          value={editing.value}
                          onChange={(event) =>
                            onRenameDraftChange(event.target.value)
                          }
                          autoFocus
                        />
                        <div className="chat-session-item__rename-actions">
                          <button
                            type="submit"
                            className="chat-session-item__rename-save"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            className="chat-session-item__rename-cancel"
                            onClick={onCancelRename}
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="chat-session-item__select"
                          onClick={() => onSelect(session.sessionId)}
                          disabled={disabled}
                          aria-current={isCurrent ? "true" : undefined}
                        >
                          <MessageSquareIcon className="chat-session-item__icon" />
                          <span className="chat-session-item__name">
                            {session.title}
                          </span>
                          <time className="chat-session-item__time">
                            {formatRelativeTime(session.updatedAt)}
                          </time>
                        </button>
                        <button
                          type="button"
                          className="chat-session-item__rename"
                          onClick={() => onStartRename(session.sessionId)}
                          disabled={disabled}
                          aria-label={`重命名会话「${session.title}」`}
                        >
                          <PencilIcon className="chat-session-item__rename-icon" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {hasMore ? (
            <button
              type="button"
              className="chat-session-panel__more"
              onClick={onLoadMore}
              disabled={disabled || loadingMore}
            >
              {loadingMore ? "正在加载…" : "加载更多"}
            </button>
          ) : null}

          {renameError ? (
            <p className="chat-session-panel__rename-error" role="status">
              {renameError}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
