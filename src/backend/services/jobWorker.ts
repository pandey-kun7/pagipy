import { query, withTransaction } from '../db/index.js';
import { ProcessingJobRecord } from '../../shared/types.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

export class JobWorker {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  async enqueueJob(params: {
    jobType: string;
    entityType?: string;
    entityId?: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<ProcessingJobRecord> {
    const id = uuidv4();
    const now = new Date();
    const maxAttempts = params.maxAttempts || 3;

    const sql = `
      INSERT INTO processing_jobs (
        id, job_type, entity_type, entity_id, payload_json,
        status, attempt_count, max_attempts, next_attempt_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, 'queued', 0, $6, $7, $8, $9
      ) RETURNING *;
    `;

    const res = await query<ProcessingJobRecord>(sql, [
      id,
      params.jobType,
      params.entityType || null,
      params.entityId || null,
      JSON.stringify(params.payload),
      maxAttempts,
      now,
      now,
      now,
    ]);

    logger.info('Enqueued background processing job', { jobId: id, jobType: params.jobType });
    return res.rows[0];
  }

  async processNextBatch(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    let processedCount = 0;

    try {
      const jobs = await withTransaction(async (client) => {
        const selectSql = `
          SELECT * FROM processing_jobs
          WHERE status IN ('queued', 'retryable_error')
            AND next_attempt_at <= NOW()
          ORDER BY next_attempt_at ASC
          LIMIT 5
          FOR UPDATE SKIP LOCKED;
        `;
        const res = await client.query<ProcessingJobRecord>(selectSql);
        const claimed = res.rows;

        for (const job of claimed) {
          await client.query(
            `UPDATE processing_jobs 
             SET status = 'running', locked_at = NOW(), attempt_count = attempt_count + 1, updated_at = NOW() 
             WHERE id = $1`,
            [job.id]
          );
        }

        return claimed;
      });

      for (const job of jobs) {
        try {
          // Process job based on job_type
          logger.debug('Executing background job', { jobId: job.id, jobType: job.job_type });

          // Mark succeeded
          await query(
            `UPDATE processing_jobs 
             SET status = 'succeeded', completed_at = NOW(), updated_at = NOW() 
             WHERE id = $1`,
            [job.id]
          );
          processedCount++;
        } catch (err) {
          const isExhausted = job.attempt_count >= job.max_attempts;
          const nextStatus = isExhausted ? 'permanent_error' : 'retryable_error';
          // Exponential backoff
          const backoffSec = Math.min(300, Math.pow(2, job.attempt_count) * 10);
          const nextAttempt = new Date(Date.now() + backoffSec * 1000);

          await query(
            `UPDATE processing_jobs 
             SET status = $1, next_attempt_at = $2, last_error = $3, updated_at = NOW() 
             WHERE id = $4`,
            [nextStatus, nextAttempt, (err as Error).message, job.id]
          );

          logger.error('Background job failed', err, { jobId: job.id, nextStatus, attemptCount: job.attempt_count });
        }
      }
    } catch (err) {
      logger.error('Fatal job worker batch error', err);
    } finally {
      this.isProcessing = false;
    }

    return processedCount;
  }

  start(intervalMs = config.workerIntervalMs): void {
    if (this.timer) return;
    logger.info(`Starting JobWorker with interval ${intervalMs}ms`);
    this.timer = setInterval(() => {
      this.processNextBatch().catch((err) => {
        logger.error('Unhandled job processing error', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('JobWorker stopped');
    }
  }
}

export const jobWorker = new JobWorker();
