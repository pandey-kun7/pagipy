import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCoordinator } from '../../src/backend/services/runCoordinator.js';
import { pageService } from '../../src/backend/services/pageService.js';
import { runMigrations } from '../../src/backend/db/migrate.js';
import { closeDatabase } from '../../src/backend/db/index.js';
import { artifactStorage } from '../../src/backend/storage/artifactStorage.js';
import { cleanupPageIds } from '../testCleanup.js';
import {
  ITinyFishMonitorAdapter,
  ITinyFishBrowserAdapter,
} from '../../src/backend/adapters/tinyfish/types.js';

describe('Run Coordinator Paired Execution Integration', () => {
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await cleanupPageIds(createdPageIds);
    await closeDatabase();
  });

  it('invokes both Monitor and Browser and marks run succeeded when both pass', async () => {
    const page = await pageService.createPage({
      url: `https://run-coord-${Date.now()}.example.org/both-success`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    let monitorCalled = false;
    let browserCalled = false;

    const mockMonitor: ITinyFishMonitorAdapter = {
      async setupMonitor() { return { monitorExternalId: 'm1', setupStatus: 'active' }; },
      async triggerCheck() {
        monitorCalled = true;
        return { success: true, isAsync: false, contentMarkdown: '# Success' };
      },
    };

    const mockBrowser: ITinyFishBrowserAdapter = {
      async captureScreenshot() {
        browserCalled = true;
        return {
          success: true,
          screenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        };
      },
    };

    const run = await runCoordinator.triggerManualRun(page.id, {
      monitorAdapter: mockMonitor,
      browserAdapter: mockBrowser,
    });

    expect(monitorCalled).toBe(true);
    expect(browserCalled).toBe(true);
    expect(run.status).toBe('succeeded');
    expect(run.monitor_status).toBe('succeeded');
    expect(run.browser_status).toBe('succeeded');
    expect(run.monitor_started_at).not.toBeNull();
    expect(run.browser_started_at).not.toBeNull();

    // Verify screenshot was durably stored for the run
    const screenshotVer = await artifactStorage.verifyArtifact(`pages/${page.id}/runs/${run.id}/screenshot.png`);
    expect(screenshotVer.exists).toBe(true);
    expect(screenshotVer.valid).toBe(true);
  });

  it('still invokes Browser when Monitor fails, resulting in partial_success', async () => {
    const page = await pageService.createPage({
      url: `https://run-coord-${Date.now()}.example.org/mon-fail`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    let browserCalled = false;

    const mockMonitorFail: ITinyFishMonitorAdapter = {
      async setupMonitor() { return { monitorExternalId: 'm1', setupStatus: 'active' }; },
      async triggerCheck() {
        throw new Error('Monitor network timeout');
      },
    };

    const mockBrowserSuccess: ITinyFishBrowserAdapter = {
      async captureScreenshot() {
        browserCalled = true;
        return {
          success: true,
          screenshotBuffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        };
      },
    };

    const run = await runCoordinator.triggerManualRun(page.id, {
      monitorAdapter: mockMonitorFail,
      browserAdapter: mockBrowserSuccess,
    });

    expect(browserCalled).toBe(true);
    expect(run.status).toBe('partial_success');
    expect(run.monitor_status).toBe('failed');
    expect(run.browser_status).toBe('succeeded');
    expect(run.error_message).toContain('Monitor network timeout');
  });

  it('still invokes Monitor when Browser fails, resulting in partial_success', async () => {
    const page = await pageService.createPage({
      url: `https://run-coord-${Date.now()}.example.org/browser-fail`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    let monitorCalled = false;

    const mockMonitorSuccess: ITinyFishMonitorAdapter = {
      async setupMonitor() { return { monitorExternalId: 'm1', setupStatus: 'active' }; },
      async triggerCheck() {
        monitorCalled = true;
        return { success: true, isAsync: false, contentMarkdown: '# Content' };
      },
    };

    const mockBrowserFail: ITinyFishBrowserAdapter = {
      async captureScreenshot() {
        throw new Error('Browser navigation failed');
      },
    };

    const run = await runCoordinator.triggerManualRun(page.id, {
      monitorAdapter: mockMonitorSuccess,
      browserAdapter: mockBrowserFail,
    });

    expect(monitorCalled).toBe(true);
    expect(run.status).toBe('partial_success');
    expect(run.monitor_status).toBe('succeeded');
    expect(run.browser_status).toBe('failed');
    expect(run.error_message).toContain('Browser navigation failed');
  });

  it('records failed status when both integrations fail', async () => {
    const page = await pageService.createPage({
      url: `https://run-coord-${Date.now()}.example.org/both-fail`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const mockMonitorFail: ITinyFishMonitorAdapter = {
      async setupMonitor() { return { monitorExternalId: 'm1', setupStatus: 'active' }; },
      async triggerCheck() { throw new Error('Monitor DNS failed'); },
    };

    const mockBrowserFail: ITinyFishBrowserAdapter = {
      async captureScreenshot() { throw new Error('Browser crashed'); },
    };

    const run = await runCoordinator.triggerManualRun(page.id, {
      monitorAdapter: mockMonitorFail,
      browserAdapter: mockBrowserFail,
    });

    expect(run.status).toBe('failed');
    expect(run.monitor_status).toBe('failed');
    expect(run.browser_status).toBe('failed');
    expect(run.error_message).toContain('Monitor DNS failed');
    expect(run.error_message).toContain('Browser crashed');
  });
});
