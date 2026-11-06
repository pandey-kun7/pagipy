import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/index.js';
import { WebhookEventRecord, PageRecord, MonitorRunRecord } from '../../shared/types.js';
import { versionService } from './versionService.js';
import { artifactStorage } from '../storage/artifactStorage.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export interface IncomingWebhookPayload {
  eventId?: string;
  externalEventId?: string;
  monitorExternalId?: string;
  pageId?: string;
  runId?: string;
  externalRunId?: string;
  eventType?: 'change_detected' | 'unchanged' | 'baseline' | string;
  contentMarkdown?: string;
  observedAt?: string;
  url?: string;
  [key: string]: unknown;
}

export class WebhookService {
  /**
   * Verify webhook authenticity placeholder.
   * INTEGRATION TODO: Implement official TinyFish signature validation (HMAC SHA-256 or token)
   * once the project owner supplies the exact documentation.
   */
  verifyWebhookSignature(headers: Record<string, string | string[] | undefined>, _rawBody?: string): boolean {
    // If webhook secret is placeholder or empty, bypass signature check during development/testing
    if (!config.tinyfishWebhookSecret || config.tinyfishWebhookSecret === 'placeholder_webhook_secret' || process.env.NODE_ENV === 'test') {
      return true;
    }

    const signature = headers['x-tinyfish-signature'] || headers['tinyfish-signature'];
    if (!signature) {
      logger.warn('Incoming webhook rejected: missing x-tinyfish-signature header');
      return false;
    }

    // Official signature verification will be wired here with config.tinyfishWebhookSecret
    return true;
  }

  /**
   * Derives a stable deduplication key for the event.
   */
  deriveDeduplicationKey(payload: IncomingWebhookPayload): string {
    if (payload.eventId) return `evt:${payload.eventId}`;
    if (payload.externalEventId) return `ext-evt:${payload.externalEventId}`;
    if (payload.runId && payload.eventType) return `run:${payload.runId}:${payload.eventType}`;
    if (payload.externalRunId && payload.eventType) return `ext-run:${payload.externalRunId}:${payload.eventType}`;

    // Fallback: SHA-256 of payload json
    const payloadStr = JSON.stringify(payload);
    return `hash:${artifactStorage.computeSha256(payloadStr)}`;
  }

  /**
   * Ingests an incoming webhook event idempotently into the durable inbox.
   */
  async ingestWebhookEvent(
    payload: IncomingWebhookPayload,
    headers: Record<string, string | string[] | undefined> = {}
  ): Promise<{ event: WebhookEventRecord; isDuplicate: boolean }> {
    // 1. Verify authenticity
    const isValid = this.verifyWebhookSignature(headers);
    if (!isValid) {
      throw new Error('Invalid webhook signature');
    }

    const deduplicationKey = this.deriveDeduplicationKey(payload);
    const eventId = uuidv4();
    const externalEventId = payload.eventId || payload.externalEventId || null;
    const monitorExternalId = payload.monitorExternalId || null;
    const now = new Date();

    // 2. Persist to webhook_events durable inbox
    const sql = `
      INSERT INTO webhook_events (
        id, external_event_id, event_deduplication_key, monitor_external_id,
        payload_json, processing_status, received_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'received', $6
      )
      ON CONFLICT (event_deduplication_key) DO UPDATE
      SET processing_status = webhook_events.processing_status
      RETURNING *;
    `;

    const res = await query<WebhookEventRecord>(sql, [
      eventId,
      externalEventId,
      deduplicationKey,
      monitorExternalId,
      JSON.stringify(payload),
      now,
    ]);

    const event = res.rows[0];
    const isDuplicate = event.id !== eventId;

    if (isDuplicate) {
      logger.info('Duplicate webhook delivery detected and acknowledged idempotently', {
        deduplicationKey,
        eventId: event.id,
      });
      return { event, isDuplicate: true };
    }

    logger.info('Persisted incoming webhook event', {
      eventId: event.id,
      deduplicationKey,
      monitorExternalId: monitorExternalId || undefined,
    });

    return { event, isDuplicate: false };
  }

  /**
   * Processes a persisted webhook event: correlates with page and run,
   * stores content artifacts, and creates page versions when changed.
   */
  async processEvent(eventId: string): Promise<WebhookEventRecord> {
    const eventRes = await query<WebhookEventRecord>(
      'SELECT * FROM webhook_events WHERE id = $1',
      [eventId]
    );
    if (eventRes.rowCount === 0) throw new Error(`Webhook event not found: ${eventId}`);
    const event = eventRes.rows[0];

    const payload = event.payload_json as IncomingWebhookPayload;

    // 1. Correlate with page
    let page: PageRecord | null = null;
    if (payload.pageId) {
      const pRes = await query<PageRecord>('SELECT * FROM pages WHERE id = $1', [payload.pageId]);
      page = pRes.rows[0] || null;
    } else if (event.monitor_external_id) {
      const pRes = await query<PageRecord>('SELECT * FROM pages WHERE monitor_external_id = $1', [event.monitor_external_id]);
      page = pRes.rows[0] || null;
    }

    // 2. Correlate with run
    let run: MonitorRunRecord | null = null;
    if (payload.runId) {
      const rRes = await query<MonitorRunRecord>('SELECT * FROM monitor_runs WHERE id = $1', [payload.runId]);
      run = rRes.rows[0] || null;
    } else if (payload.externalRunId) {
      const rRes = await query<MonitorRunRecord>('SELECT * FROM monitor_runs WHERE monitor_external_run_id = $1', [payload.externalRunId]);
      run = rRes.rows[0] || null;
    } else if (page) {
      // Correlate with latest run awaiting monitor result or currently running
      const rRes = await query<MonitorRunRecord>(
        `SELECT * FROM monitor_runs 
         WHERE page_id = $1 AND status IN ('awaiting_monitor_result', 'running', 'queued')
         ORDER BY created_at DESC LIMIT 1`,
        [page.id]
      );
      run = rRes.rows[0] || null;
    }

    // If correlation fails, mark as unmatched
    if (!page || !run) {
      logger.warn('Webhook event could not be correlated with page/run', {
        eventId,
        pageFound: !!page,
        runFound: !!run,
      });

      const updatedRes = await query<WebhookEventRecord>(
        `UPDATE webhook_events 
         SET processing_status = 'unmatched', processed_at = NOW(), last_error = 'Unmatched page or run correlation'
         WHERE id = $1 RETURNING *`,
        [eventId]
      );
      return updatedRes.rows[0];
    }

    // Update webhook event with correlated page and run IDs
    await query(
      `UPDATE webhook_events SET page_id = $1, run_id = $2 WHERE id = $3`,
      [page.id, run.id, eventId]
    );

    // 3. Process content artifact and version creation
    try {
      const content = payload.contentMarkdown;
      const isBaseline = payload.eventType === 'baseline' || run.trigger_type === 'manual' && !(await versionService.getLatestVersion(page.id));
      const hasContent = typeof content === 'string' && content.length > 0;

      if (hasContent) {
        // Save content artifact in run folder
        await artifactStorage.saveRunArtifacts({
          pageId: page.id,
          runId: run.id,
          content,
          originalResponse: payload,
        });

        // If baseline or change detected, attempt version creation
        if (isBaseline || payload.eventType === 'change_detected' || payload.eventType === 'changed') {
          await versionService.createVersionForRun({
            pageId: page.id,
            runId: run.id,
            contentMarkdown: content,
            sourceUrl: payload.url || page.canonical_url,
            observedAt: payload.observedAt ? new Date(payload.observedAt) : new Date(),
            forceBaseline: isBaseline,
          });
        }
      }

      // Finalize run status once content has been processed
      await query(
        `UPDATE monitor_runs 
         SET status = 'succeeded', monitor_status = 'succeeded', completed_at = NOW(), updated_at = NOW() 
         WHERE id = $1`,
        [run.id]
      );

      const completedEvent = await query<WebhookEventRecord>(
        `UPDATE webhook_events SET processing_status = 'processed', processed_at = NOW() WHERE id = $1 RETURNING *`,
        [eventId]
      );

      logger.info('Successfully processed webhook event', { eventId, pageId: page.id, runId: run.id });
      return completedEvent.rows[0];
    } catch (err) {
      logger.error('Error processing webhook event', err, { eventId, pageId: page.id, runId: run.id });

      const failedEvent = await query<WebhookEventRecord>(
        `UPDATE webhook_events SET processing_status = 'retryable_error', last_error = $1 WHERE id = $2 RETURNING *`,
        [(err as Error).message, eventId]
      );
      return failedEvent.rows[0];
    }
  }
}

export const webhookService = new WebhookService();
