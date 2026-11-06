import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/backend/server.js';
import { runMigrations } from '../../src/backend/db/migrate.js';
import { closeDatabase } from '../../src/backend/db/index.js';
import { cleanupPageIds } from '../testCleanup.js';
import http from 'http';

describe('Frontend and Application Endpoints Integration', () => {
  let server: http.Server;
  let baseUrl: string;
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
    const app = createServer();
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://localhost:${addr.port}`;
  });

  afterAll(async () => {
    await cleanupPageIds(createdPageIds);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeDatabase();
  });

  it('serves the frontend Single Page Application at root /', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('pagipy');
    expect(html).toContain('Agentic Webpage History');
  });

  it('provides dashboard stats endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/pages/stats`);
    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats.total).toBeDefined();
    expect(stats.active).toBeDefined();
  });

  it('completes the full flow: create monitor -> run -> timeline -> compare -> ask', async () => {
    // 1. Create monitor
    const uniqueDomain = `flow-${Date.now()}.example.org`;
    const createRes = await fetch(`${baseUrl}/api/pages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `https://${uniqueDomain}/pricing`,
        name: 'Flow Pricing Test',
        schedule_type: 'hourly',
        schedule_timezone: 'UTC',
      }),
    });
    expect(createRes.status).toBe(201);
    const page = await createRes.json();
    expect(page.id).toBeDefined();
    createdPageIds.push(page.id);

    // 2. Trigger paired manual run
    const runRes = await fetch(`${baseUrl}/api/pages/${page.id}/run`, { method: 'POST' });
    expect(runRes.status).toBe(202);
    const run = await runRes.json();
    expect(run.id).toBeDefined();

    // 3. Verify timeline has the initial baseline version created by the run
    let timeline: any[] = [];
    for (let i = 0; i < 20; i++) {
      const timelineRes = await fetch(`${baseUrl}/api/pages/${page.id}/timeline`);
      timeline = await timelineRes.json();
      if (timeline.length >= 1) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(timeline.length).toBeGreaterThanOrEqual(1);
    const v1 = timeline[0];
    expect(v1.version_number).toBe(1);

    // 4. Compare baseline version
    const compareRes = await fetch(`${baseUrl}/api/pages/${page.id}/compare?to=${v1.id}`);
    expect(compareRes.status).toBe(200);
    const compData = await compareRes.json();
    expect(compData.diff).toBeDefined();

    // 5. Ask historical question as of now
    const askRes = await fetch(`${baseUrl}/api/pages/${page.id}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asOfDate: new Date().toISOString(),
        question: 'What is the monitoring objective?',
      }),
    });
    expect(askRes.status).toBe(200);
    const answerData = await askRes.json();
    expect(answerData.answer).toContain('Objective');
    expect(answerData.version.id).toBe(v1.id);
  }, 35000);
});
