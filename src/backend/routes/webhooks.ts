import { Router, Request, Response, NextFunction } from 'express';
import { webhookService } from '../services/webhookService.js';
import { query } from '../db/index.js';
import { WebhookEventRecord } from '../../shared/types.js';
import { logger } from '../utils/logger.js';

export const webhooksRouter = Router();

// POST /api/webhooks/tinyfish
webhooksRouter.post('/tinyfish', async (req: Request, res: Response) => {
  try {
    const { event, isDuplicate } = await webhookService.ingestWebhookEvent(req.body, req.headers);

    if (isDuplicate) {
      res.status(200).json({ received: true, duplicate: true, eventId: event.id });
      return;
    }

    // Process event asynchronously so we acknowledge quickly
    webhookService.processEvent(event.id).catch((err) => {
      logger.error('Background webhook processing failed', err, { eventId: event.id });
    });

    res.status(202).json({ received: true, eventId: event.id });
  } catch (err) {
    logger.error('Webhook ingestion rejected', err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/webhooks - List recent webhook events
webhooksRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const status = req.query.status as string | undefined;

    let sql = 'SELECT * FROM webhook_events';
    const params: unknown[] = [];

    if (status) {
      sql += ' WHERE processing_status = $1';
      params.push(status);
    }

    sql += ` ORDER BY received_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const resDb = await query<WebhookEventRecord>(sql, params);
    res.json(resDb.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/webhooks/:id/reprocess - Reprocess unmatched or error event
webhooksRouter.post('/:id/reprocess', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const processed = await webhookService.processEvent(id);
    res.json(processed);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
