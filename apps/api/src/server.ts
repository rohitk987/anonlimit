import { readFile } from "node:fs/promises";
import { getApiEnv } from "@anonlimit/config/server";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { createSimulatedAuditor } from "@anonlimit/crypto/audit";
import { createVerifierDatabase } from "@anonlimit/db/verifier";
import { DEFAULT_POLICY_ID, DEFAULT_POLICY_VERSION } from "@anonlimit/db/seed";
import { createApp } from "./app.js";
import { createLostAckFaultController } from "./modules/demo/fault-controller.js";
import { createActionSimulatorResetClient } from "./modules/internal/action-simulator-client.js";
import { createActionSimulatorEvidenceClient } from "./modules/internal/action-simulator-client.js";
import { createDemoResetController } from "./modules/demo/reset-demo.js";
import { createEvidenceController } from "./modules/evidence/evidence-controller.js";
import { createEventStreamController } from "./modules/events/events-controller.js";
import { createProtocolService } from "./modules/protocol/index.js";

interface PublicParameters {
  readonly provider: "SIMULATED_CAPABILITIES_V1";
  readonly issuerKeyId: string;
}

function parsePublicParameters(value: string, issuerKeyId: string): PublicParameters {
  const candidate: unknown = JSON.parse(value);
  if (
    !candidate ||
    typeof candidate !== "object" ||
    Object.keys(candidate).length !== 2 ||
    !("provider" in candidate) ||
    candidate.provider !== "SIMULATED_CAPABILITIES_V1" ||
    !("issuerKeyId" in candidate) ||
    candidate.issuerKeyId !== issuerKeyId
  )
    throw new Error("CONFIGURATION_INVALID");
  return { provider: "SIMULATED_CAPABILITIES_V1", issuerKeyId };
}

async function main(): Promise<void> {
  const config = getApiEnv();
  const database = createVerifierDatabase(config.databaseUrl);
  const [issuerSecret, publicParametersText] = await Promise.all([
    readFile(config.issuerPrivateKeyPath, "utf8"),
    readFile(config.issuerPublicParametersPath, "utf8"),
  ]);
  const trimmedSecret = issuerSecret.trim();
  if (!/^[a-f0-9]{64}$/u.test(trimmedSecret)) throw new Error("CONFIGURATION_INVALID");
  const publicParameters = parsePublicParameters(publicParametersText, config.issuerKeyId);
  const issuer = createSimulatedIssuer({
    issuerKeyId: config.issuerKeyId,
    issuerSecret: trimmedSecret,
  });
  if (
    issuer.publicParameters.provider !== publicParameters.provider ||
    issuer.publicParameters.issuerKeyId !== publicParameters.issuerKeyId
  )
    throw new Error("CONFIGURATION_INVALID");
  const verifier = createSimulatedVerifier({
    issuerKeyId: config.issuerKeyId,
    issuerSecret: trimmedSecret,
    demoMode: config.demoMode,
  });
  const lookupProtection = createLookupProtection({
    ledgerKey: config.verifierLedgerHmacKey,
    actionKey: config.verifierActionHmacKey,
  });
  const audit = createSimulatedAuditor({
    issuerKeyId: config.issuerKeyId,
    issuerSecret: trimmedSecret,
    now: Date.now,
  });
  const protocol = createProtocolService({
    repository: database,
    issuer,
    verifier,
    lookupProtection,
    sha256Hex,
  });
  const faultController = createLostAckFaultController(database);
  const resetController = createDemoResetController({
    repository: database,
    actionClient: createActionSimulatorResetClient({
      actionServiceUrl: config.actionServiceUrl,
      actionServiceToken: config.actionServiceToken,
    }),
    policyId: DEFAULT_POLICY_ID,
    policyVersion: DEFAULT_POLICY_VERSION,
  });
  const evidenceController = createEvidenceController({
    repository: database,
    actionClient: createActionSimulatorEvidenceClient({
      actionServiceUrl: config.actionServiceUrl,
      actionServiceToken: config.actionServiceToken,
    }),
    auditAdapter: audit,
    issuerPublicParameters: issuer.publicParameters,
    lookupProtection,
    sha256Hex,
  });
  const eventController = createEventStreamController(database);
  const app = createApp(
    config,
    database.check,
    protocol,
    faultController,
    resetController,
    evidenceController,
    eventController
  );
  app.addHook("onClose", () => database.close());
  const stop = () => {
    void app.close().catch(() => {
      process.stderr.write("SHUTDOWN_FAILED\n");
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await app.listen({ host: "0.0.0.0", port: config.port });
  } catch {
    await app.close();
    throw new Error("STARTUP_FAILED");
  }
}
main().catch(() => {
  process.stderr.write("STARTUP_FAILED\n");
  process.exitCode = 1;
});
