ALTER TABLE verifier.outbox_events
  ADD COLUMN policy_id varchar(128),
  ADD COLUMN policy_version integer;

UPDATE verifier.outbox_events AS o
SET policy_id = p.policy_id,
    policy_version = p.version
FROM verifier.use_records AS u
JOIN verifier.verification_challenges AS c ON c.challenge_id = u.challenge_id
JOIN verifier.quota_policies AS p
  ON p.policy_id = c.policy_id AND p.version = c.policy_version
WHERE o.use_id = u.use_id
  AND o.policy_id IS NULL;

CREATE OR REPLACE FUNCTION verifier.reject_outbox_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.use_id IS DISTINCT FROM OLD.use_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.safe_payload IS DISTINCT FROM OLD.safe_payload
    OR NEW.policy_id IS DISTINCT FROM OLD.policy_id
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ck_outbox_events_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
