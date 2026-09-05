# Opaque crypto boundary

Only `@anonlimit/crypto/holder` is browser-safe. Issuer, verifier, and audit exports
are server-only and explicitly blocked under the browser export condition.

Phase 1 provides package boundaries only. No issuance, presentation, verification,
or linkability behavior exists yet. Phase 2 will define and test those contracts
with an explicitly simulated provider; production anonymity is not implemented.
