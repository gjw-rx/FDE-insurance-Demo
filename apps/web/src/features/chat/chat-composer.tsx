import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowUpIcon, PaperclipIcon } from "../../shared/ui/icons";

// 文件类型限制：文案、选择器过滤与本地校验共用同一约定（见 dialog-function design.md D4/D5）。
const FILE_ACCEPT = "image/*,.pdf";
const fileTypesHint = "仅支持图片、PDF";
const fileTypesError = "仅支持图片、PDF 格式的文件";

// 选择器过滤可被绕过，MIME 也可能缺失，因此按 MIME 与扩展名共同判断。
function isAllowedFile(file: File) {
  if (file.type.startsWith("image/") || file.type === "application/pdf") {
    return true;
  }
  return file.type === "" && file.name.toLowerCase().endsWith(".pdf");
}

export interface ChatComposerProps {
  /** 活动 run 期间禁用发送（输入仍可编辑）。 */
  readonly disabled: boolean;
  /** 提交非空文本；清空输入由 composer 自身完成。 */
  readonly onSubmit: (text: string) => void;
  /** 面板层传入的发送错误提示；空串表示无错误。 */
  readonly error: string;
}

/**
 * 对话输入区：文件类型校验保持本地；文本提交交给面板层
 * 通过业务 API 创建 run 并流式展示回复（见 agent-chat-streaming design.md D5-D7）。
 */
export function ChatComposer({ disabled, onSubmit, error }: ChatComposerProps) {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = text.trim().length > 0 && !disabled;

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // 清空 value，使同一文件可再次触发 change。
    event.target.value = "";
    if (!file) {
      return;
    }
    setFileError(isAllowedFile(file) ? "" : fileTypesError);
  }

  function handleSend() {
    // 面板层持有发送状态机：这里只提交非空文本并清空本地输入。
    onSubmit(text.trim());
    setText("");
    setFileError("");
  }

  // 键盘约定：Enter 发送，Shift+Enter 换行。
  // 中文输入法在候选未上屏时按 Enter 是「选词」，必须放行默认行为，否则拼音打到一半就误发。
  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }
    // 拦截默认换行；此时只有输入非空且无活动 run 才真正发送。
    event.preventDefault();
    if (canSend) {
      handleSend();
    }
  }

  return (
    <div className="chat-composer">
      <div className="chat-composer__box">
        <textarea
          className="chat-composer__input"
          placeholder="输入您想咨询的车险问题..."
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <div className="chat-composer__toolbar">
          <button
            type="button"
            className="chat-composer__upload"
            onClick={() => fileInputRef.current?.click()}
          >
            <PaperclipIcon className="chat-composer__upload-icon" />
            上传文件
          </button>
          <span className="chat-composer__hint">{fileTypesHint}</span>
          <input
            ref={fileInputRef}
            className="chat-composer__file-input"
            type="file"
            accept={FILE_ACCEPT}
            onChange={handleFileChange}
            hidden
          />
          <button
            type="button"
            className="chat-composer__send"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="发送"
          >
            <ArrowUpIcon className="chat-composer__send-icon" />
          </button>
        </div>
      </div>
      {fileError ? (
        <p className="chat-composer__error" role="alert">
          {fileError}
        </p>
      ) : null}
      {error ? (
        <p className="chat-composer__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
