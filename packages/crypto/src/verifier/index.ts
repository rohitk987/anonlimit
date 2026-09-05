import { deriveActionKey, deriveNullifierKey } from "@anonlimit/domain";
import { hex64Schema } from "@anonlimit/contracts";
import { hmacSha256Hex, sha256Hex } from "../holder/primitives.js";
import {
  createBindingVerifier,
  type VerifierOptions,
  type VerificationInput,
  type VerificationResult,
} from "../simulated-provider/server.js";

export interface VerifierAdapter {
  verifyPresentation(input: VerificationInput): Promise<VerificationResult>;
}
export function createSimulatedVerifier(options: VerifierOptions): VerifierAdapter {
  return { verifyPresentation: createBindingVerifier(options, true) };
}

/** Keep independently configured ledger/action keys in a server-only closure. */
export function createLookupProtection(keys: { ledgerKey: string; actionKey: string }) {
  if (
    !hex64Schema.safeParse(keys.ledgerKey).success ||
    !hex64Schema.safeParse(keys.actionKey).success
  )
    throw new Error("CONFIGURATION_INVALID");
  const ledgerKey = keys.ledgerKey;
  const actionKey = keys.actionKey;
  return {
    protectNullifier: (input: { scopeHash: string; rawNullifier: string }) =>
      deriveNullifierKey(input, ledgerKey, hmacSha256Hex),
    deriveActionKey: (input: { useId: string; intentDigest: string }) =>
      deriveActionKey(input, actionKey, hmacSha256Hex),
  };
}
export type {
  SimulatorOptions,
  VerifierOptions,
  VerificationInput,
  VerificationResult,
} from "../simulated-provider/server.js";
export { sha256Hex };
