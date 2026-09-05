import { createHash } from "node:crypto";
import pg from "pg";
import { computePolicyDigest, type Policy } from "@anonlimit/domain";

export const DEFAULT_DEMO_RUN_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_POLICY_ID = "anon-demo";
export const DEFAULT_POLICY_VERSION = 1;
export const DEFAULT_ISSUER_KEY_ID = "demo-issuer-v1";

export interface DefaultPolicySeedOptions {
  readonly issuerKeyId?: string;
  readonly now?: () => number;
}

export function createDefaultPolicy(issuerKeyId = DEFAULT_ISSUER_KEY_ID): Policy {
  return Object.freeze({
    id: DEFAULT_POLICY_ID,
    version: DEFAULT_POLICY_VERSION,
    issuerKeyId,
    audience: "demo-service",
    maxUses: 3,
    quotaWindowId: "hackathon-demo",
    status: "ACTIVE",
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2036-01-01T00:00:00.000Z",
  });
}

async function sha256Hex(input: string): Promise<string> {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function seedDefaultPolicy(
  connectionString: string,
  options: DefaultPolicySeedOptions = {}
): Promise<{ readonly policy: Policy; readonly demoRunId: string }> {
  const policy = createDefaultPolicy(options.issuerKeyId);
  const policyDigest = await computePolicyDigest(policy, sha256Hex);
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        `INSERT INTO verifier.demo_runs (demo_run_id, status)
         VALUES ($1, 'ACTIVE')
         ON CONFLICT (demo_run_id) DO NOTHING`,
        [DEFAULT_DEMO_RUN_ID]
      );
      await client.query(
        `INSERT INTO verifier.quota_policies (
           policy_id, version, issuer_key_id, verifier_audience, max_uses,
           quota_window_id, policy_digest, not_before, expires_at, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (policy_id, version) DO NOTHING`,
        [
          policy.id,
          policy.version,
          policy.issuerKeyId,
          policy.audience,
          policy.maxUses,
          policy.quotaWindowId,
          policyDigest,
          policy.validFrom,
          policy.validUntil,
          policy.status,
        ]
      );

      const runResult = await client.query<{ status: string }>(
        "SELECT status FROM verifier.demo_runs WHERE demo_run_id = $1",
        [DEFAULT_DEMO_RUN_ID]
      );
      const policyResult = await client.query<{
        issuer_key_id: string;
        verifier_audience: string;
        max_uses: number;
        quota_window_id: string;
        policy_digest: string;
        not_before: Date | string;
        expires_at: Date | string;
        status: string;
      }>(
        `SELECT issuer_key_id, verifier_audience, max_uses, quota_window_id,
                policy_digest, not_before, expires_at, status
         FROM verifier.quota_policies WHERE policy_id = $1 AND version = $2`,
        [policy.id, policy.version]
      );
      const row = policyResult.rows[0];
      if (
        runResult.rows[0]?.status !== "ACTIVE" ||
        !row ||
        row.issuer_key_id !== policy.issuerKeyId ||
        row.verifier_audience !== policy.audience ||
        row.max_uses !== policy.maxUses ||
        row.quota_window_id !== policy.quotaWindowId ||
        row.policy_digest !== policyDigest ||
        iso(row.not_before) !== policy.validFrom ||
        iso(row.expires_at) !== policy.validUntil ||
        row.status !== policy.status
      )
        throw new Error("SEED_CONFLICT");

      await client.query("COMMIT");
      return { policy, demoRunId: DEFAULT_DEMO_RUN_ID };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}
