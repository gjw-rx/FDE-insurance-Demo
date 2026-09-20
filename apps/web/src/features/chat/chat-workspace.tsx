import { useEffect, useRef, useState } from "react";
import {
  CHAT_SESSION_TITLE_MAX_LENGTH,
  type ChatSessionSummary,
} from "@renewal/contracts";
import { createChatRun, streamChatEvents } from "../../shared/api/chat-client";
import {
  ChatSessionClientError,
  createChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
} from "../../shared/api/chat-session-client";
import { ChatPanel } from "./chat-panel";
import { ChatSessions } from "./chat-sessions";
import {
  appendUserMessage,
  applyRunEvent,
  isTerminalEvent,
  toMessageViews,
  type ChatMessageView,
} from "./messages";
import { mergeSessionPage, upsertSessionSummary } from "./session-list";

/**
 * 对话工作台容器。
 *
 * 持有会话列表、当前会话、消息、活动 run 与各类错误状态，把异步与竞态处理集中在这里，
 * 展示组件只接收数据与回调。关键约束：
 * - 活动 run 期间禁止新建、切换会话与重命名，避免消息落到错误的会话。
 * - 切换会话时用请求序号丢弃过期响应，避免旧详情覆盖新选择。
 * - POST 失败保留本地用户消息（不刷新详情），回答终态后才用服务端结果校准消息。
 */

const SEND_ERROR_TEXT = "消息发送失败，请稍后重试";
const LIST_ERROR_TEXT = "历史会话加载失败";
const CREATE_ERROR_TEXT = "新建会话失败，请稍后重试";
const DETAIL_ERROR_TEXT = "会话内容加载失败，请稍后重试";
const RENAME_ERROR_TEXT = "重命名失败，请稍后重试";
const RENAME_EMPTY_TEXT = "会话标题不能为空";
const RENAME_TOO_LONG_TEXT = `会话标题不能超过 ${CHAT_SESSION_TITLE_MAX_LENGTH} 个字符`;

type ListStatus = "loading" | "ready" | "error";
type DetailStatus = "idle" | "loading" | "ready" | "error";

export function ChatWorkspace() {
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listError, setListError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [detailStatus, setDetailStatus] = useState<DetailStatus>("idle");
  const [detailError, setDetailError] = useState("");

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");

  const [editing, setEditing] = useState<{
    readonly sessionId: string;
    readonly value: string;
  } | null>(null);
  const [renameError, setRenameError] = useState("");
  // 会话面板展开状态：选中/新建/重命名完成后自动收起。
  const [panelOpen, setPanelOpen] = useState(false);

  // 渲染期间使用的值不可靠：异步回调统一读 ref，避免闭包读到过期状态。
  const currentSessionIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const detailSeqRef = useRef(0);
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    void bootstrap();
    return () => {
      unmountedRef.current = true;
      abortRef.current?.abort();
    };
    // 只在挂载时执行一次：会话列表由用户操作与 run 终态触发刷新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 记录当前会话（state 与 ref 必须一起更新）。 */
  function setCurrentSession(sessionId: string | null): void {
    currentSessionIdRef.current = sessionId;
    setCurrentSessionId(sessionId);
  }

  /** 首次加载：拉取历史列表，存在会话时默认打开最近更新的一条。 */
  async function bootstrap(): Promise<void> {
    setListStatus("loading");
    setListError("");
    try {
      const page = await listChatSessions({});
      if (unmountedRef.current) return;
      setSessions([...page.sessions]);
      setNextCursor(page.nextCursor ?? null);
      setListStatus("ready");
      const newest = page.sessions[0];
      if (newest !== undefined) await openSession(newest.sessionId);
    } catch {
      if (unmountedRef.current) return;
      setListStatus("error");
      setListError(LIST_ERROR_TEXT);
    }
  }

  /** 打开指定会话；失败时保留原当前会话并提示。 */
  async function openSession(sessionId: string): Promise<void> {
    const seq = detailSeqRef.current + 1;
    detailSeqRef.current = seq;
    setDetailStatus("loading");
    setDetailError("");
    try {
      const detail = await getChatSession(sessionId);
      // 过期响应（用户已选择其他会话）直接丢弃。
      if (seq !== detailSeqRef.current || unmountedRef.current) return;
      setCurrentSession(sessionId);
      setMessages(toMessageViews(detail.messages));
      setDetailStatus("ready");
      setSessions((prev) => upsertSessionSummary(prev, detail.session));
    } catch (error) {
      if (seq !== detailSeqRef.current || unmountedRef.current) return;
      setDetailStatus("error");
      setDetailError(
        error instanceof ChatSessionClientError && error.kind === "not-found"
          ? "该会话已不存在，请选择其他会话"
          : DETAIL_ERROR_TEXT,
      );
    }
  }

  /** 只同步会话摘要（标题可能因首条消息自动命名而变化），不动消息视图。 */
  async function syncSessionSummary(sessionId: string): Promise<void> {
    try {
      const detail = await getChatSession(sessionId);
      if (unmountedRef.current) return;
      setSessions((prev) => upsertSessionSummary(prev, detail.session));
    } catch {
      // 摘要同步失败不影响正在进行的对话。
    }
  }

  /** run 终态后以服务端结果校准消息与摘要。 */
  async function syncSessionDetail(sessionId: string): Promise<void> {
    try {
      const detail = await getChatSession(sessionId);
      // 用户已切换到其他会话时不得覆盖对方视图。
      if (unmountedRef.current || currentSessionIdRef.current !== sessionId) {
        return;
      }
      setMessages(toMessageViews(detail.messages));
      setSessions((prev) => upsertSessionSummary(prev, detail.session));
    } catch {
      // 同步失败保留本地视图：回答已经展示过，不需要二次报错。
    }
  }

  /** 清除活动 run（幂等）。 */
  function clearActiveRun(runId: string): void {
    if (activeRunIdRef.current !== runId) return;
    activeRunIdRef.current = null;
    setActiveRunId(null);
  }

  /** 新建会话并切换过去。 */
  async function handleCreate(): Promise<void> {
    if (activeRunIdRef.current !== null) return;
    setListError("");
    setRenameError("");
    try {
      const created = await createChatSession();
      if (unmountedRef.current) return;
      setSessions((prev) => upsertSessionSummary(prev, created));
      setListStatus("ready");
      // 递增序号使进行中的 openSession 响应过期，避免旧会话详情覆盖新会话、
      // 后续消息被发送到错误的会话。
      detailSeqRef.current += 1;
      setCurrentSession(created.sessionId);
      setMessages([]);
      setDetailStatus("ready");
      setDetailError("");
      setPanelOpen(false);
      setEditing(null);
      setRenameError("");
    } catch {
      if (unmountedRef.current) return;
      setListError(CREATE_ERROR_TEXT);
    }
  }

  /** 加载更早的会话。 */
  async function handleLoadMore(): Promise<void> {
    const cursor = nextCursor;
    if (cursor === null || loadingMore || activeRunIdRef.current !== null)
      return;
    setLoadingMore(true);
    try {
      const page = await listChatSessions({ cursor });
      if (unmountedRef.current) return;
      setSessions((prev) => mergeSessionPage(prev, page.sessions));
      setNextCursor(page.nextCursor ?? null);
    } catch {
      if (unmountedRef.current) return;
      setListError(LIST_ERROR_TEXT);
    } finally {
      setLoadingMore(false);
    }
  }

  function handleSelect(sessionId: string): void {
    if (activeRunIdRef.current !== null) return;
    if (sessionId === currentSessionIdRef.current) {
      // 重复选中当前会话：仅收起面板。
      setPanelOpen(false);
      return;
    }
    setPanelOpen(false);
    setEditing(null);
    setRenameError("");
    void openSession(sessionId);
  }

  function handleStartRename(sessionId: string): void {
    if (activeRunIdRef.current !== null) return;
    const target = sessions.find((session) => session.sessionId === sessionId);
    if (target === undefined) return;
    setRenameError("");
    setEditing({ sessionId, value: target.title });
  }

  async function handleSubmitRename(): Promise<void> {
    const current = editing;
    if (current === null) return;
    const title = current.value.trim();
    if (title.length === 0) {
      setRenameError(RENAME_EMPTY_TEXT);
      return;
    }
    if ([...title].length > CHAT_SESSION_TITLE_MAX_LENGTH) {
      setRenameError(RENAME_TOO_LONG_TEXT);
      return;
    }
    try {
      const updated = await renameChatSession(current.sessionId, title);
      if (unmountedRef.current) return;
      setSessions((prev) => upsertSessionSummary(prev, updated));
      setEditing(null);
      setRenameError("");
    } catch {
      if (unmountedRef.current) return;
      // 不做乐观更新：请求失败时界面仍显示原标题。
      setRenameError(RENAME_ERROR_TEXT);
    }
  }

  /** 提交非空文本：乐观追加用户消息并创建 run。 */
  function handleSubmit(text: string): void {
    const trimmed = text.trim();
    const sessionId = currentSessionIdRef.current;
    if (
      trimmed.length === 0 ||
      sessionId === null ||
      sendingRef.current ||
      activeRunIdRef.current !== null
    ) {
      return;
    }
    sendingRef.current = true;
    setSendError("");

    const runId = crypto.randomUUID();
    setMessages((prev) => appendUserMessage(prev, runId, trimmed, new Date()));
    activeRunIdRef.current = runId;
    setActiveRunId(runId);

    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        await createChatRun(
          { sessionId, runId, message: trimmed },
          { signal: controller.signal },
        );
      } catch {
        // 创建失败：保留本地用户消息，不刷新详情（服务端可能并未保存该消息）。
        if (!controller.signal.aborted) setSendError(SEND_ERROR_TEXT);
        clearActiveRun(runId);
        return;
      } finally {
        sendingRef.current = false;
      }

      // 首条消息会触发服务端自动命名，成功创建后同步列表标题。
      void syncSessionSummary(sessionId);

      try {
        await streamChatEvents(
          runId,
          (event) => {
            if (unmountedRef.current) return;
            setMessages((prev) =>
              applyRunEvent(prev, runId, event, new Date()),
            );
            if (!isTerminalEvent(event)) return;
            if (event.type !== "run.completed") setSendError(SEND_ERROR_TEXT);
            clearActiveRun(runId);
          },
          { signal: controller.signal },
        );
      } catch {
        if (!controller.signal.aborted) setSendError(SEND_ERROR_TEXT);
      } finally {
        clearActiveRun(runId);
        abortRef.current = null;
        void syncSessionDetail(sessionId);
      }
    })();
  }

  return (
    <>
      <ChatSessions
        sessions={sessions}
        currentSessionId={currentSessionId}
        status={listStatus}
        error={listError}
        disabled={activeRunId !== null}
        hasMore={nextCursor !== null}
        loadingMore={loadingMore}
        open={panelOpen}
        editing={editing}
        renameError={renameError}
        onTogglePanel={() => setPanelOpen((value) => !value)}
        onClosePanel={() => {
          setPanelOpen(false);
          setEditing(null);
          setRenameError("");
        }}
        onRetry={() => void bootstrap()}
        onLoadMore={() => void handleLoadMore()}
        onCreate={() => void handleCreate()}
        onSelect={handleSelect}
        onStartRename={handleStartRename}
        onCancelRename={() => {
          setEditing(null);
          setRenameError("");
        }}
        onRenameDraftChange={(value) =>
          setEditing((prev) => (prev === null ? null : { ...prev, value }))
        }
        onSubmitRename={() => void handleSubmitRename()}
      />
      <ChatPanel
        messages={messages}
        loading={detailStatus === "loading"}
        detailError={detailError}
        hasSession={currentSessionId !== null}
        disabled={activeRunId !== null}
        error={sendError}
        onSubmit={handleSubmit}
      />
    </>
  );
}
