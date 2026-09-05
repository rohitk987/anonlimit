CREATE TABLE action_sim.reset_demo_runs (
  demo_run_id uuid PRIMARY KEY,
  reset_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

GRANT SELECT, INSERT ON action_sim.reset_demo_runs TO action_service;
GRANT DELETE ON action_sim.action_results TO action_service;
