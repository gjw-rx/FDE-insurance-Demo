# insurance-agent

独立部署的保险 Agent 服务。进程内嵌 [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) SDK，为业务 API 提供内部 HTTP/SSE 契约。

## 职责

- 在自身进程内创建 Pi SDK runtime、Agent session 和 agent loop，不连接交互式 Pi 会话，也不启动 `pi` CLI/RPC 子进程。
- 使用应用专属配置 `config/insurance-agent.json` 和专属 runtime data 目录，不读取 `.pi/settings.json` 或 `~/.pi/agent`。
- 只启用 Pi 内置只读工具 `read`、`grep`、`find`、`ls`，并在执行前限制在受控工作目录内。
- 向 `apps/api` 提供 liveness/readiness、创建 run、SSE 订阅和停止 run。
- 只提供运行时与统一内部接口，不实现续保、报价、核保、材料等业务，也不注册业务 custom tools。

## 命令

```bash
corepack pnpm --filter @renewal/insurance-agent dev        # 本地开发（tsx watch）
corepack pnpm --filter @renewal/insurance-agent start      # 启动服务
corepack pnpm --filter @renewal/insurance-agent typecheck  # 类型检查
corepack pnpm --filter @renewal/insurance-agent test       # 自动化测试（faux provider）
corepack pnpm --filter @renewal/insurance-agent smoke      # 受控真实模型 smoke，需显式密钥
```

## 目录

```text
src/                    # 仅生产代码
├── bootstrap/          # 启动、readiness、信号关闭与受控 smoke
├── config/             # 应用配置加载和校验
├── interfaces/http/    # 内部 health、run、SSE、abort 路由
└── runtime/            # Pi runtime、资源、只读门禁、事件与 registry
test/                   # 测试与测试辅助，不混入生产目录
├── bootstrap/
├── config/
├── interfaces/http/
├── runtime/
└── support/
```

## 接口与配置

- 接口契约：[`@renewal/contracts`](../../packages/contracts/src/agent/)。
- 配置字段与默认值：`config/insurance-agent.json`。
- 环境变量：`INSURANCE_AGENT_CONFIG_PATH`（可选，指向环境专属非敏感配置）、`INSURANCE_AGENT_API_KEY`（模型密钥，仅由部署环境注入）。
- 对接细节见 [Pi Agent 对接设计](../../docs/impl/pi-agent.md)，技术资料见 [Pi SDK](../../docs/tech/pi-sdk.md)。

## 安全边界

模型密钥不写入仓库；服务默认只监听 loopback；SSE 与普通日志不输出 prompt、thinking 正文、文件内容、工具原始参数或凭据。
