-- Evidence views expose only the fields approved for the audit and Demo Lab.
-- The underlying verifier tables remain unavailable to evidence_reader.
CREATE VIEW verifier.evidence_uses AS
SELECT
  u.demo_run_id,
  'use_' || substr(md5(u.use_id::text), 1, 12) AS masked_use_ref,
  u.intent_digest,
  u.status,
  CASE
    WHEN u.status = 'SUCCEEDED' THEN u.cached_result ->> 'receiptId'
    ELSE NULL
  END AS receipt_id,
  u.action_key
FROM verifier.use_records AS u;

CREATE VIEW verifier.evidence_events AS
SELECT
  sequence,
  occurred_at,
  event_name,
  trace_id,
  demo_run_id,
  policy_id,
  policy_version,
  from_state,
  to_state,
  decision_code,
  usage_delta,
  action_delta,
  latency_ms,
  masked_use_ref
FROM verifier.protocol_events;

GRANT USAGE ON SCHEMA verifier TO evidence_reader;
GRANT SELECT ON verifier.evidence_uses, verifier.evidence_events TO evidence_reader, verifier_api;
