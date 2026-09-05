# Opaque crypto boundary

Phase 2 supplies a replaceable crypto interface and an explicitly simulated provider. Only
`@anonlimit/crypto/holder` is browser-safe. Package export conditions block the issuer, verifier,
and audit entrypoints when a browser condition is active.

| Entrypoint                   | Runtime | Responsibility                                                                                                            |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@anonlimit/crypto/holder`   | Browser | Validate a wallet credential, select one hidden slot, bind it to a challenge and intent, and create a presentation.       |
| `@anonlimit/crypto/issuer`   | Server  | Validate an active policy and issue exactly `maxUses` per-use capabilities.                                               |
| `@anonlimit/crypto/verifier` | Server  | Recompute every policy, scope, intent, challenge, and run binding; verify a presentation; protect persistent lookup keys. |
| `@anonlimit/crypto/audit`    | Server  | Verify two historical presentation bindings and return `SAME_USE` or `UNLINKABLE` under the simulator assumption.         |

## Simulated provider behavior

The issuer derives one deterministic nullifier and authentication key for each slot from an
ephemeral credential seed and the canonical quota scope. It seals the per-slot scope, policy,
demo-run, nullifier, and authentication claims with AES-GCM. The wallet receives exactly the
declared number of capabilities; copying or reordering them cannot create another valid
nullifier. Runtime issuance uses Web Crypto randomness by default. Tests can inject the clock and
random byte source to reproduce vectors without weakening runtime defaults.

The holder validates that `0 <= hiddenSlot < maxUses`, recomputes the canonical policy, intent,
and challenge context, and authenticates that context with the selected per-slot key. Its public
presentation contains a per-use nullifier and an opaque ticket/proof envelope. It does not expose
the slot number, per-slot key, holder identity, or credential-wide identifier.

The verifier treats its policy, active demo run, issuer parameters, challenge record, operation
ID, and intent digest as authoritative server inputs. It recomputes the binding and collapses
ticket, context, freshness, and authentication failures into `PRESENTATION_REJECTED`. The audit
adapter can recheck an already accepted historical proof after expiry; it still verifies all
cryptographic bindings before comparing uses.

## Security assumptions and limits

This provider demonstrates the application contract. It is not an anonymous-credential system
and must not be used as production cryptography.

- Blind issuance and zero-knowledge presentation are not implemented. `blindedHolderRequest` is
  an interface placeholder, and the simulated issuer constructs and momentarily sees the slot
  capabilities.
- `UNLINKABLE` is an assumption-backed simulator result. It shows that distinct valid slots expose
  no common public identifier through this interface; it is not a cryptographic anonymity proof.
- The issuer/verifier simulator shares a symmetric secret and does not resist issuer-verifier
  collusion, traffic analysis, browser compromise, or endpoint metadata correlation.
- The limit applies to one issued credential in one canonical quota scope, not to a person. A site
  needs an external eligibility rule if it wants to restrict how many credentials it issues.
- Copying a wallet copies the same fixed capabilities. It does not increase the allowance, but all
  copies can compete to spend those capabilities.
- Revocation, key rotation, hardware-backed storage, and production key management are outside
  this provider.

The simulator secret must be an independently generated 32-byte lowercase hex value injected at
the server boundary. Ledger and Action Simulator HMAC keys must also be separate. No secret is
embedded in browser code. During verification, raw proofs and nullifiers are request-memory data;
the durable acceptance phase must persist only the protected nullifier lookup key and then discard
the raw values.
