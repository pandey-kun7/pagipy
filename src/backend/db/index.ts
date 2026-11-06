import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected idle client error in PostgreSQL pool', err);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  logger.debug('Executed query', { query: text, durationMs: duration, rows: res.rowCount ?? 0 });
  return res;
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseConnection(): Promise<{ ok: boolean; message?: string; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await pool.query('SELECT 1 as ping');
    const latencyMs = Date.now() - start;
    if (res.rows[0]?.ping === 1) {
      return { ok: true, latencyMs };
    }
    return { ok: false, message: 'Invalid ping response', latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, message: (err as Error).message, latencyMs };
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
