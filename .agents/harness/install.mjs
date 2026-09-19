import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function installSettings(root) {
  const dir = join(root, ".pi");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "settings.json");
  const current = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : {};
  const extension = join(root, ".agents/harness/pi-extension.mjs");
  const next = {
    ...current,
    defaultThinkingLevel: "medium",
    extensions: [...new Set([...(current.extensions ?? []), extension])],
  };
  const text = JSON.stringify(next, null, 2) + "\n";
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) {
    if (existsSync(path) && !existsSync(`${path}.before-harness`))
      copyFileSync(path, `${path}.before-harness`);
    writeFileSync(path, text);
  }
  return path;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const agentDir = join(homedir(), ".pi/agent");
  const global = JSON.parse(
    readFileSync(join(agentDir, "settings.json"), "utf8"),
  );
  const configured = global.packages?.find(
    (p) => typeof p === "string" && p.endsWith("/infcode-settings"),
  );
  const syncPath =
    process.argv[2] ?? (configured && resolve(agentDir, configured));
  if (!syncPath)
    throw new Error(
      "请传入已安装的 pi-workspace-config-sync 包目录；不会直接覆盖生成文件。",
    );
  const { discoverWorkspaceConfig } = await import(
    pathToFileURL(join(syncPath, "extensions/discovery.ts"))
  );
  const { syncWorkspaceConfig } = await import(
    pathToFileURL(join(syncPath, "extensions/sync.ts"))
  );
  const result = syncWorkspaceConfig(
    discoverWorkspaceConfig(root),
    join(root, ".pi"),
  );
  if (result.warnings.length || result.skipped.length)
    throw new Error(JSON.stringify(result));
  console.log(
    JSON.stringify({ settings: installSettings(root), sync: result }, null, 2),
  );
}
