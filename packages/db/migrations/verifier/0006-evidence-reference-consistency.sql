-- Use the same public per-use reference in SQL views, protocol events, and the API.
CREATE OR REPLACE VIEW verifier.evidence_uses AS
SELECT
  u.demo_run_id,
  'use_' || substr(encode(sha256(convert_to(u.use_id::text, 'UTF8')), 'hex'), 1, 12) AS masked_use_ref,
  u.intent_digest,
  u.status,
  CASE
    WHEN u.status = 'SUCCEEDED' THEN u.cached_result ->> 'receiptId'
    ELSE NULL
  END AS receipt_id,
  u.action_key
FROM verifier.use_records AS u;
