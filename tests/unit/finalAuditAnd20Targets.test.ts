import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { query, closeDatabase } from '../../src/backend/db/index.js';
import { pageService } from '../../src/backend/services/pageService.js';
import { runCoordinator } from '../../src/backend/services/runCoordinator.js';
import { versionService } from '../../src/backend/services/versionService.js';
import { historyService } from '../../src/backend/services/historyService.js';
import { fetchAdapter } from '../../src/backend/adapters/tinyfish/fetchAdapter.js';
import { searchAdapter } from '../../src/backend/adapters/tinyfish/searchAdapter.js';
import { OFFICIAL_20_TARGETS } from '../../src/backend/db/seed20Pages.js';
import { ITinyFishBrowserAdapter, ITinyFishMonitorAdapter } from '../../src/backend/adapters/tinyfish/types.js';

describe('Final Audit, 20 Targets & Evidence Resilience Tests', () => {
  let testPageId: string;

  beforeAll(async () => {
    const page = await pageService.createPage({
      name: 'Resilience Audit Target',
      url: `https://example.com/audit-${Date.now()}`,
      category: 'SaaS pricing',
      schedule_type: 'daily',
      schedule_timezone: 'Asia/Kolkata',
      schedule_hour: 9,
      schedule_minute: 0,
      monitor_objective: 'Verify paired execution, unchanged deduplication, and as-of boundaries',
    });
    testPageId = page.id;
  });

  afterAll(async () => {
    if (testPageId) {
      await query('DELETE FROM pages WHERE id = $1', [testPageId]).catch(() => {});
    }
  });

  it('verifies the 20 official targets definition matches Part B specification', () => {
    expect(OFFICIAL_20_TARGETS).toHaveLength(20);

    // Targets 7 & 8 must be hourly
    const ghChangelog = OFFICIAL_20_TARGETS.find((t) => t.index === 7);
    const cfChangelog = OFFICIAL_20_TARGETS.find((t) => t.index === 8);
    expect(ghChangelog?.schedule_type).toBe('hourly');
    expect(cfChangelog?.schedule_type).toBe('hourly');

    // Remaining 18 targets must be daily at 09:00 IST
    const dailyTargets = OFFICIAL_20_TARGETS.filter((t) => t.index !== 7 && t.index !== 8);
    expect(dailyTargets).toHaveLength(18);
    for (const target of dailyTargets) {
      expect(target.schedule_type).toBe('daily');
      expect(target.schedule_hour).toBe(9);
      expect(target.schedule_minute).toBe(0);
      expect(target.schedule_timezone).toBe('Asia/Kolkata');
    }
  });

  it('creates an initial baseline version and flags is_baseline = true', async () => {
    const mockMonitor: ITinyFishMonitorAdapter = {
      setupMonitor: async () => ({ monitorExternalId: 'tf-mon-test-1', setupStatus: 'active' }),
      triggerCheck: async () => ({
        success: true,
        isAsync: false,
        outcome: 'baseline',
        contentMarkdown: '# Plan Pricing\n\n- Starter: $10/mo\n- Pro: $30/mo',
        externalRunId: 'ext-run-1',
      }),
    };

    const mockBrowser: ITinyFishBrowserAdapter = {
      captureScreenshot: async () => ({
        success: true,
        screenshotBuffer: Buffer.from('fake-png-bytes'),
      }),
    };

    const run = await runCoordinator.triggerManualRun(testPageId, {
      monitorAdapter: mockMonitor,
      browserAdapter: mockBrowser,
    });

    expect(run.status).toBe('succeeded');
    expect(run.version_id).toBeDefined();

    const version = await versionService.getVersionById(run.version_id!);
    expect(version).not.toBeNull();
    expect(version?.version_number).toBe(1);
    expect(version?.is_baseline).toBe(true);
    expect(version?.screenshot_artifact_path).toContain('screenshot.png');
  });

  it('links unchanged runs to latest version without creating a duplicate version', async () => {
    const versionsBefore = await versionService.getVersionsForPage(testPageId);
    expect(versionsBefore).toHaveLength(1);
    const baselineVerId = versionsBefore[0].id;

    const mockMonitorUnchanged: ITinyFishMonitorAdapter = {
      setupMonitor: async () => ({ monitorExternalId: 'tf-mon-test-1', setupStatus: 'active' }),
      triggerCheck: async () => ({
        success: true,
        isAsync: false,
        outcome: 'unchanged',
        contentMarkdown: '# Plan Pricing\n\n- Starter: $10/mo\n- Pro: $30/mo', // exactly identical content
        externalRunId: 'ext-run-unchanged-2',
      }),
    };

    const mockBrowser: ITinyFishBrowserAdapter = {
      captureScreenshot: async () => ({
        success: true,
        screenshotBuffer: Buffer.from('fake-png-bytes-run-2'),
      }),
    };

    const run2 = await runCoordinator.triggerManualRun(testPageId, {
      monitorAdapter: mockMonitorUnchanged,
      browserAdapter: mockBrowser,
    });

    expect(run2.status).toBe('succeeded');
    expect(run2.monitor_outcome).toBe('unchanged');
    expect(run2.version_id).toBe(baselineVerId); // Links to existing baseline!

    // Verify no duplicate version was created
    const versionsAfter = await versionService.getVersionsForPage(testPageId);
    expect(versionsAfter).toHaveLength(1);
  });

  it('creates Version 2 when meaningful content change is detected', async () => {
    const mockMonitorChanged: ITinyFishMonitorAdapter = {
      setupMonitor: async () => ({ monitorExternalId: 'tf-mon-test-1', setupStatus: 'active' }),
      triggerCheck: async () => ({
        success: true,
        isAsync: false,
        outcome: 'changed',
        contentMarkdown: '# Plan Pricing\n\n- Starter: $15/mo\n- Pro: $45/mo\n- Enterprise: Custom',
        externalRunId: 'ext-run-changed-3',
      }),
    };

    const mockBrowser: ITinyFishBrowserAdapter = {
      captureScreenshot: async () => ({
        success: true,
        screenshotBuffer: Buffer.from('fake-png-bytes-run-3'),
      }),
    };

    const run3 = await runCoordinator.triggerManualRun(testPageId, {
      monitorAdapter: mockMonitorChanged,
      browserAdapter: mockBrowser,
    });

    expect(run3.status).toBe('succeeded');
    expect(run3.version_id).toBeDefined();

    const versions = await versionService.getVersionsForPage(testPageId);
    expect(versions).toHaveLength(2);
    expect(versions[0].version_number).toBe(2);
    expect(versions[0].is_baseline).toBe(false);
  });

  it('defers version creation and marks partial_success when browser capture fails', async () => {
    const versionsBefore = await versionService.getVersionsForPage(testPageId);
    expect(versionsBefore).toHaveLength(2);

    const mockMonitorChanged: ITinyFishMonitorAdapter = {
      setupMonitor: async () => ({ monitorExternalId: 'tf-mon-test-1', setupStatus: 'active' }),
      triggerCheck: async () => ({
        success: true,
        isAsync: false,
        outcome: 'changed',
        contentMarkdown: '# Plan Pricing\n\n- Starter: $99/mo (Major price hike)',
      }),
    };

    const mockBrowserFail: ITinyFishBrowserAdapter = {
      captureScreenshot: async () => ({
        success: false,
        errorCode: 'CDP_TIMEOUT',
        errorMessage: 'Remote browser session timed out',
      }),
    };

    const runFail = await runCoordinator.triggerManualRun(testPageId, {
      monitorAdapter: mockMonitorChanged,
      browserAdapter: mockBrowserFail,
    });

    expect(runFail.status).toBe('partial_success');
    expect(runFail.monitor_status).toBe('succeeded');
    expect(runFail.browser_status).toBe('failed');

    // Crucial: No new version created without genuine screenshot
    const versionsAfter = await versionService.getVersionsForPage(testPageId);
    expect(versionsAfter).toHaveLength(2);
  });

  it('strictly enforces as-of cutoff boundary with zero future leakage', async () => {
    const versions = await versionService.getVersionsForPage(testPageId);
    // Sort chronologically (v1 then v2)
    const sorted = [...versions].sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
    const v1 = sorted[0];
    const v2 = sorted[1];

    const v1Time = new Date(v1.observed_at).getTime();
    const v2Time = new Date(v2.observed_at).getTime();

    // 1. Query before baseline: must throw / return null
    const beforeBaseline = new Date(v1Time - 3600000);
    const asOfBefore = await historyService.resolveAsOfVersion(testPageId, beforeBaseline);
    expect(asOfBefore).toBeNull();

    // 2. Query at exact v1 timestamp: returns v1
    const asOfV1 = await historyService.resolveAsOfVersion(testPageId, new Date(v1Time));
    expect(asOfV1?.id).toBe(v1.id);
    expect(asOfV1?.version_number).toBe(1);

    // 3. Query between v1 and v2: strictly returns v1 (NEVER returns v2)
    const betweenV1AndV2 = new Date(v1Time + Math.floor((v2Time - v1Time) / 2));
    const asOfBetween = await historyService.resolveAsOfVersion(testPageId, betweenV1AndV2);
    expect(asOfBetween?.id).toBe(v1.id);
    expect(asOfBetween?.version_number).toBe(1);

    // 4. Query after v2: returns v2
    const afterV2 = new Date(v2Time + 3600000);
    const asOfAfter = await historyService.resolveAsOfVersion(testPageId, afterV2);
    expect(asOfAfter?.id).toBe(v2.id);
    expect(asOfAfter?.version_number).toBe(2);
  });

  it('validates Fetch preflight and Search discovery functions', async () => {
    const preflight = await fetchAdapter.preflightUrl('https://github.com/pricing');
    expect(preflight.success).toBe(true);
    expect(preflight.submittedUrl).toBe('https://github.com/pricing');
    expect(preflight.suitableForMonitoring).toBe(true);

    const searchPricing = await searchAdapter.searchOfficialPages('pricing');
    expect(searchPricing.length).toBeGreaterThan(0);
    expect(searchPricing.some((c) => c.title.includes('Pricing') || c.category.includes('pricing'))).toBe(true);

    const searchChangelog = await searchAdapter.searchOfficialPages('changelog');
    expect(searchChangelog.length).toBeGreaterThan(0);
    expect(searchChangelog.some((c) => c.title.includes('Changelog'))).toBe(true);
  });

  it('generates a Gemma summary for an individual page version from its snapshot.md', async () => {
    const versions = await versionService.getVersionsForPage(testPageId);
    expect(versions.length).toBeGreaterThan(0);
    const targetVer = versions[0];

    const result = await historyService.getVersionSummary(testPageId, targetVer.id);
    expect(result).toBeDefined();
    expect(result.summary.executiveSummary).toBeTruthy();
    expect(result.summary.keyPoints.length).toBeGreaterThan(0);
    expect(result.snapshotLength).toBeGreaterThan(0);

    const snapshot = await historyService.getVersionSnapshotMarkdown(testPageId, targetVer.id);
    expect(snapshot.markdown).toBeTruthy();
    expect(snapshot.markdown).toContain('Plan Pricing');
  }, 25000);
});
