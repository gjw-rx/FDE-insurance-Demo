import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function fingerprint(root) {
  const hash = createHash("sha256");
  const excluded = new Set([
    "node_modules",
    ".git",
    ".pi",
    ".runtime",
    "dist",
    "out",
    "coverage",
    "test-results",
    "playwright-report",
  ]);
  function visit(path, relative) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const name = join(relative, entry.name);
      if (entry.isDirectory()) visit(join(path, entry.name), name);
      else if (/\.(?:[cm]?[jt]sx?|json|ya?ml|md|sh)$/.test(entry.name))
        hash.update(name).update(readFileSync(join(path, entry.name)));
    }
  }
  visit(root, "");
  return hash.digest("hex");
}

// 每次启动独立进程组；仅向自己创建的组发信号，不按进程名匹配。
export async function runCommand(
  command,
  { cwd, logPath, timeoutMs = 180_000, signal, graceMs = 1000 },
) {
  const stream = createWriteStream(logPath, { mode: 0o600 });
  const hash = createHash("sha256");
  let excerpt = "";
  let timedOut = false;
  let aborted = false;
  let spawnError;
  const started = Date.now();
  const child = spawn(command[0], command.slice(1), {
    cwd,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const kill = (sig) => {
    if (!child.pid) return;
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, sig);
    } catch (error) {
      // 进程组可能已由系统回收，或平台拒绝对已退出组再次发信号。
      if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
    }
  };
  let escalation;
  const stop = () => {
    kill("SIGTERM");
    escalation ??= setTimeout(() => kill("SIGKILL"), graceMs);
  };
  const onAbort = () => {
    aborted = true;
    stop();
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const capture = (chunk) => {
    hash.update(chunk);
    stream.write(chunk);
    // 首尾片段便于定位；完整错误始终保存在 logPath。
    excerpt += chunk.toString();
    if (excerpt.length > 24_000)
      excerpt =
        excerpt.slice(0, 12_000) +
        "\n[中段见完整日志]\n" +
        excerpt.slice(-10_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", (error) => {
    spawnError = error.message;
    capture(Buffer.from(`${error.message}\n`));
  });
  const result = await new Promise((done) =>
    child.on("close", (code, exitSignal) => done({ code, exitSignal })),
  );
  clearTimeout(timer);
  // 主进程正常结束也清理留在本次进程组里的后台子进程。
  kill("SIGTERM");
  kill("SIGKILL");
  clearTimeout(escalation);
  signal?.removeEventListener("abort", onAbort);
  await new Promise((done, fail) => {
    stream.on("error", fail);
    stream.end(done);
  });
  return {
    command,
    exitCode: timedOut
      ? 124
      : aborted
        ? 130
        : spawnError || result.code === null || result.code < 0
          ? 1
          : result.code,
    signal: result.exitSignal,
    timedOut,
    aborted,
    spawnError,
    pid: child.pid,
    durationMs: Date.now() - started,
    logPath,
    outputHash: hash.digest("hex"),
    excerpt,
  };
}

export async function verify({
  root,
  profile,
  commands,
  outputRoot = join(root, ".runtime/harness"),
  retryReason = "",
  timeoutMs,
  signal,
}) {
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const inputHash = fingerprint(root);
  const key = createHash("sha256")
    .update(JSON.stringify({ profile, commands, inputHash }))
    .digest("hex");
  const historyPath = join(outputRoot, `${key}.json`);
  const history = existsSync(historyPath)
    ? JSON.parse(readFileSync(historyPath, "utf8"))
    : { failures: 0 };
  if (history.failures >= 2 && !retryReason.trim()) {
    return {
      exitCode: 2,
      blocked: true,
      reason:
        "相同输入已连续失败两次。读取上次日志并补充诊断；环境/取证变化后通过 --retry-reason 记录依据。",
      previous: history.summaryPath,
    };
  }
  const runDir = join(outputRoot, `${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(runDir, { mode: 0o700 });
  const results = [];
  for (const [index, command] of commands.entries()) {
    if (signal?.aborted) break;
    const result = await runCommand(command, {
      cwd: root,
      logPath: join(runDir, `${index + 1}.log`),
      timeoutMs,
      signal,
    });
    results.push(result);
    if (result.exitCode !== 0) break;
  }
  const stale = fingerprint(root) !== inputHash;
  const exitCode = signal?.aborted
    ? 130
    : (results.find((r) => r.exitCode !== 0)?.exitCode ?? (stale ? 3 : 0));
  const summaryPath = join(runDir, "summary.json");
  const summary = {
    profile,
    inputHash,
    stale,
    retryReason,
    exitCode,
    results,
    summaryPath,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
  writeFileSync(
    historyPath,
    JSON.stringify({
      failures: exitCode && !stale ? history.failures + 1 : 0,
      summaryPath,
    }),
    { mode: 0o600 },
  );
  return summary;
}

const pnpm = (...args) => ["corepack", "pnpm", ...args];
export function commandsFor(profile, root, change) {
  const harnessTests = readdirSync(join(root, ".agents/harness"))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort()
    .map((f) => `.agents/harness/${f}`);
  const harness = [process.execPath, "--test", ...harnessTests];
  const api = [
    pnpm("--filter", "@renewal/api", "typecheck"),
    pnpm("--filter", "@renewal/api", "test"),
  ];
  const web = [
    pnpm("exec", "tsc", "--noEmit", "-p", "apps/web"),
    pnpm("--filter", "@renewal/web", "test"),
    pnpm("--filter", "@renewal/web", "build"),
    pnpm("exec", "playwright", "test"),
  ];
  const docs = [pnpm("docs:check"), pnpm("format:check")];
  if (profile === "api") return api;
  if (profile === "web") return web;
  if (profile === "docs") return docs;
  if (profile === "harness") return [harness];
  if (profile === "change") {
    const commands = [
      harness,
      pnpm("typecheck"),
      pnpm("test"),
      pnpm("--filter", "@renewal/web", "build"),
      pnpm("exec", "playwright", "test"),
      ...docs,
    ];
    if (change) commands.push(["openspec", "validate", change, "--strict"]);
    return commands;
  }
  throw new Error(
    "使用 api | web | docs | harness | change [change-name] [--retry-reason 原因]",
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const [profile, ...args] = process.argv.slice(2);
  const reasonIndex = args.indexOf("--retry-reason");
  const retryReason = reasonIndex >= 0 ? args[reasonIndex + 1] : "";
  if (reasonIndex >= 0 && !retryReason?.trim())
    throw new Error("--retry-reason 需要具体依据");
  const change = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  const controller = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"])
    process.once(sig, () => controller.abort());
  const summary = await verify({
    root,
    profile,
    commands: commandsFor(profile, root, change),
    retryReason,
    signal: controller.signal,
  });
  for (const result of summary.results ?? []) {
    console.log(
      `${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.command.join(" ")} (${result.durationMs}ms)\n日志：${result.logPath}`,
    );
    if (result.exitCode !== 0) console.log(result.excerpt);
  }
  console.log(
    JSON.stringify(
      {
        exitCode: summary.exitCode,
        stale: summary.stale,
        reason: summary.reason,
        summary: summary.summaryPath ?? summary.previous,
      },
      null,
      2,
    ),
  );
  process.exitCode = summary.exitCode;
}
