import { readFile } from "node:fs/promises";
import { getApiEnv } from "@anonlimit/config/server";
import { createSimulatedIssuer } from "@anonlimit/crypto/issuer";
import {
  createLookupProtection,
  createSimulatedVerifier,
  sha256Hex,
} from "@anonlimit/crypto/verifier";
import { createVerifierDatabase } from "@anonlimit/db/verifier";
import { createApp } from "./app.js";
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
  });
  const lookupProtection = createLookupProtection({
    ledgerKey: config.verifierLedgerHmacKey,
    actionKey: config.verifierActionHmacKey,
  });
  const protocol = createProtocolService({
    repository: database,
    issuer,
    verifier,
    lookupProtection,
    sha256Hex,
  });
  const app = createApp(config, database.check, protocol);
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
