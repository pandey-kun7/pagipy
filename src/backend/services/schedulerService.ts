import { withTransaction, query } from '../db/index.js';
import { PageRecord } from '../../shared/types.js';
import { computeNextRunAt } from '../utils/scheduleCalculator.js';
import { runCoordinator } from './runCoordinator.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

export interface SchedulerTickResult {
  pagesConsidered: number;
  runsCreated: number;
  errors: number;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  async tick(): Promise<SchedulerTickResult> {
    if (this.isTicking) {
      logger.debug('Scheduler tick already in progress, skipping overlapping tick.');
      return { pagesConsidered: 0, runsCreated: 0, errors: 0 };
    }

    this.isTicking = true;
    const result: SchedulerTickResult = { pagesConsidered: 0, runsCreated: 0, errors: 0 };

    try {
      // Find up to 20 due pages using FOR UPDATE SKIP LOCKED inside a transaction
      const claimedPages = await withTransaction(async (client) => {
        const selectSql = `
          SELECT * FROM pages
          WHERE status = 'active'
            AND next_run_at IS NOT NULL
            AND next_run_at <= NOW()
          ORDER BY next_run_at ASC
          LIMIT 100
          FOR UPDATE SKIP LOCKED;
        `;

        const res = await client.query<PageRecord>(selectSql);
        const pages = res.rows;

        // Advance next_run_at for each claimed page immediately within the transaction
        for (const page of pages) {
          const nextRun = computeNextRunAt({
            schedule_type: page.schedule_type,
            schedule_timezone: page.schedule_timezone,
            schedule_hour: page.schedule_hour,
            schedule_minute: page.schedule_minute,
            schedule_weekday: page.schedule_weekday,
          }, new Date());

          await client.query(
            `UPDATE pages SET next_run_at = $1, last_run_at = NOW(), updated_at = NOW() WHERE id = $2`,
            [nextRun, page.id]
          );
        }

        return pages;
      });

      result.pagesConsidered = claimedPages.length;

      // For each claimed page, create a run via the run coordinator
      for (const page of claimedPages) {
        try {
          const idempotencyKey = `scheduled:${page.id}:${new Date(page.next_run_at!).toISOString()}`;
          const { run, created } = await runCoordinator.createRunRecord({
            pageId: page.id,
            triggerType: 'scheduled',
            scheduledFor: new Date(page.next_run_at!),
            idempotencyKey,
          });

          if (created) {
            result.runsCreated++;
            // Execute the run asynchronously so scheduler does not block
            runCoordinator.executeRun(run.id).catch((runErr) => {
              logger.error('Failed executing scheduled run', runErr, { runId: run.id, pageId: page.id });
            });
          }
        } catch (err) {
          result.errors++;
          logger.error('Error creating scheduled run for page', err, { pageId: page.id });
        }
      }

      if (result.pagesConsidered > 0) {
        logger.info('Scheduler tick completed', {
          pagesConsidered: result.pagesConsidered,
          runsCreated: result.runsCreated,
          errors: result.errors,
        });
      }
    } catch (err) {
      logger.error('Fatal scheduler tick error', err);
    } finally {
      this.isTicking = false;
    }

    return result;
  }

  start(intervalMs = config.schedulerIntervalMs): void {
    if (this.timer) return;
    logger.info(`Starting SchedulerService with interval ${intervalMs}ms`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error('Unhandled tick rejection', err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('SchedulerService stopped');
    }
  }
}

export const schedulerService = new SchedulerService();
