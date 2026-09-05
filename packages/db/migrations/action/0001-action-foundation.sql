CREATE TABLE action_sim.action_results (
  action_key varchar(76) PRIMARY KEY,
  demo_run_id uuid NOT NULL,
  payload_digest varchar(71) NOT NULL,
  receipt jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_action_results_action_key
    CHECK (action_key ~ '^hmac-sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_action_results_payload_digest
    CHECK (payload_digest ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ck_action_results_receipt CHECK (jsonb_typeof(receipt) = 'object')
);

CREATE INDEX ix_action_results_run_committed
  ON action_sim.action_results (demo_run_id, committed_at);

CREATE TABLE action_sim.action_faults (
  fault_name varchar(64) PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  one_shot boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ck_action_faults_name
    CHECK (fault_name IN ('FAIL_NEXT_ACTION', 'DELAY_NEXT_ACTION'))
);

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA action_sim TO action_service;
