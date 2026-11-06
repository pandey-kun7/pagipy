import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { healthRouter } from './routes/health.js';
import { pagesRouter } from './routes/pages.js';
import { runsRouter } from './routes/runs.js';
import { webhooksRouter } from './routes/webhooks.js';
import { artifactStorage } from './storage/artifactStorage.js';
import { logger } from './utils/logger.js';

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Request logger middleware
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
  });

  // Mount API routes
  app.use('/api/health', healthRouter);
  app.use('/api/pages', pagesRouter);
  app.use('/api/runs', runsRouter);
  app.use('/api/webhooks', webhooksRouter);

  // Serve stored artifacts safely with content types
  app.use('/api/artifacts', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    try {
      const relPath = decodeURIComponent(req.path.replace(/^\//, ''));
      if (!relPath) {
        res.status(400).json({ error: 'Missing artifact path' });
        return;
      }

      const verification = await artifactStorage.verifyArtifact(relPath);

      if (!verification.exists || !verification.valid) {
        res.status(404).json({ error: 'Artifact not found or invalid' });
        return;
      }

      const content = await artifactStorage.readArtifact(relPath);

      if (relPath.endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
      } else if (relPath.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json');
      } else if (relPath.endsWith('.md')) {
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }

      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('ETag', `"${verification.sha256}"`);
      res.send(content);
    } catch (err) {
      next(err);
    }
  });

  // Serve static UI assets with no-cache so browsers always get fresh updates
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));

  // SPA fallback for frontend routes (middleware without path pattern to avoid path-to-regexp error)
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // Global Error Handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled request error', err);
    res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    });
  });

  return app;
}
