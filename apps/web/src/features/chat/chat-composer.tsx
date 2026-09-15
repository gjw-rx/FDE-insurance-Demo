import { useRef, useState, type ChangeEvent } from "react";
import { ArrowUpIcon, PaperclipIcon } from "../../shared/ui/icons";

// 文件类型限制：文案、选择器过滤与本地校验共用同一约定（见 design.md D4/D5）。
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

// 对话输入区：仅本地交互，不发送请求、不上传文件、不追加消息（见 design.md D1/D5/D6）。
export function ChatComposer() {
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = text.trim().length > 0;

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
    // 只清空本地输入，不产生任何对话消息或请求（见 design.md D6）。
    setText("");
    setFileError("");
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
    </div>
  );
}
