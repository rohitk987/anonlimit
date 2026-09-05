REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'verifier_api') THEN
    EXECUTE format(
      'CREATE ROLE verifier_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.api_db_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE verifier_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.api_db_password')
    );
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'verifier_worker') THEN
    EXECUTE format(
      'CREATE ROLE verifier_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.worker_db_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE verifier_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.worker_db_password')
    );
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'action_service') THEN
    EXECUTE format(
      'CREATE ROLE action_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.action_db_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE action_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      current_setting('anonlimit.action_db_password')
    );
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evidence_reader') THEN
    CREATE ROLE evidence_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  ELSE
    ALTER ROLE evidence_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS verifier;
CREATE SCHEMA IF NOT EXISTS action_sim;

REVOKE ALL ON SCHEMA verifier, action_sim FROM PUBLIC;
GRANT USAGE ON SCHEMA verifier TO verifier_api, verifier_worker;
GRANT USAGE ON SCHEMA action_sim TO action_service;

ALTER DEFAULT PRIVILEGES IN SCHEMA verifier
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verifier_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA action_sim
  GRANT SELECT, INSERT, UPDATE ON TABLES TO action_service;
