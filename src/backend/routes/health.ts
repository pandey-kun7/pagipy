import { Router, Request, Response } from 'express';
import { performHealthCheck } from '../services/healthService.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const result = await performHealthCheck();
  const statusCode = result.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(result);
});

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'live', timestamp: new Date().toISOString() });
});
