import { describe, expect, it } from "vitest";
import { parseApiEnv, parseWorkerEnv, parseActionEnv } from "@anonlimit/config/server";
import { parseClientEnv } from "@anonlimit/config/client";

const valid = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  API_PORT: "4000",
  ACTION_PORT: "4100",
  WEB_ORIGIN: "http://localhost:5173",
  DEMO_MODE: "false",
  OPAQUE_CRYPTO_PROVIDER: "simulated",
  DATABASE_URL_API: "postgresql://api:unit-test-only@localhost:5432/db",
  DATABASE_URL_WORKER: "postgresql://worker:unit-test-only@localhost:5432/db",
  DATABASE_URL_ACTION: "postgresql://action:unit-test-only@localhost:5432/db",
  ACTION_SERVICE_URL: "http://localhost:4100",
  ACTION_SERVICE_TOKEN: "a".repeat(64),
  VERIFIER_LEDGER_HMAC_KEY: "b".repeat(64),
  VERIFIER_ACTION_HMAC_KEY: "c".repeat(64),
  OUTBOX_POLL_MS: "1000",
};
describe("server configuration fails closed", () => {
  it("parses false as false and bounded integers as numbers", () => {
    expect(parseApiEnv(valid)).toMatchObject({ demoMode: false, port: 4000, nodeEnv: "test" });
    expect(parseWorkerEnv(valid).outboxPollMs).toBe(1000);
    expect(parseActionEnv(valid).port).toBe(4100);
  });
  it.each([
    "DATABASE_URL_API",
    "ACTION_SERVICE_TOKEN",
    "VERIFIER_LEDGER_HMAC_KEY",
    "VERIFIER_ACTION_HMAC_KEY",
    "WEB_ORIGIN",
  ])("rejects missing %s", (name) => {
    expect(() => parseApiEnv({ ...valid, [name]: undefined })).toThrow("CONFIGURATION_INVALID");
  });
  it.each(["0", "65536", "1.5", "4000junk", "", "-1"])("rejects invalid port %s", (port) => {
    expect(() => parseApiEnv({ ...valid, API_PORT: port })).toThrow("CONFIGURATION_INVALID");
  });
  it.each(["1", "False", "yes", ""])("rejects ambiguous boolean %s", (value) => {
    expect(() => parseApiEnv({ ...valid, DEMO_MODE: value })).toThrow("CONFIGURATION_INVALID");
  });
  it("rejects unsafe URLs, placeholder secrets, and out-of-range polling", () => {
    expect(() =>
      parseApiEnv({ ...valid, ACTION_SERVICE_TOKEN: "replace-with-at-least-32-random-characters" })
    ).toThrow();
    expect(() =>
      parseApiEnv({ ...valid, WEB_ORIGIN: "https://user:password@example.com" })
    ).toThrow();
    expect(() =>
      parseApiEnv({ ...valid, DATABASE_URL_API: "https://api:password@example.com" })
    ).toThrow();
    expect(() => parseWorkerEnv({ ...valid, OUTBOX_POLL_MS: "1" })).toThrow();
  });
  it("does not disclose input values in validation errors", () => {
    const marker = "private-input-marker";
    try {
      parseApiEnv({ ...valid, DATABASE_URL_API: marker });
    } catch (error) {
      expect(String(error)).toBe("Error: CONFIGURATION_INVALID");
      return;
    }
    throw new Error("Expected validation failure.");
  });
});
describe("public configuration", () => {
  it("parses only the selected public values", () => {
    expect(
      parseClientEnv({
        VITE_API_BASE_URL: "http://localhost:4000/",
        VITE_DEMO_MODE: "false",
        PRIVATE_VALUE: "not-returned",
      })
    ).toEqual({ apiBaseUrl: "http://localhost:4000", demoMode: false });
  });
  it("rejects missing values and credential-bearing URLs", () => {
    expect(() => parseClientEnv({})).toThrow("Invalid public configuration.");
    expect(() =>
      parseClientEnv({
        VITE_API_BASE_URL: "https://user:password@example.com",
        VITE_DEMO_MODE: "true",
      })
    ).toThrow();
  });
});
