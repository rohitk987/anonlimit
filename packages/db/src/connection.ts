import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    query_timeout: 3000,
    statement_timeout: 3000,
  });
}

export function createConnectionLifecycle(pool: pg.Pool) {
  let idleFailure = false;
  // Surface idle-client failures at the next readiness check; pg removes the failed client.
  pool.on("error", () => {
    idleFailure = true;
  });
  return {
    async check(): Promise<void> {
      if (idleFailure) {
        idleFailure = false;
        throw new Error("DATABASE_UNAVAILABLE");
      }
      await pool.query("SELECT 1");
    },
    async close(): Promise<void> {
      await pool.end();
    },
  };
}

export function createConnection(connectionString: string) {
  return createConnectionLifecycle(createPool(connectionString));
}
