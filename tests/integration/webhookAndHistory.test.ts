import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { webhookService } from '../../src/backend/services/webhookService.js';
import { pageService } from '../../src/backend/services/pageService.js';
import { runCoordinator } from '../../src/backend/services/runCoordinator.js';
import { versionService } from '../../src/backend/services/versionService.js';
import { query, closeDatabase } from '../../src/backend/db/index.js';
import { runMigrations } from '../../src/backend/db/migrate.js';
import { artifactStorage } from '../../src/backend/storage/artifactStorage.js';
import { cleanupPageIds } from '../testCleanup.js';
import { v4 as uuidv4 } from 'uuid';

describe('Webhook Ingestion and Immutable Version History Integration', () => {
  const createdPageIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await cleanupPageIds(createdPageIds);
    await closeDatabase();
  });

  it('ingests webhook event and deduplicates repeated deliveries idempotently', async () => {
    const eventId = `test-evt-${Date.now()}`;
    const payload = {
      eventId,
      eventType: 'ping',
      data: { hello: 'world' },
    };

    const first = await webhookService.ingestWebhookEvent(payload);
    expect(first.isDuplicate).toBe(false);
    expect(first.event.external_event_id).toBe(eventId);

    // Duplicate delivery
    const second = await webhookService.ingestWebhookEvent(payload);
    expect(second.isDuplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
  });

  it('creates baseline version when first event with content and screenshot is received', async () => {
    const page = await pageService.createPage({
      url: `https://ver-test-${Date.now()}.example.org/pricing`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    // Create a run record
    const { run } = await runCoordinator.createRunRecord({
      pageId: page.id,
      triggerType: 'scheduled',
    });

    // Save screenshot for the run
    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await artifactStorage.saveRunArtifacts({
      pageId: page.id,
      runId: run.id,
      screenshot: fakeScreenshot,
    });

    // Ingest baseline webhook event
    const { event } = await webhookService.ingestWebhookEvent({
      eventId: `baseline-${run.id}`,
      pageId: page.id,
      runId: run.id,
      eventType: 'baseline',
      contentMarkdown: '# Pricing Table\n\nTier 1: $10/mo',
    });

    const processed = await webhookService.processEvent(event.id);
    expect(processed.processing_status).toBe('processed');

    // Verify version 1 was created
    const versions = await versionService.getVersionsForPage(page.id);
    expect(versions.length).toBe(1);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].run_id).toBe(run.id);

    // Verify stored snapshot artifact
    const snapBuf = await artifactStorage.readArtifact(versions[0].content_artifact_path);
    expect(snapBuf.toString('utf-8')).toBe('# Pricing Table\n\nTier 1: $10/mo');
  });

  it('does NOT create a noisy version when run content is unchanged', async () => {
    const page = await pageService.createPage({
      url: `https://ver-unchanged-${Date.now()}.example.org/about`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Baseline run
    const { run: run1 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'manual' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run1.id, screenshot: fakeScreenshot });
    const { event: evt1 } = await webhookService.ingestWebhookEvent({
      eventId: `b-${run1.id}`,
      pageId: page.id,
      runId: run1.id,
      eventType: 'baseline',
      contentMarkdown: '# About Us\n\nFounded in 2024.',
    });
    await webhookService.processEvent(evt1.id);

    // Second run with unchanged content
    const { run: run2 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'scheduled' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run2.id, screenshot: fakeScreenshot });
    const { event: evt2 } = await webhookService.ingestWebhookEvent({
      eventId: `u-${run2.id}`,
      pageId: page.id,
      runId: run2.id,
      eventType: 'unchanged',
      contentMarkdown: '# About Us\n\nFounded in 2024.   ', // Whitespace noise only
    });
    await webhookService.processEvent(evt2.id);

    // Verify still only 1 version exists
    const versions = await versionService.getVersionsForPage(page.id);
    expect(versions.length).toBe(1);
  });

  it('creates version 2 when meaningful content change occurs', async () => {
    const page = await pageService.createPage({
      url: `https://ver-change-${Date.now()}.example.org/plans`,
      schedule_type: 'hourly',
      schedule_timezone: 'UTC',
    });
    createdPageIds.push(page.id);

    const fakeScreenshot = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    // Baseline
    const { run: run1 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'manual' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run1.id, screenshot: fakeScreenshot });
    const { event: evt1 } = await webhookService.ingestWebhookEvent({
      eventId: `b-${run1.id}`,
      pageId: page.id,
      runId: run1.id,
      eventType: 'baseline',
      contentMarkdown: '# Plans\n\nBasic: $5/mo',
    });
    await webhookService.processEvent(evt1.id);

    // Changed run
    const { run: run2 } = await runCoordinator.createRunRecord({ pageId: page.id, triggerType: 'scheduled' });
    await artifactStorage.saveRunArtifacts({ pageId: page.id, runId: run2.id, screenshot: fakeScreenshot });
    const { event: evt2 } = await webhookService.ingestWebhookEvent({
      eventId: `c-${run2.id}`,
      pageId: page.id,
      runId: run2.id,
      eventType: 'change_detected',
      contentMarkdown: '# Plans\n\nBasic: $12/mo\nPro: $25/mo',
    });
    await webhookService.processEvent(evt2.id);

    const versions = await versionService.getVersionsForPage(page.id);
    expect(versions.length).toBe(2);
    expect(versions[0].version_number).toBe(2);
    expect(versions[1].version_number).toBe(1);
  });

  it('marks webhook as unmatched when neither page nor run can be identified', async () => {
    const unknownId = uuidv4();
    const { event } = await webhookService.ingestWebhookEvent({
      eventId: `unknown-${Date.now()}`,
      pageId: unknownId,
      runId: unknownId,
      contentMarkdown: '# Ghost page',
    });

    const processed = await webhookService.processEvent(event.id);
    expect(processed.processing_status).toBe('unmatched');
    expect(processed.last_error).toContain('Unmatched');
  });
});
