import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { MonitorRunRecord, PageRecord, RunTriggerType } from '../../shared/types.js';
import { logger } from '../utils/logger.js';
import {
  ITinyFishBrowserAdapter,
  ITinyFishMonitorAdapter,
  MonitorInvocationResult,
  BrowserCaptureResult,
} from '../adapters/tinyfish/types.js';
import { monitorAdapter as defaultMonitorAdapter } from '../adapters/tinyfish/monitorAdapter.js';
import { browserAdapter as defaultBrowserAdapter } from '../adapters/tinyfish/browserAdapter.js';
import { artifactStorage } from '../storage/artifactStorage.js';
import { versionService } from './versionService.js';

export interface TriggerRunOptions {
  pageId: string;
  triggerType: RunTriggerType;
  scheduledFor?: Date | null;
  idempotencyKey?: string;
  monitorAdapter?: ITinyFishMonitorAdapter;
  browserAdapter?: ITinyFishBrowserAdapter;
}

class AsyncSemaphore {
  private current = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  private release(): void {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// Limits simultaneous remote browser sessions to 3 to prevent CDP socket overload
const browserConcurrencyLimiter = new AsyncSemaphore(3);

export class RunCoordinator {
  async hasActiveRun(pageId: string): Promise<boolean> {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM monitor_runs 
       WHERE page_id = $1 AND status IN ('queued', 'dispatching', 'running', 'awaiting_monitor_result')`,
      [pageId]
    );
    return parseInt(res.rows[0]?.count || '0', 10) > 0;
  }

  async getActiveRun(pageId: string): Promise<MonitorRunRecord | null> {
    const res = await query<MonitorRunRecord>(
      `SELECT * FROM monitor_runs 
       WHERE page_id = $1 AND status IN ('queued', 'dispatching', 'running', 'awaiting_monitor_result')
       ORDER BY created_at DESC LIMIT 1`,
      [pageId]
    );
    return res.rows[0] || null;
  }

  async createRunRecord(options: TriggerRunOptions): Promise<{ run: MonitorRunRecord; created: boolean }> {
    const { pageId, triggerType, scheduledFor } = options;

    const active = await this.getActiveRun(pageId);
    if (active) {
      logger.warn('Skipping run creation: page already has an active run in flight', { pageId, activeRunId: active.id });
      return { run: active, created: false };
    }

    const scheduledDate = scheduledFor || (triggerType === 'scheduled' ? new Date() : null);
    const key = options.idempotencyKey || (
      triggerType === 'scheduled'
        ? `scheduled:${pageId}:${scheduledDate ? scheduledDate.toISOString() : Date.now()}`
        : `manual:${pageId}:${Date.now()}`
    );

    const runId = uuidv4();
    const now = new Date();

    const sql = `
      INSERT INTO monitor_runs (
        id, page_id, trigger_type, status, idempotency_key,
        scheduled_for, monitor_status, browser_status, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      ON CONFLICT (idempotency_key) DO UPDATE
      SET updated_at = monitor_runs.updated_at
      RETURNING *;
    `;

    const values = [
      runId,
      pageId,
      triggerType,
      'queued',
      key,
      scheduledDate,
      'not_started',
      'not_started',
      now,
      now,
    ];

    const res = await query<MonitorRunRecord>(sql, values);
    const run = res.rows[0];
    const created = run.id === runId;

    logger.info('Run record created/retrieved', {
      runId: run.id,
      pageId,
      triggerType,
      created,
      idempotencyKey: key,
    });

    return { run, created };
  }

  /**
   * Orchestrates the paired execution of BOTH TinyFish Monitor and TinyFish Browser.
   * Every scheduled and manual run executes both integrations via Promise.allSettled.
   */
  async executeRun(
    runId: string,
    adapters?: {
      monitorAdapter?: ITinyFishMonitorAdapter;
      browserAdapter?: ITinyFishBrowserAdapter;
    }
  ): Promise<MonitorRunRecord> {
    const mAdapter = adapters?.monitorAdapter || defaultMonitorAdapter;
    const bAdapter = adapters?.browserAdapter || defaultBrowserAdapter;

    // 1. Fetch run and page
    const runRes = await query<MonitorRunRecord>('SELECT * FROM monitor_runs WHERE id = $1', [runId]);
    if (runRes.rowCount === 0) throw new Error(`Run not found: ${runId}`);
    const run = runRes.rows[0];

    const pageRes = await query<PageRecord>('SELECT * FROM pages WHERE id = $1', [run.page_id]);
    if (pageRes.rowCount === 0) throw new Error(`Page not found for run: ${run.page_id}`);
    const page = pageRes.rows[0];

    // 2. Transition run to 'running'
    const startedAt = new Date();
    await query(
      `UPDATE monitor_runs 
       SET status = 'running', started_at = $1, monitor_status = 'running', browser_status = 'running', updated_at = NOW() 
       WHERE id = $2`,
      [startedAt, runId]
    );

    let monitorResult: MonitorInvocationResult | null = null;
    let browserResult: BrowserCaptureResult | null = null;
    let monitorStart: Date | null = null;
    let monitorEnd: Date | null = null;
    let browserStart: Date | null = null;
    let browserEnd: Date | null = null;

    // 3. Paired execution using Promise.allSettled to guarantee both are invoked independently
    const [monitorSettled, browserSettled] = await Promise.allSettled([
      (async () => {
        monitorStart = new Date();
        try {
          const res = await mAdapter.triggerCheck({
            pageId: page.id,
            runId,
            url: page.canonical_url,
            monitorExternalId: page.monitor_external_id,
            objective: page.monitor_objective,
          });
          monitorEnd = new Date();
          return res;
        } catch (err) {
          monitorEnd = new Date();
          throw err;
        }
      })(),
      (async () => {
        browserStart = new Date();
        try {
          const res = await browserConcurrencyLimiter.runExclusive(() =>
            bAdapter.captureScreenshot({
              pageId: page.id,
              runId,
              url: page.canonical_url,
            })
          );
          browserEnd = new Date();
          return res;
        } catch (err) {
          browserEnd = new Date();
          throw err;
        }
      })(),
    ]);

    // 4. Handle Monitor outcome
    let monitorStatus = 'failed';
    let monitorError: string | null = null;
    if (monitorSettled.status === 'fulfilled') {
      monitorResult = monitorSettled.value;
      if (monitorResult.success) {
        monitorStatus = 'succeeded';
      } else {
        monitorStatus = 'failed';
        monitorError = monitorResult.errorMessage || monitorResult.errorCode || 'Monitor invocation reported failure';
      }
    } else {
      monitorError = (monitorSettled.reason as Error).message;
    }

    // 5. Handle Browser outcome
    let browserStatus = 'failed';
    let browserError: string | null = null;
    if (browserSettled.status === 'fulfilled') {
      browserResult = browserSettled.value;
      if (browserResult.success) {
        browserStatus = 'succeeded';
      } else {
        browserStatus = 'failed';
        browserError = browserResult.errorMessage || browserResult.errorCode || 'Browser capture reported failure';
      }
    } else {
      browserError = (browserSettled.reason as Error).message;
    }

    // 6. Monitor is the authoritative scheduled content result & change detection engine.
    // Falls back to browser rendered DOM only if monitor provided no text.
    const snapshotMarkdown =
      monitorResult?.contentMarkdown && monitorResult.contentMarkdown.trim().length > 0
        ? monitorResult.contentMarkdown
        : browserResult?.renderedContent || '';

    // Relative path for the run's authentic screenshot
    const runScreenshotRelPath =
      browserStatus === 'succeeded' && browserResult?.screenshotBuffer
        ? `pages/${page.id}/runs/${runId}/screenshot.png`
        : null;

    // Persist artifacts for this run
    let contentHash: string | null = null;
    const hasContent = snapshotMarkdown.trim().length > 0;
    try {
      if (hasContent) {
        contentHash = artifactStorage.computeSha256(snapshotMarkdown);
      }

      await artifactStorage.saveRunArtifacts({
        pageId: page.id,
        runId,
        content: hasContent ? snapshotMarkdown : undefined,
        screenshot: browserResult?.screenshotBuffer,
        originalResponse: {
          monitor: monitorResult?.rawResponse,
          browser: browserResult?.rawResponse,
        },
      });
    } catch (saveErr) {
      logger.error('Failed to write run artifacts to storage', saveErr, { runId, pageId: page.id });
    }

    // 7. Create or link page version if content and screenshot are successfully captured
    let createdVersionId: string | null = null;
    const latestVersion = await versionService.getLatestVersion(page.id);

    if (monitorStatus === 'succeeded' && browserStatus === 'succeeded' && snapshotMarkdown) {
      try {
        const isBaseline = !latestVersion;
        const verResult = await versionService.createVersionForRun({
          pageId: page.id,
          runId,
          contentMarkdown: snapshotMarkdown,
          sourceUrl: page.canonical_url,
          observedAt: monitorEnd || new Date(),
          forceBaseline: isBaseline,
        });

        if (verResult.version) {
          createdVersionId = verResult.version.id;
        } else if (latestVersion) {
          // Unchanged run links to latest existing version!
          createdVersionId = latestVersion.id;
        }
      } catch (verErr) {
        logger.error('Failed to create version for run in RunCoordinator', verErr, { runId, pageId: page.id });
      }
    } else if (monitorStatus === 'succeeded' && browserStatus !== 'succeeded') {
      logger.warn('Browser screenshot failed; version creation deferred until genuine screenshot is captured', {
        runId,
        pageId: page.id,
      });
      if (latestVersion) {
        createdVersionId = latestVersion.id;
      }
    }

    // 8. Determine overall run status
    const completedAt = new Date();
    let finalStatus: 'succeeded' | 'partial_success' | 'failed' | 'awaiting_monitor_result';

    if (monitorResult?.isAsync && browserStatus === 'succeeded') {
      finalStatus = 'awaiting_monitor_result';
    } else if (monitorStatus === 'succeeded' && browserStatus === 'succeeded') {
      finalStatus = 'succeeded';
    } else if (monitorStatus === 'succeeded' || browserStatus === 'succeeded') {
      finalStatus = 'partial_success';
    } else {
      finalStatus = 'failed';
    }

    const errors = [monitorError, browserError].filter(Boolean);
    const combinedErrorMessage = errors.length > 0 ? errors.join('; ') : null;

    // 9. Update run record
    const updateSql = `
      UPDATE monitor_runs SET
        status = $1,
        completed_at = $2,
        monitor_status = $3,
        browser_status = $4,
        monitor_external_run_id = $5,
        monitor_started_at = $6,
        monitor_completed_at = $7,
        browser_started_at = $8,
        browser_completed_at = $9,
        monitor_outcome = $10,
        content_hash = $11,
        version_id = COALESCE($12, version_id),
        error_message = $13,
        screenshot_artifact_path = $14,
        updated_at = NOW()
      WHERE id = $15
      RETURNING *;
    `;

    const updateValues = [
      finalStatus,
      completedAt,
      monitorStatus,
      browserStatus,
      monitorResult?.externalRunId || null,
      monitorStart,
      monitorEnd,
      browserStart,
      browserEnd,
      monitorResult?.outcome || 'unknown',
      contentHash,
      createdVersionId,
      combinedErrorMessage,
      runScreenshotRelPath,
      runId,
    ];

    const updatedRes = await query<MonitorRunRecord>(updateSql, updateValues);
    logger.info('Run completed paired execution', {
      runId,
      finalStatus,
      monitorStatus,
      browserStatus,
      pageId: page.id,
    });

    return updatedRes.rows[0];
  }

  async triggerManualRun(
    pageId: string,
    adapters?: {
      monitorAdapter?: ITinyFishMonitorAdapter;
      browserAdapter?: ITinyFishBrowserAdapter;
    }
  ): Promise<MonitorRunRecord> {
    const pageRes = await query('SELECT id, status FROM pages WHERE id = $1', [pageId]);
    if (pageRes.rowCount === 0) {
      throw new Error(`Page not found: ${pageId}`);
    }
    const page = pageRes.rows[0];
    if (page.status === 'archived') {
      throw new Error('Cannot run checks on an archived page');
    }

    const { run, created } = await this.createRunRecord({
      pageId,
      triggerType: 'manual',
    });

    // If new run was created, execute it immediately
    if (created) {
      return this.executeRun(run.id, adapters);
    }

    return run;
  }
}

export const runCoordinator = new RunCoordinator();
