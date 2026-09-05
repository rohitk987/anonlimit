import pg from "pg";

export function createConnection(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    query_timeout: 3000,
    statement_timeout: 3000,
  });
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
