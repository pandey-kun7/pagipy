import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { diffEngine } from '../../src/backend/services/diffEngine.js';
import { gemmaAdapter } from '../../src/backend/adapters/llm/gemmaAdapter.js';
import { historyService } from '../../src/backend/services/historyService.js';
import { pageService } from '../../src/backend/services/pageService.js';
import { versionService } from '../../src/backend/services/versionService.js';
import { runCoordinator } from '../../src/backend/services/runCoordinator.js';
import { artifactStorage } from '../../src/backend/storage/artifactStorage.js';
import { runMigrations } from '../../src/backend/db/migrate.js';
import { closeDatabase } from '../../src/backend/db/index.js';
import { cleanupPageIds } from '../testCleanup.js';

describe('Deterministic Diff Engine and History Retrieval', () => {
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await cleanupPageIds(createdPageIds);
    await closeDatabase();
  });

  it('computes structured diff for additions, removals, and modifications', () => {
    const v1 = `# Pricing\n\nBasic: $10/mo\n\n# Features\n- Unlimited access\n\n# Support\nEmail only`;
    const v2 = `# Pricing\n\nBasic: $15/mo\nPro: $30/mo\n\n# Features\n- Unlimited access\n\n# Enterprise\nCall us for quote`;

    const diff = diffEngine.computeDiff(v1, v2);

    expect(diff.has_changes).toBe(true);
    expect(diff.summary_counts.modified).toBe(1); // Pricing changed
    expect(diff.summary_counts.added).toBe(1); // Enterprise added
    expect(diff.summary_counts.removed).toBe(1); // Support removed

    expect(diff.modified[0].section).toBe('Pricing');
    expect(diff.modified[0].before).toContain('$10/mo');
    expect(diff.modified[0].after).toContain('$15/mo');

    expect(diff.added[0].section).toBe('Enterprise');
    expect(diff.removed[0].section).toBe('Support');
  });

  it('detects no meaningful change when markdown content is identical', () => {
    const text = `# Terms\n\nSection 1: Rules`;
    const diff = diffEngine.computeDiff(text, text);

    expect(diff.has_changes).toBe(false);
    expect(diff.summary_counts.added).toBe(0);
    expect(diff.summary_counts.removed).toBe(0);
    expect(diff.summary_counts.modified).toBe(0);
  });

  it('generates predictable deterministic fallback summary without cloud LLM', () => {
    const diff = diffEngine.computeDiff(
      `# Pricing\nTier 1: $5`,
      `# Pricing\nTier 1: $10\n\n# Refund Policy\nNo refunds`
    );

    const fallback = gemmaAdapter.generateFallbackSummary(diff);
    expect(fallback.summary).toContain('1 modified');
    expect(fallback.summary).toContain('1 added');
    expect(fallback.significance).toBe('medium');
    expect(fallback.key_changes.length).toBeGreaterThan(0);
  });

  it('resolves as-of version accurately and never returns future versions', async () => {
    const page = await pageService.createPage({
      url: `https://as-of-${Date.now()}.example.org/policy`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Create Version 1 at 2026-11-01
    const t1 = new Date('2026-11-01T10:00:00.000Z');
    const { run: run1 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'scheduled', scheduledFor: t1 });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run1.id, screenshot: fakeScreenshot });
    const { version: v1 } = await versionService.createVersionForRun({
      pageId: page.id,
      runId: run1.id,
      contentMarkdown: '# Policy\nVersion 1',
      sourceUrl: page.canonical_url,
      observedAt: t1,
    });

    // Create Version 2 at 2026-11-03
    const t2 = new Date('2026-11-03T10:00:00.000Z');
    const { run: run2 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'scheduled', scheduledFor: t2 });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run2.id, screenshot: fakeScreenshot });
    const { version: v2 } = await versionService.createVersionForRun({
      pageId: page.id,
      runId: run2.id,
      contentMarkdown: '# Policy\nVersion 2: Updated',
      sourceUrl: page.canonical_url,
      observedAt: t2,
    });

    // Query 2026-10-31 (before v1) -> should be null
    const beforeAll = await historyService.resolveAsOfVersion(page.id, new Date('2026-10-31T00:00:00.000Z'));
    expect(beforeAll).toBeNull();

    // Query 2026-11-02 (between v1 and v2) -> must return v1, NEVER v2
    const midCutoff = await historyService.resolveAsOfVersion(page.id, new Date('2026-11-02T12:00:00.000Z'));
    expect(midCutoff).not.toBeNull();
    expect(midCutoff!.id).toBe(v1!.id);
    expect(midCutoff!.version_number).toBe(1);

    // Query 2026-11-04 (after v2) -> returns v2
    const afterAll = await historyService.resolveAsOfVersion(page.id, new Date('2026-11-04T00:00:00.000Z'));
    expect(afterAll).not.toBeNull();
    expect(afterAll!.id).toBe(v2!.id);
    expect(afterAll!.version_number).toBe(2);
  });

  it('compares any two arbitrary versions and dates', async () => {
    const page = await pageService.createPage({
      url: `https://cmp-${Date.now()}.example.org/rules`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const d1 = new Date('2026-11-01T10:00:00.000Z');
    const { run: run1 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'manual' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run1.id, screenshot: fakeScreenshot });
    const { version: v1 } = await versionService.createVersionForRun({
      pageId: page.id,
      runId: run1.id,
      contentMarkdown: '# Pricing\nFree: $0\nPro: $20',
      sourceUrl: page.canonical_url,
      observedAt: d1,
    });

    const d2 = new Date('2026-11-04T10:00:00.000Z');
    const { run: run2 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'manual' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run2.id, screenshot: fakeScreenshot });
    const { version: v2 } = await versionService.createVersionForRun({
      pageId: page.id,
      runId: run2.id,
      contentMarkdown: '# Pricing\nFree: $0\nPro: $35',
      sourceUrl: page.canonical_url,
      observedAt: d2,
    });

    // Pairwise comparison between v1 and v2
    const comp = await historyService.compareVersions(page.id, v1!.id, v2!.id);
    expect(comp.diff.has_changes).toBe(true);
    expect(comp.diff.modified[0].section).toBe('Pricing');
    expect(comp.diff.modified[0].after).toContain('$35');
    expect(comp.changeSummary).toBeDefined();

    // Date comparison (even with dates passed in reverse order)
    const dateComp = await historyService.compareDates(page.id, d2, d1);
    expect(dateComp.fromVersion?.id).toBe(v1!.id);
    expect(dateComp.toVersion.id).toBe(v2!.id);
  }, 35000);

  it('grounds historical question answers in archived markdown and cites version evidence', async () => {
    const page = await pageService.createPage({
      url: `https://qa-${Date.now()}.example.org/faq`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const obsDate = new Date('2026-11-02T15:00:00.000Z');

    const { run } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'manual' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run.id, screenshot: fakeScreenshot });
    const { version } = await versionService.createVersionForRun({
      pageId: page.id,
      runId: run.id,
      contentMarkdown: '# Cancellation Policy\n\nSubscriptions can be cancelled within 14 days for a full refund.',
      sourceUrl: page.canonical_url,
      observedAt: obsDate,
    });

    const qa = await historyService.askHistoricalQuestion(page.id, obsDate, 'What is the refund window?');

    expect(qa.version.id).toBe(version!.id);
    expect(qa.answer).toContain('14 days for a full refund');
    expect(qa.citedContentExcerpt).toContain('within 14 days');
    expect(qa.screenshotUrl).toContain('/api/artifacts/');
  }, 35000);
});
