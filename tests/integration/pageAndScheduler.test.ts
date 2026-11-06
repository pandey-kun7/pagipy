import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pageService } from '../../src/backend/services/pageService.js';
import { runCoordinator } from '../../src/backend/services/runCoordinator.js';
import { schedulerService } from '../../src/backend/services/schedulerService.js';
import { query, closeDatabase } from '../../src/backend/db/index.js';
import { runMigrations } from '../../src/backend/db/migrate.js';
import { cleanupPageIds } from '../testCleanup.js';
import { v4 as uuidv4 } from 'uuid';

describe('Page Management and Scheduler Integration', () => {
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await cleanupPageIds(createdPageIds);
    await closeDatabase();
  });

  it('creates a page, validates URL, and computes initial next_run_at', async () => {
    const uniqueDomain = `test-${Date.now()}.example.org`;
    const page = await pageService.createPage({
      name: 'Test Pricing Page',
      url: `https://${uniqueDomain}/pricing`,
      category: 'SaaS pricing',
      monitor_objective: 'Check monthly and annual pricing tiers',
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    expect(page.id).toBeDefined();
    expect(page.status).toBe('active');
    expect(page.canonical_url).toBe(`https://${uniqueDomain}/pricing`);
    expect(page.next_run_at).not.toBeNull();
  });

  it('prevents duplicate page entries with the same canonical URL', async () => {
    const uniqueDomain = `dup-${Date.now()}.example.org`;
    const orig = await pageService.createPage({
      name: 'Original Page',
      url: `https://${uniqueDomain}/terms`,
      schedule_type: 'daily',
      schedule_timezone: 'UTC',
      schedule_hour: 12,
      schedule_minute: 0,
    });
    createdPageIds.push(orig.id);

    // Attempt to create duplicate with tracking parameter which normalizes to same canonical URL
    await expect(
      pageService.createPage({
        name: 'Duplicate Attempt',
        url: `https://${uniqueDomain}/terms?utm_source=ad`,
        schedule_type: 'daily',
        schedule_timezone: 'UTC',
        schedule_hour: 12,
        schedule_minute: 0,
      })
    ).rejects.toThrow(/already exists/);
  });

  it('supports pause, resume, and archive lifecycles', async () => {
    const page = await pageService.createPage({
      url: `https://lifecycle-${Date.now()}.example.org/policy`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    // 1. Pause
    const paused = await pageService.pausePage(page.id);
    expect(paused.status).toBe('paused');
    expect(paused.next_run_at).toBeNull();

    // 2. Resume
    const resumed = await pageService.resumePage(page.id);
    expect(resumed.status).toBe('active');
    expect(resumed.next_run_at).not.toBeNull();

    // 3. Archive
    const archived = await pageService.archivePage(page.id);
    expect(archived.status).toBe('archived');
    expect(archived.next_run_at).toBeNull();
    expect(archived.archived_at).not.toBeNull();
  });

  it('triggers a manual run and debounces duplicate in-flight requests', async () => {
    const page = await pageService.createPage({
      url: `https://manual-${Date.now()}.example.org/status`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const run1 = await runCoordinator.triggerManualRun(page.id);
    expect(run1.page_id).toBe(page.id);
    expect(run1.trigger_type).toBe('manual');
    expect(['queued', 'running', 'succeeded']).toContain(run1.status);

    // Simulate an in-flight run for debouncing test
    await query(`UPDATE monitor_runs SET status = 'running' WHERE id = $1`, [run1.id]);

    // Second immediate manual trigger while run1 is in flight
    const run2 = await runCoordinator.triggerManualRun(page.id);
    expect(run2.id).toBe(run1.id); // Debounced to existing in-flight run
  });

  it('scheduler claims due pages, advances next_run_at, and prevents duplicate cron runs', async () => {
    const page = await pageService.createPage({
      url: `https://sched-${Date.now()}.example.org/news`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    // Force page next_run_at into the past so it is guaranteed to be earliest due
    const pastDate = new Date(Date.now() - 3600000);
    await query('UPDATE pages SET next_run_at = $1 WHERE id = $2', [pastDate, page.id]);

    // Tick scheduler
    const tickResult1 = await schedulerService.tick();
    expect(tickResult1.pagesConsidered).toBeGreaterThanOrEqual(1);

    // Verify page's next_run_at was advanced into the future
    const updatedPage = await pageService.getPage(page.id);
    expect(new Date(updatedPage!.next_run_at!).getTime()).toBeGreaterThan(Date.now());

    // Verify a scheduled run was created in monitor_runs
    const runsRes = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM monitor_runs WHERE page_id = $1 AND trigger_type = 'scheduled'`,
      [page.id]
    );
    expect(parseInt(runsRes.rows[0].count, 10)).toBe(1);

    // Immediate second tick should not claim the same page or create duplicates
    const tickResult2 = await schedulerService.tick();
    const runsRes2 = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM monitor_runs WHERE page_id = $1 AND trigger_type = 'scheduled'`,
      [page.id]
    );
    expect(parseInt(runsRes2.rows[0].count, 10)).toBe(1);
  });
});
