import { checkDatabaseConnection, pool } from '../db/index.js';
import { artifactStorage } from '../storage/artifactStorage.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  components: {
    database: {
      status: 'healthy' | 'unhealthy';
      latencyMs: number;
      error?: string;
      tablesPresent?: string[];
      missingTables?: string[];
    };
    storage: {
      status: 'healthy' | 'unhealthy';
      root: string;
      writeable: boolean;
      readable: boolean;
      error?: string;
    };
  };
}

const REQUIRED_TABLES = [
  'pages',
  'monitor_runs',
  'page_versions',
  'page_diffs',
  'webhook_events',
  'processing_jobs',
];

export async function performHealthCheck(): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    components: {
      database: { status: 'healthy', latencyMs: 0 },
      storage: { status: 'healthy', root: artifactStorage.getStorageRoot(), writeable: false, readable: false },
    },
  };

  // 1. Check Database
  const dbPing = await checkDatabaseConnection();
  result.components.database.latencyMs = dbPing.latencyMs;

  if (!dbPing.ok) {
    result.components.database.status = 'unhealthy';
    result.components.database.error = dbPing.message;
    result.status = 'unhealthy';
  } else {
    try {
      const res = await pool.query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public';
      `);
      const existingTables = new Set(res.rows.map((r) => r.table_name));
      const tablesPresent = REQUIRED_TABLES.filter((t) => existingTables.has(t));
      const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

      result.components.database.tablesPresent = tablesPresent;
      if (missingTables.length > 0) {
        result.components.database.status = 'unhealthy';
        result.components.database.missingTables = missingTables;
        result.components.database.error = `Missing required tables: ${missingTables.join(', ')}`;
        result.status = 'unhealthy';
      }
    } catch (err) {
      result.components.database.status = 'unhealthy';
      result.components.database.error = (err as Error).message;
      result.status = 'unhealthy';
    }
  }

  // 2. Check Storage
  try {
    const root = artifactStorage.getStorageRoot();
    await fs.mkdir(root, { recursive: true });

    const testFileName = `.health-probe-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    const testFilePath = path.join(root, testFileName);
    const testPayload = 'health-check-ok';

    // Test write
    await fs.writeFile(testFilePath, testPayload, 'utf-8');
    result.components.storage.writeable = true;

    // Test read
    const readBack = await fs.readFile(testFilePath, 'utf-8');
    if (readBack === testPayload) {
      result.components.storage.readable = true;
    } else {
      throw new Error('Storage readback payload mismatch');
    }

    // Clean up
    await fs.unlink(testFilePath).catch(() => {});
  } catch (err) {
    result.components.storage.status = 'unhealthy';
    result.components.storage.error = (err as Error).message;
    if (result.status === 'healthy') {
      result.status = 'degraded';
    }
  }

  if (result.status !== 'healthy') {
    logger.warn('Health check detected issue', { result });
  }

  return result;
}
