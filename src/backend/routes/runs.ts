import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';
import { MonitorRunRecord } from '../../shared/types.js';

export const runsRouter = Router();

// GET recent runs across all pages
runsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
    const result = await query<MonitorRunRecord>(`
      SELECT r.*, p.name as page_name, p.canonical_url
      FROM monitor_runs r
      JOIN pages p ON p.id = r.page_id
      ORDER BY r.created_at DESC
      LIMIT $1;
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET run by ID
runsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query<MonitorRunRecord>(
      `SELECT * FROM monitor_runs WHERE id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});
