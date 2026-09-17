import { createAgentRunSession } from "../runtime/agent-session.js";
import { loadAgentConfig } from "../config/agent-config.js";
import { loadAgentModelRuntime } from "../runtime/agent-model-runtime.js";
import { loadAgentResources } from "../runtime/agent-resources.js";

/** 受控冒烟：需要显式 INSURANCE_AGENT_API_KEY，只输出成功状态，不输出回答正文。 */
async function smoke(): Promise<void> {
  const config = loadAgentConfig();
  const apiKey = process.env[config.model.apiKeyEnv];
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error(`${config.model.apiKeyEnv} is required`);
  }

  const [modelResult, resourceResult] = await Promise.all([
    loadAgentModelRuntime(config),
    loadAgentResources(config),
  ]);
  if (modelResult.status !== "ready" || resourceResult.status !== "ready") {
    throw new Error("insurance-agent is not ready");
  }

  const session = await createAgentRunSession({
    config,
    modelRuntime: modelResult.modelRuntime,
    model: modelResult.model,
  });
  try {
    await session.prompt("Reply with OK.");
  } finally {
    await session.dispose();
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, agentName: config.agentName })}\n`,
  );
}

smoke().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`insurance-agent smoke failed: ${message}\n`);
  process.exitCode = 1;
});
