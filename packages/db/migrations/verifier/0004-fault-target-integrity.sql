ALTER TABLE verifier.demo_faults
  ADD CONSTRAINT fk_demo_faults_run
    FOREIGN KEY (demo_run_id) REFERENCES verifier.demo_runs (demo_run_id),
  ADD CONSTRAINT ck_demo_faults_drop_ack_target CHECK (
    fault_name <> 'DROP_NEXT_ACK'
    OR NOT enabled
    OR (one_shot AND demo_run_id IS NOT NULL AND operation_id IS NOT NULL)
  );
