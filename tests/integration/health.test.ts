import { describe, it, expect, afterAll } from 'vitest';
import { performHealthCheck } from '../../src/backend/services/healthService.js';
import { closeDatabase } from '../../src/backend/db/index.js';
import { createServer } from '../../src/backend/server.js';
import http from 'http';

describe('Health and System Foundation Integration', () => {
  afterAll(async () => {
    await closeDatabase();
  });

  it('performs full health check against running PostgreSQL and Storage', async () => {
    const health = await performHealthCheck();

    expect(health.status).toBe('healthy');
    expect(health.components.database.status).toBe('healthy');
    expect(health.components.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(health.components.database.missingTables).toBeUndefined();
    expect(health.components.storage.status).toBe('healthy');
    expect(health.components.storage.writeable).toBe(true);
    expect(health.components.storage.readable).toBe(true);
  });

  it('serves /api/health and /api/health/live via Express server', async () => {
    const app = createServer();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };

    try {
      const liveRes = await fetch(`http://localhost:${addr.port}/api/health/live`);
      expect(liveRes.status).toBe(200);
      const liveData = await liveRes.json();
      expect(liveData.status).toBe('live');

      const healthRes = await fetch(`http://localhost:${addr.port}/api/health`);
      expect(healthRes.status).toBe(200);
      const healthData = await healthRes.json();
      expect(healthData.status).toBe('healthy');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
