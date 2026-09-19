import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commandsFor, fingerprint, runCommand, verify } from "./verify.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "harness-verify-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "source.ts"), "const a = 1;");
  return root;
}
const node = (code) => [process.execPath, "-e", code];
test("保留 stdout/stderr、真实失败码及完整长输出", async (t) => {
  const cwd = fixture(t);
  const logPath = join(cwd, "test.log");
  const result = await runCommand(
    node(
      'console.log("x".repeat(30000)); console.error("ROOT_CAUSE"); process.exitCode = 7;',
    ),
    { cwd, logPath },
  );
  assert.equal(result.exitCode, 7);
  const log = readFileSync(logPath, "utf8");
  assert.match(log, /ROOT_CAUSE/);
  assert.ok(log.length > 30000);
  assert.ok(result.excerpt.length < log.length);
});
test("不存在的命令返回失败并保存原因", async (t) => {
  const cwd = fixture(t);
  const result = await runCommand([join(cwd, "missing")], {
    cwd,
    logPath: join(cwd, "spawn.log"),
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.spawnError, /ENOENT/);
});
test("超时清理自己创建的父子进程并保留其他进程", async (t) => {
  const cwd = fixture(t);
  const childFile = join(cwd, "child.pid");
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  t.after(() => unrelated.kill());
  const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(childFile)},String(c.pid)); setInterval(()=>{},1000);`;
  const result = await runCommand(node(code), {
    cwd,
    logPath: join(cwd, "timeout.log"),
    timeoutMs: 500,
    graceMs: 50,
  });
  assert.equal(result.exitCode, 124);
  assert.equal(result.timedOut, true);
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  assert.ok(existsSync(childFile));
  const pid = Number(readFileSync(childFile, "utf8"));
  // 操作系统回收进程可能晚于 close 事件。
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("子进程未清理");
});
test("取消返回 130，停止后续命令", async (t) => {
  const root = fixture(t);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  t.after(() => clearTimeout(timer));
  const summary = await verify({
    root,
    profile: "test",
    commands: [
      node("setInterval(()=>{},1000)"),
      node('throw Error("不应执行")'),
    ],
    signal: controller.signal,
  });
  assert.equal(summary.exitCode, 130);
  assert.equal(summary.results.length, 1);
});
test("同一输入失败两次后阻止盲目重跑；新证据或源码变化允许重试", async (t) => {
  const root = fixture(t);
  const options = {
    root,
    profile: "test",
    commands: [node('console.error("failure"); process.exitCode=1')],
  };
  assert.equal((await verify(options)).exitCode, 1);
  assert.equal((await verify(options)).exitCode, 1);
  const blocked = await verify(options);
  assert.equal(blocked.blocked, true);
  assert.ok(existsSync(blocked.previous));
  assert.equal(
    (await verify({ ...options, retryReason: "已检查服务就绪并调整外部环境" }))
      .exitCode,
    1,
  );
  writeFileSync(join(root, "source.ts"), "const b = 2;");
  assert.equal((await verify(options)).exitCode, 1);
});
test("运行时修改输入不能被记录成通过，运行产物不改变指纹", async (t) => {
  const root = fixture(t);
  const before = fingerprint(root);
  const pass = await verify({
    root,
    profile: "test",
    commands: [node("console.log('ok')")],
  });
  assert.equal(pass.exitCode, 0);
  assert.equal(fingerprint(root), before);
  const changed = await verify({
    root,
    profile: "test",
    commands: [node("require('node:fs').writeFileSync('source.ts','changed')")],
  });
  assert.equal(changed.stale, true);
  assert.equal(changed.exitCode, 3);
});
test("收尾只执行一次全仓类型检查，不叠加 Web tsc", () => {
  const commands = commandsFor(
    "change",
    process.cwd(),
    "improve-agent-harness",
  );
  assert.equal(commands.filter((c) => c.includes("typecheck")).length, 1);
  assert.equal(commands.filter((c) => c.includes("tsc")).length, 0);
  assert.ok(commands.some((c) => c.includes("playwright")));
});
