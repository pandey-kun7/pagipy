import { Router, Request, Response, NextFunction } from 'express';
import { pageService } from '../services/pageService.js';
import { runCoordinator } from '../services/runCoordinator.js';
import { versionService } from '../services/versionService.js';
import { historyService } from '../services/historyService.js';
import { query } from '../db/index.js';
import { MonitorRunRecord } from '../../shared/types.js';

export const pagesRouter = Router();

// GET stats
pagesRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await pageService.getDashboardStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// GET list pages
pagesRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, category, status, limit, offset } = req.query;
    const result = await pageService.listPages({
      search: search as string | undefined,
      category: category as string | undefined,
      status: status as any,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST preflight URL using TinyFish Fetch
pagesRouter.post('/preflight', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'URL parameter is required for preflight' });
      return;
    }
    const { fetchAdapter } = await import('../adapters/tinyfish/fetchAdapter.js');
    const result = await fetchAdapter.preflightUrl(url);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET search candidate pages for monitoring
pagesRouter.get('/search-candidates', async (req: Request, res: Response) => {
  try {
    const queryStr = (req.query.query as string) || '';
    const { searchAdapter } = await import('../adapters/tinyfish/searchAdapter.js');
    const results = await searchAdapter.searchOfficialPages(queryStr);
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST create page
pagesRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = await pageService.createPage(req.body);
    res.status(201).json(page);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET page by id
pagesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const page = await pageService.getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }
    res.json(page);
  } catch (err) {
    next(err);
  }
});

// PATCH update page
pagesRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const updated = await pageService.updatePage(id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST pause page
pagesRouter.post('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const paused = await pageService.pausePage(id);
    res.json(paused);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST resume page
pagesRouter.post('/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const resumed = await pageService.resumePage(id);
    res.json(resumed);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST archive page
pagesRouter.post('/:id/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const archived = await pageService.archivePage(id);
    res.json(archived);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST trigger manual run
pagesRouter.post('/:id/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const run = await runCoordinator.triggerManualRun(id);
    res.status(202).json(run);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET page runs
pagesRouter.get('/:id/runs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const resDb = await query<MonitorRunRecord>(
      `SELECT * FROM monitor_runs WHERE page_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [id, limit]
    );
    res.json(resDb.rows);
  } catch (err) {
    next(err);
  }
});

// GET page versions / timeline
pagesRouter.get('/:id/timeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const versions = await versionService.getVersionsForPage(id);
    res.json(versions);
  } catch (err) {
    next(err);
  }
});

// GET Gemma summary for a specific version based on snapshot.md
pagesRouter.get('/:id/versions/:versionId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageId = req.params.id as string;
    const versionId = req.params.versionId as string;
    const result = await historyService.getVersionSummary(pageId, versionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET raw snapshot.md for a specific version
pagesRouter.get('/:id/versions/:versionId/snapshot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pageId = req.params.id as string;
    const versionId = req.params.versionId as string;
    const result = await historyService.getVersionSnapshotMarkdown(pageId, versionId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET compare two versions
pagesRouter.get('/:id/compare', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const fromVersionId = (req.query.from as string) || null;
    const toVersionId = req.query.to as string;

    if (!toVersionId) {
      res.status(400).json({ error: 'Missing required "to" version ID parameter' });
      return;
    }

    const comparison = await historyService.compareVersions(id, fromVersionId, toVersionId);
    res.json(comparison);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET compare two arbitrary dates
pagesRouter.get('/:id/compare-dates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { date1, date2 } = req.query;
    if (!date1 || !date2) {
      res.status(400).json({ error: 'Both date1 and date2 parameters are required' });
      return;
    }

    const d1 = new Date(date1 as string);
    const d2 = new Date(date2 as string);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      res.status(400).json({ error: 'Invalid date format provided for date1 or date2' });
      return;
    }

    const comparison = await historyService.compareDates(id, d1, d2);
    res.json(comparison);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST ask historical question as of date
pagesRouter.post('/:id/ask', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { asOfDate, question } = req.body;
    if (!asOfDate || !question) {
      res.status(400).json({ error: 'Both asOfDate and question are required in request body' });
      return;
    }

    const date = new Date(asOfDate);
    if (isNaN(date.getTime())) {
      res.status(400).json({ error: 'Invalid asOfDate format' });
      return;
    }

    const answer = await historyService.askHistoricalQuestion(id, date, question);
    res.json(answer);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET export page history as reusable JSON
pagesRouter.get('/:id/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const page = await pageService.getPage(id);
    if (!page) {
      res.status(404).json({ error: 'Page not found' });
      return;
    }

    const versions = await versionService.getVersionsForPage(id);
    const runsRes = await query<MonitorRunRecord>(
      `SELECT * FROM monitor_runs WHERE page_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [id]
    );

    const diffsRes = await query(
      `SELECT * FROM page_diffs WHERE page_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="timemachine-export-${id}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      page,
      versions,
      diffs: diffsRes.rows,
      recentRuns: runsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});
