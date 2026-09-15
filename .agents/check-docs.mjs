import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const rootOption = process.argv.indexOf("--root");
const root = resolve(
  rootOption >= 0 ? process.argv[rootOption + 1] : process.cwd(),
);
const errors = [];

function walk(directory, predicate = () => true) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? walk(path, predicate)
      : predicate(path)
        ? [path]
        : [];
  });
}

function markdownLinks(file) {
  const content = readFileSync(file, "utf8");
  return [...content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
    (match) => match[1],
  );
}

function localTarget(file, target) {
  const clean = target.replace(/^<|>$/g, "").split("#", 1)[0];
  if (!clean || /^(?:[a-z]+:|#)/i.test(clean)) return null;
  return resolve(dirname(file), decodeURIComponent(clean));
}

const markdownFiles = [
  join(root, "AGENTS.md"),
  join(root, "README.md"),
  ...walk(join(root, "docs"), (file) => file.endsWith(".md")),
].filter(existsSync);

for (const file of markdownFiles) {
  for (const link of markdownLinks(file)) {
    const target = localTarget(file, link);
    if (target && !existsSync(target))
      errors.push(`${relative(root, file)}: 本地链接不存在：${link}`);
  }
}

const changesRoot = join(root, "openspec", "changes");
const changes = existsSync(changesRoot)
  ? readdirSync(changesRoot, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name !== "archive",
    )
  : [];
const mainSpecsRoot = join(root, "openspec", "specs");
const specs = [
  ...walk(mainSpecsRoot, (file) => file.endsWith(`${sep}spec.md`)).map(
    (file) => ({ file, base: mainSpecsRoot }),
  ),
  ...changes.flatMap((change) => {
    const base = join(changesRoot, change.name, "specs");
    return walk(base, (file) => file.endsWith(`${sep}spec.md`)).map((file) => ({
      file,
      base,
    }));
  }),
];

for (const spec of specs) {
  const capability = relative(spec.base, dirname(spec.file));
  const feature = join(root, "docs", "features", `${capability}.md`);
  if (!existsSync(feature)) {
    errors.push(
      `缺少需求文档 docs/features/${capability}.md（对应 ${relative(root, spec.file)}）`,
    );
    continue;
  }
  const linked = markdownLinks(feature)
    .map((link) => localTarget(feature, link))
    .filter(Boolean);
  if (!linked.includes(resolve(spec.file))) {
    errors.push(
      `${relative(root, feature)}: 未链接对应 spec ${relative(root, spec.file)}`,
    );
  }
}

for (const change of changes) {
  const plan = join(root, "docs", "testing", `${change.name}.md`);
  if (!existsSync(plan)) {
    errors.push(`缺少测试计划 docs/testing/${change.name}.md`);
    continue;
  }
  const linked = markdownLinks(plan)
    .map((link) => localTarget(plan, link))
    .filter(Boolean);
  if (!linked.includes(resolve(join(changesRoot, change.name)))) {
    errors.push(
      `${relative(root, plan)}: 未链接活动 change openspec/changes/${change.name}/`,
    );
  }
  const content = readFileSync(plan, "utf8");
  for (const heading of ["## 场景覆盖", "## 验证记录", "## 未覆盖项"]) {
    if (!content.includes(heading))
      errors.push(`${relative(root, plan)}: 缺少章节“${heading}”`);
  }
}

const packageFiles = [
  join(root, "package.json"),
  ...walk(join(root, "apps"), (file) => file.endsWith("package.json")),
  ...walk(join(root, "packages"), (file) => file.endsWith("package.json")),
].filter(existsSync);
const dependencies = new Set();
for (const file of packageFiles) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const group of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
  ]) {
    for (const [name, version] of Object.entries(group ?? {})) {
      if (
        !String(version).startsWith("workspace:") &&
        !name.startsWith("@renewal/")
      )
        dependencies.add(name);
    }
  }
}

const documentedPackages = new Set();
for (const file of walk(join(root, "docs", "tech"), (path) =>
  path.endsWith(".md"),
)) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(
    /<!--\s*tech-packages:\s*([^>]+?)\s*-->/g,
  )) {
    for (const name of match[1]
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)) {
      documentedPackages.add(name);
    }
  }
}
for (const dependency of dependencies) {
  if (!documentedPackages.has(dependency)) {
    errors.push(
      `直接依赖 ${dependency} 缺少 docs/tech 文档中的 tech-packages 声明`,
    );
  }
}
for (const runtimeDoc of ["nodejs.md", "pnpm.md"]) {
  if (!existsSync(join(root, "docs", "tech", runtimeDoc)))
    errors.push(`缺少运行工具文档 docs/tech/${runtimeDoc}`);
}

if (errors.length) {
  console.error("文档规范检查失败：\n");
  for (const error of errors) console.error(`- ${error}`);
  console.error(
    "\n请按 AGENTS.md 和 docs/engineering/ai-workflow.md 修复后重新提交。",
  );
  process.exit(1);
}

console.log(
  `文档规范检查通过：${markdownFiles.length} 个 Markdown 文件、${changes.length} 个活动 change、${dependencies.size} 个直接依赖。`,
);
