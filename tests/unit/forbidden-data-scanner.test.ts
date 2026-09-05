import { describe, expect, it } from "vitest";
import { assertNoForbiddenData, scanForbiddenData } from "../../packages/testing/src/index.js";

describe("forbidden-data scanner", () => {
  it("accepts the sanitized evidence fields", () => {
    expect(
      scanForbiddenData({
        maskedUseRef: "use_aaaaaaaaaaaa",
        intentDigest: "sha256:" + "a".repeat(64),
        actionKey: "hmac-sha256:" + "b".repeat(64),
      })
    ).toEqual([]);
    expect(() => assertNoForbiddenData({ maskedUseRef: "use_aaaaaaaaaaaa" })).not.toThrow();
  });

  it("finds forbidden keys and secret markers without returning their values", () => {
    const findings = scanForbiddenData(
      { rawProof: "opaque-secret", holderId: "holder-secret", nested: "safe" },
      { markers: ["opaque-secret", "holder-secret"] }
    );
    expect(findings).toEqual([
      "$.holderId:forbidden-key",
      "$.holderId:secret-marker",
      "$.rawProof:forbidden-key",
      "$.rawProof:secret-marker",
    ]);
    expect(() => assertNoForbiddenData({ credentialId: "private" })).toThrow("FORBIDDEN_DATA");
  });
});
