import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

export const pool =
  global._pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function logAudit(actorId: string | null, actorName: string, table: string, recordId: string | null, action: string) {
  await query(
    `INSERT INTO audit_log (user_id, actor_name, table_name, record_id, action) VALUES ($1,$2,$3,$4,$5)`,
    [actorId, actorName, table, recordId, action]
  );
}
