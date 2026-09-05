import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { createSafeLogger } from "@anonlimit/observability";

describe("foundation privacy boundaries", () => {
  it.each([
    ["apps/web/src/probe.ts", "@anonlimit/db/verifier"],
    ["apps/web/src/probe.ts", "@anonlimit/crypto/issuer"],
    ["apps/web/src/probe.ts", "@anonlimit/config/server"],
    ["apps/web/src/probe.ts", "fs"],
    ["apps/api/src/probe.ts", "@anonlimit/db/action"],
    ["apps/action-simulator/src/probe.ts", "@anonlimit/db/verifier"],
    ["apps/worker/src/probe.ts", "@anonlimit/crypto/holder"],
    ["apps/api/src/probe.ts", "@anonlimit/testing"],
    ["packages/domain/src/probe.ts", "node:crypto"],
  ])("rejects forbidden import in %s: %s", async (filePath, specifier) => {
    const result = await new ESLint().lintText(`import "${specifier}";`, { filePath });
    expect(result[0]?.messages.some((message) => message.ruleId === "no-restricted-imports")).toBe(
      true
    );
  });
  it("rejects relative bypasses but permits holder-only browser imports", async () => {
    const eslint = new ESLint();
    const bad = await eslint.lintText('import "../../../packages/db/src/verifier.js";', {
      filePath: "apps/web/src/probe.ts",
    });
    expect(bad[0]?.messages.some((m) => m.ruleId === "boundaries/workspace-imports")).toBe(true);
    const good = await eslint.lintText('import "@anonlimit/crypto/holder";', {
      filePath: "apps/web/src/probe.ts",
    });
    expect(good[0]?.errorCount).toBe(0);
  });
  it("requires application environment access through typed configuration", async () => {
    const result = await new ESLint().lintText("process.env.DATABASE_URL_API;", {
      filePath: "apps/api/src/probe.ts",
    });
    expect(result[0]?.messages.some((m) => m.ruleId === "no-restricted-properties")).toBe(true);
  });
  it("blocks server config resolution under browser conditions", () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ["--conditions=browser", "--input-type=module", "-e", 'import "@anonlimit/config/server";'],
        { stdio: "pipe" }
      )
    ).toThrow();
  });
  it.each([
    ["apps/web/src/probe.ts", 'void import("@anonlimit/config/server");'],
    ["apps/web/src/probe.ts", 'void import("../../../packages/db/src/verifier.js");'],
    ["packages/crypto/src/holder/probe.ts", 'import "../issuer/index.js";'],
    ["packages/config/src/client-env.ts", 'import "./server-env.js";'],
  ])("rejects alternate boundary bypasses in %s", async (filePath, code) => {
    const result = await new ESLint().lintText(code, { filePath });
    expect(result[0]?.messages.some((m) => m.ruleId === "boundaries/workspace-imports")).toBe(true);
  });
  it("discards arbitrary log objects and free-text messages", () => {
    const lines: string[] = [];
    const logger = createSafeLogger("info", {
      write(chunk) {
        lines.push(chunk);
      },
    });
    logger.info(
      {
        method: "GET",
        route: "/health/ready",
        statusCode: 200,
        password: "private-marker",
        proof: "private-marker",
        req: { headers: { authorization: "private-marker" } },
      },
      "private-marker"
    );
    logger.error(new Error("private-marker"));
    logger.info("private-marker");
    logger.child({ token: "private-marker" }).info({ statusCode: 200 });
    logger
      .child({ token: "private-marker" }, { msgPrefix: "private-marker" })
      .child({ proof: "private-marker" })
      .error("private-marker");
    const output = lines.join("");
    expect(output).not.toContain("private-marker");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      method: "GET",
      route: "/health/ready",
      statusCode: 200,
    });
  });
  it("browser assets contain no server package or Node code", async () => {
    const names = await readdir("apps/web/dist/assets");
    const scripts = await Promise.all(
      names
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(join("apps/web/dist/assets", name), "utf8"))
    );
    expect(scripts.length).toBeGreaterThan(0);
    const bundle = scripts.join("");
    if (existsSync(".env")) {
      const local = parseEnv(await readFile(".env", "utf8"));
      const exposedSecret = Object.entries(local).some(
        ([key, value]) =>
          /_PASSWORD$|_TOKEN$|_HMAC_KEY$/.test(key) &&
          typeof value === "string" &&
          value.length > 0 &&
          bundle.includes(value)
      );
      expect(exposedSecret).toBe(false);
    }
    for (const marker of [
      "DATABASE_URL_API",
      "VERIFIER_LEDGER_HMAC_KEY",
      "ACTION_SERVICE_TOKEN",
      "node:crypto",
      "createVerifierDatabase",
      "createSafeLogger",
    ])
      expect(bundle).not.toContain(marker);
  });
});
