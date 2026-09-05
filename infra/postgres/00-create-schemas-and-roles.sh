#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=api_password="$API_DB_PASSWORD" --set=worker_password="$WORKER_DB_PASSWORD" --set=action_password="$ACTION_DB_PASSWORD" <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE ROLE verifier_api LOGIN PASSWORD :'api_password';
CREATE ROLE verifier_worker LOGIN PASSWORD :'worker_password';
CREATE ROLE action_service LOGIN PASSWORD :'action_password';
CREATE ROLE evidence_reader NOLOGIN;
CREATE SCHEMA verifier;
CREATE SCHEMA action_sim;
GRANT USAGE ON SCHEMA verifier TO verifier_api, verifier_worker;
GRANT USAGE ON SCHEMA action_sim TO action_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA verifier GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verifier_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA verifier GRANT SELECT, INSERT, UPDATE ON TABLES TO verifier_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA action_sim GRANT SELECT, INSERT, UPDATE ON TABLES TO action_service;
SQL
