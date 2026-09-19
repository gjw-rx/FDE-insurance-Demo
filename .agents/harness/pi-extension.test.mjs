import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import harness, { createFeedbackFilter } from "./pi-extension.mjs";
import { installSettings } from "./install.mjs";

const block = (text) => ({ type: "text", text });
const result = (id, text, extra = {}) => ({
  role: "toolResult",
  toolName: "edit",
  toolCallId: id,
  content: [block(text)],
  ...extra,
});
const unavailable =
  "Pi-lens markdown analysis unavailable — language tools are missing";
const warning = (path) =>
  `⚠ BLIND WRITE — editing \`${path}\` without reading in the last 5 tool calls. Read the file first to avoid assumptions.`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harness-feedback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "file.ts"), "const a = 1;");
  return root;
}
function read(filter, root, input = { path: "file.ts" }) {
  const event = {
    toolName: "read",
    toolCallId: "r",
    input,
    content: [block("const a = 1;")],
  };
  filter.before(event, root);
  filter.after(event);
}

test("重复不可用提示只保留一次，原始消息和用户消息不变，重算幂等", () => {
  const filter = createFeedbackFilter();
  const messages = [
    result("a", unavailable),
    result("b", `成功\n${unavailable}`),
    { role: "user", content: [block(unavailable)] },
  ];
  const actual = filter.filter(messages);
  assert.match(actual[0].content[0].text, /unavailable/);
  assert.equal(actual[1].content[0].text, "成功");
  assert.deepEqual(actual[2], messages[2]);
  assert.deepEqual(filter.filter(messages), actual);
  assert.match(messages[1].content[0].text, /unavailable/);
});
test("真实错误、未知提示及错误工具结果不会被过滤", () => {
  const filter = createFeedbackFilter();
  const messages = [
    result("a", unavailable),
    result("b", `🔴 STOP — error TS1005\n${unavailable}`),
    result("c", unavailable, { isError: true }),
    result("d", "未知 warning"),
  ];
  assert.deepEqual(filter.filter(messages).slice(1), messages.slice(1));
});
test("完整读取版本未变化，超过五个调用仍可安全编辑", (t) => {
  const root = fixture(t);
  const filter = createFeedbackFilter();
  read(filter, root);
  for (let i = 0; i < 8; i++)
    filter.before({ toolName: "bash", toolCallId: String(i), input: {} }, root);
  filter.before(
    { toolName: "edit", toolCallId: "e", input: { path: "file.ts" } },
    root,
  );
  assert.doesNotMatch(
    filter.filter([result("e", `成功\n${warning("file.ts")}`)])[0].content[0]
      .text,
    /BLIND WRITE/,
  );
});
test("外部变化、局部读取及会话重置仍保留警告", (t) => {
  const root = fixture(t);
  for (const mode of ["changed", "partial", "reset"]) {
    const filter = createFeedbackFilter();
    read(
      filter,
      root,
      mode === "partial" ? { path: "file.ts", limit: 1 } : { path: "file.ts" },
    );
    if (mode === "changed")
      writeFileSync(join(root, "file.ts"), "const b = 2;");
    if (mode === "reset") filter.reset();
    filter.before(
      { toolName: "edit", toolCallId: "e", input: { path: "file.ts" } },
      root,
    );
    assert.match(
      filter.filter([result("e", warning("file.ts"))])[0].content[0].text,
      /BLIND WRITE/,
    );
  }
});
test("读取期间发生变化不建立版本证据", (t) => {
  const root = fixture(t);
  const filter = createFeedbackFilter();
  const event = {
    toolName: "read",
    toolCallId: "r",
    input: { path: "file.ts" },
    content: [block("old")],
  };
  filter.before(event, root);
  writeFileSync(join(root, "file.ts"), "new");
  filter.after(event);
  filter.before(
    { toolName: "edit", toolCallId: "e", input: { path: "file.ts" } },
    root,
  );
  assert.match(
    filter.filter([result("e", warning("file.ts"))])[0].content[0].text,
    /BLIND WRITE/,
  );
});
test("安装合并配置、保留模型选择和原有扩展，重复安装幂等", (t) => {
  const root = fixture(t);
  const path = installSettings(root);
  const original = {
    defaultModel: "chosen",
    extensions: ["existing"],
    compaction: { enabled: false },
  };
  writeFileSync(path, JSON.stringify(original));
  installSettings(root);
  const first = readFileSync(path, "utf8");
  installSettings(root);
  assert.equal(readFileSync(path, "utf8"), first);
  const settings = JSON.parse(first);
  assert.equal(settings.defaultModel, "chosen");
  assert.equal(settings.defaultThinkingLevel, "medium");
  assert.equal(settings.extensions.length, 2);
  assert.equal(settings.compaction.enabled, false);
  assert.deepEqual(
    JSON.parse(readFileSync(`${path}.before-harness`, "utf8")),
    original,
  );
});
test("显式推理工具使用宿主 API 且报告实际等级", async () => {
  let tool;
  let level = "medium";
  const handlers = new Map();
  harness({
    on: (name, fn) => handlers.set(name, fn),
    registerTool: (value) => {
      tool = value;
    },
    setThinkingLevel: (value) => {
      level = value;
    },
    getThinkingLevel: () => level,
  });
  assert.equal(level, "medium");
  const output = await tool.execute("id", { level: "low" });
  assert.equal(output.details.actual, "low");
  await assert.rejects(tool.execute("id", { level: "invalid" }));
  assert.ok(handlers.has("context"));
  assert.ok(handlers.has("session_start"));
});
