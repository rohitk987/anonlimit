CREATE TABLE verifier.demo_runs (
  demo_run_id uuid PRIMARY KEY,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  CONSTRAINT ck_demo_runs_status CHECK (status IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT ck_demo_runs_closed_at CHECK (
    (status = 'ACTIVE' AND closed_at IS NULL)
    OR (status = 'CLOSED' AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_demo_runs_single_active
  ON verifier.demo_runs (status)
  WHERE status = 'ACTIVE';

CREATE TABLE verifier.quota_policies (
  policy_id varchar(128) NOT NULL,
  version integer NOT NULL,
  issuer_key_id varchar(128) NOT NULL,
  verifier_audience varchar(128) NOT NULL,
  max_uses integer NOT NULL,
  quota_window_id varchar(128) NOT NULL,
  policy_digest varchar(71) NOT NULL,
  not_before timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pk_quota_policies PRIMARY KEY (policy_id, version),
  CONSTRAINT uq_quota_policies_digest UNIQUE (policy_digest),
  CONSTRAINT ck_quota_policies_version CHECK (version BETWEEN 1 AND 2147483647),
  CONSTRAINT ck_quota_policies_max_uses CHECK (max_uses BETWEEN 1 AND 100),
  CONSTRAINT ck_quota_policies_digest CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_quota_policies_status CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT ck_quota_policies_validity CHECK (not_before < expires_at)
);

CREATE FUNCTION verifier.reject_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ck_quota_policies_immutable';
END;
$$;

CREATE TRIGGER quota_policies_immutable
BEFORE UPDATE OR DELETE ON verifier.quota_policies
FOR EACH ROW EXECUTE FUNCTION verifier.reject_policy_mutation();

CREATE TABLE verifier.verification_challenges (
  challenge_id uuid PRIMARY KEY,
  demo_run_id uuid NOT NULL,
  nonce_hash varchar(71) NOT NULL,
  policy_id varchar(128) NOT NULL,
  policy_version integer NOT NULL,
  operation_id uuid NOT NULL,
  intent_digest varchar(71) NOT NULL,
  scope_hash varchar(71) NOT NULL,
  policy_digest varchar(71) NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'ISSUED',
  use_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_verification_challenges_run
    FOREIGN KEY (demo_run_id) REFERENCES verifier.demo_runs (demo_run_id),
  CONSTRAINT fk_verification_challenges_policy
    FOREIGN KEY (policy_id, policy_version)
    REFERENCES verifier.quota_policies (policy_id, version),
  CONSTRAINT uq_verification_challenges_nonce_hash UNIQUE (nonce_hash),
  CONSTRAINT ck_verification_challenges_nonce_hash
    CHECK (nonce_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_verification_challenges_intent_digest
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_verification_challenges_scope_hash
    CHECK (scope_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_verification_challenges_policy_digest
    CHECK (policy_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_verification_challenges_state
    CHECK (state IN ('ISSUED', 'CONSUMED', 'EXPIRED')),
  CONSTRAINT ck_verification_challenges_use_state CHECK (
    (state = 'CONSUMED' AND use_id IS NOT NULL)
    OR (state IN ('ISSUED', 'EXPIRED') AND use_id IS NULL)
  ),
  CONSTRAINT ck_verification_challenges_expiry CHECK (created_at < expires_at)
);

CREATE INDEX ix_verification_challenges_expiry
  ON verifier.verification_challenges (state, expires_at);

CREATE INDEX ix_verification_challenges_operation
  ON verifier.verification_challenges (demo_run_id, operation_id);

CREATE TABLE verifier.use_records (
  use_id uuid PRIMARY KEY,
  demo_run_id uuid NOT NULL,
  challenge_id uuid NOT NULL,
  scope_hash varchar(71) NOT NULL,
  nullifier_key varchar(76) NOT NULL,
  operation_id uuid NOT NULL,
  intent_digest varchar(71) NOT NULL,
  status text NOT NULL,
  action_key varchar(76) NOT NULL,
  cached_result jsonb,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT fk_use_records_run
    FOREIGN KEY (demo_run_id) REFERENCES verifier.demo_runs (demo_run_id),
  CONSTRAINT fk_use_records_challenge
    FOREIGN KEY (challenge_id) REFERENCES verifier.verification_challenges (challenge_id),
  CONSTRAINT uq_use_records_challenge UNIQUE (challenge_id),
  CONSTRAINT uq_use_records_run_scope_nullifier
    UNIQUE (demo_run_id, scope_hash, nullifier_key),
  CONSTRAINT uq_use_records_run_scope_operation
    UNIQUE (demo_run_id, scope_hash, operation_id),
  CONSTRAINT uq_use_records_action_key UNIQUE (action_key),
  CONSTRAINT ck_use_records_scope_hash
    CHECK (scope_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_use_records_nullifier_key
    CHECK (nullifier_key ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_use_records_intent_digest
    CHECK (intent_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_use_records_action_key
    CHECK (action_key ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_use_records_status
    CHECK (status IN ('ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL')),
  CONSTRAINT ck_use_records_failure_code
    CHECK (failure_code IS NULL OR failure_code IN ('ACTION_FAILED_FINAL', 'ACTION_INTEGRITY_CONFLICT')),
  CONSTRAINT ck_use_records_result_state CHECK (
    (status = 'ACCEPTED_PENDING_ACTION' AND cached_result IS NULL AND failure_code IS NULL AND completed_at IS NULL)
    OR (status = 'SUCCEEDED' AND jsonb_typeof(cached_result) = 'object' AND failure_code IS NULL AND completed_at IS NOT NULL)
    OR (status = 'FAILED_FINAL' AND jsonb_typeof(cached_result) = 'object' AND failure_code IS NOT NULL AND completed_at IS NOT NULL)
  )
);

ALTER TABLE verifier.verification_challenges
  ADD CONSTRAINT fk_verification_challenges_use
  FOREIGN KEY (use_id) REFERENCES verifier.use_records (use_id);

CREATE INDEX ix_use_records_status_created
  ON verifier.use_records (status, created_at);

CREATE FUNCTION verifier.reject_use_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.demo_run_id IS DISTINCT FROM OLD.demo_run_id
    OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
    OR NEW.nullifier_key IS DISTINCT FROM OLD.nullifier_key
    OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.intent_digest IS DISTINCT FROM OLD.intent_digest
    OR NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ck_use_records_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER use_records_identity_immutable
BEFORE UPDATE ON verifier.use_records
FOR EACH ROW EXECUTE FUNCTION verifier.reject_use_identity_mutation();

CREATE TABLE verifier.outbox_events (
  event_id uuid PRIMARY KEY,
  use_id uuid NOT NULL,
  event_type text NOT NULL,
  action_key varchar(76) NOT NULL,
  payload_digest varchar(71) NOT NULL,
  safe_payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'READY',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  CONSTRAINT fk_outbox_events_use
    FOREIGN KEY (use_id) REFERENCES verifier.use_records (use_id),
  CONSTRAINT uq_outbox_events_use_type UNIQUE (use_id, event_type),
  CONSTRAINT ck_outbox_events_type CHECK (event_type = 'COMMIT_DEMO_ACTION'),
  CONSTRAINT ck_outbox_events_action_key
    CHECK (action_key ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_outbox_events_payload_digest
    CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_outbox_events_payload CHECK (jsonb_typeof(safe_payload) = 'object'),
  CONSTRAINT ck_outbox_events_state
    CHECK (state IN ('READY', 'LEASED', 'DELIVERED', 'DEAD_LETTER')),
  CONSTRAINT ck_outbox_events_attempt_count CHECK (attempt_count >= 0),
  CONSTRAINT ck_outbox_events_delivery_state CHECK (
    (state = 'READY' AND lease_until IS NULL AND delivered_at IS NULL)
    OR (state = 'LEASED' AND lease_until IS NOT NULL AND delivered_at IS NULL)
    OR (state = 'DELIVERED' AND lease_until IS NULL AND delivered_at IS NOT NULL)
    OR (state = 'DEAD_LETTER' AND lease_until IS NULL AND delivered_at IS NULL)
  )
);

CREATE INDEX ix_outbox_events_claim
  ON verifier.outbox_events (state, next_attempt_at, created_at);

CREATE FUNCTION verifier.reject_outbox_identity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.use_id IS DISTINCT FROM OLD.use_id
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.action_key IS DISTINCT FROM OLD.action_key
    OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
    OR NEW.safe_payload IS DISTINCT FROM OLD.safe_payload
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'ck_outbox_events_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_events_identity_immutable
BEFORE UPDATE ON verifier.outbox_events
FOR EACH ROW EXECUTE FUNCTION verifier.reject_outbox_identity_mutation();

CREATE TABLE verifier.protocol_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  event_name text NOT NULL,
  trace_id uuid NOT NULL,
  demo_run_id uuid NOT NULL,
  policy_id varchar(128) NOT NULL,
  policy_version integer NOT NULL,
  from_state text,
  to_state text,
  decision_code text,
  usage_delta integer NOT NULL,
  action_delta integer NOT NULL,
  latency_ms integer,
  masked_use_ref varchar(16),
  CONSTRAINT uq_protocol_events_event_id UNIQUE (event_id),
  CONSTRAINT fk_protocol_events_run
    FOREIGN KEY (demo_run_id) REFERENCES verifier.demo_runs (demo_run_id),
  CONSTRAINT fk_protocol_events_policy
    FOREIGN KEY (policy_id, policy_version)
    REFERENCES verifier.quota_policies (policy_id, version),
  CONSTRAINT ck_protocol_events_name CHECK (event_name IN (
    'CREDENTIAL_ISSUED', 'PRESENTATION_RECEIVED', 'PROOF_ACCEPTED', 'USE_ACCEPTED',
    'ACTION_DISPATCH_STARTED', 'EXTERNAL_ACTION_COMMITTED', 'RECEIPT_STORED',
    'ACK_DROPPED', 'RETRY_MATCHED', 'CACHED_RECEIPT_RETURNED', 'NULLIFIER_CONFLICT',
    'OVER_LIMIT_REJECTED', 'PRIVACY_AUDIT_COMPLETED', 'RETRY_IN_PROGRESS',
    'RETRY_RESOLVED', 'PRESENTATION_REJECTED', 'USE_FAILED_FINAL', 'DEMO_RESET'
  )),
  CONSTRAINT ck_protocol_events_state CHECK (
    (from_state IS NULL OR from_state IN ('UNSEEN', 'REJECTED', 'ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL'))
    AND (to_state IS NULL OR to_state IN ('UNSEEN', 'REJECTED', 'ACCEPTED_PENDING_ACTION', 'SUCCEEDED', 'FAILED_FINAL'))
  ),
  CONSTRAINT ck_protocol_events_deltas CHECK (
    usage_delta IN (0, 1) AND action_delta IN (0, 1)
  ),
  CONSTRAINT ck_protocol_events_latency CHECK (
    latency_ms IS NULL OR latency_ms BETWEEN 0 AND 86400000
  ),
  CONSTRAINT ck_protocol_events_masked_ref CHECK (
    masked_use_ref IS NULL OR masked_use_ref ~ '^use_[a-f0-9]{12}$'
  )
);

CREATE INDEX ix_protocol_events_run_sequence
  ON verifier.protocol_events (demo_run_id, sequence);

CREATE TABLE verifier.demo_faults (
  fault_name varchar(64) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  one_shot boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_demo_faults_name
    CHECK (fault_name IN ('DROP_NEXT_ACK', 'FAIL_NEXT_ACTION', 'CRASH_NEXT_WORKER'))
);

ALTER DEFAULT PRIVILEGES IN SCHEMA verifier
  REVOKE SELECT, INSERT, UPDATE ON TABLES FROM verifier_worker;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA verifier FROM verifier_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA verifier TO verifier_api;
GRANT SELECT, UPDATE ON verifier.use_records, verifier.outbox_events TO verifier_worker;
GRANT SELECT, INSERT ON verifier.protocol_events TO verifier_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA verifier TO verifier_api, verifier_worker;
