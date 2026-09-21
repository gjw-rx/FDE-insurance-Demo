import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../../../src/platform/config/api_config.js";

describe("loadApiConfig", () => {
  it("默认配置：loopback 4300 与本机 Agent 地址", () => {
    expect(loadApiConfig({ env: {} })).toEqual({
      host: "127.0.0.1",
      port: 4300,
      agentBaseUrl: "http://127.0.0.1:4310",
      agentConnectTimeoutMs: 3_000,
      agentResponseTimeoutMs: 300_000,
    });
  });

  it("环境变量覆盖 host、port、Agent 地址与超时", () => {
    expect(
      loadApiConfig({
        env: {
          API_HOST: "0.0.0.0",
          API_PORT: "4399",
          AGENT_BASE_URL: "http://agent.internal:9000",
          AGENT_CONNECT_TIMEOUT_MS: "1000",
          AGENT_RESPONSE_TIMEOUT_MS: "60000",
        },
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 4399,
      agentBaseUrl: "http://agent.internal:9000",
      agentConnectTimeoutMs: 1_000,
      agentResponseTimeoutMs: 60_000,
    });
  });

  it("非法端口被拒绝", () => {
    expect(() => loadApiConfig({ env: { API_PORT: "abc" } })).toThrow(
      /API_PORT/,
    );
    expect(() => loadApiConfig({ env: { API_PORT: "-1" } })).toThrow(
      /API_PORT/,
    );
    expect(() => loadApiConfig({ env: { API_PORT: "70000" } })).toThrow(
      /API_PORT/,
    );
  });

  it("非法 Agent 地址被拒绝", () => {
    expect(() =>
      loadApiConfig({ env: { AGENT_BASE_URL: "not-a-url" } }),
    ).toThrow(/AGENT_BASE_URL/);
    expect(() =>
      loadApiConfig({ env: { AGENT_BASE_URL: "ftp://127.0.0.1:4310" } }),
    ).toThrow(/AGENT_BASE_URL/);
    expect(() =>
      loadApiConfig({
        env: { AGENT_BASE_URL: "http://127.0.0.1:4310/internal" },
      }),
    ).toThrow(/AGENT_BASE_URL/);
  });

  it("非法超时被拒绝", () => {
    expect(() =>
      loadApiConfig({ env: { AGENT_CONNECT_TIMEOUT_MS: "-1" } }),
    ).toThrow(/AGENT_CONNECT_TIMEOUT_MS/);
    expect(() =>
      loadApiConfig({ env: { AGENT_RESPONSE_TIMEOUT_MS: "1.5" } }),
    ).toThrow(/AGENT_RESPONSE_TIMEOUT_MS/);
  });
});
