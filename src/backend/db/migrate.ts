import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, withTransaction } from './index.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<string[]> {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedMigrations: string[] = [];

  for (const file of files) {
    const version = path.basename(file, '.sql');

    const checkRes = await pool.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version]
    );

    if (checkRes.rowCount && checkRes.rowCount > 0) {
      logger.debug(`Migration ${version} already applied, skipping.`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = await fs.readFile(filePath, 'utf-8');

    await withTransaction(async (client) => {
      logger.info(`Applying migration: ${version}`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version]
      );
    });

    appliedMigrations.push(version);
    logger.info(`Successfully applied migration: ${version}`);
  }

  return appliedMigrations;
}

// Allow direct CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((applied) => {
      console.log(`Migrations complete. Applied: ${applied.length}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
