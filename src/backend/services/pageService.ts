import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { PageRecord, PageStatus, ScheduleType } from '../../shared/types.js';
import { validateAndCanonicalizeUrl } from '../utils/urlValidator.js';
import { computeNextRunAt, validateScheduleOptions } from '../utils/scheduleCalculator.js';
import { logger } from '../utils/logger.js';

export interface CreatePageInput {
  name?: string;
  url: string;
  category?: string | null;
  monitor_objective?: string | null;
  schedule_type: ScheduleType;
  schedule_timezone?: string;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekday?: number | null;
}

export interface UpdatePageInput {
  name?: string;
  category?: string | null;
  monitor_objective?: string | null;
  schedule_type?: ScheduleType;
  schedule_timezone?: string;
  schedule_hour?: number | null;
  schedule_minute?: number | null;
  schedule_weekday?: number | null;
}

export interface ListPagesFilter {
  search?: string;
  category?: string;
  status?: PageStatus;
  limit?: number;
  offset?: number;
}

export class PageService {
  async createPage(input: CreatePageInput): Promise<PageRecord> {
    // 1. Validate URL
    const urlValidation = validateAndCanonicalizeUrl(input.url);
    if (!urlValidation.valid || !urlValidation.canonicalUrl) {
      throw new Error(`Invalid URL: ${urlValidation.error}`);
    }

    const canonicalUrl = urlValidation.canonicalUrl;

    // 2. Prevent duplicate active/paused pages by canonical URL
    const existing = await query<PageRecord>(
      `SELECT * FROM pages WHERE canonical_url = $1 AND status != 'archived' LIMIT 1`,
      [canonicalUrl]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error(`A monitored page with canonical URL "${canonicalUrl}" already exists (ID: ${existing.rows[0].id})`);
    }

    // 3. Validate Schedule
    const timezone = input.schedule_timezone || 'UTC';
    const scheduleOpts = {
      schedule_type: input.schedule_type,
      schedule_timezone: timezone,
      schedule_hour: input.schedule_hour,
      schedule_minute: input.schedule_minute,
      schedule_weekday: input.schedule_weekday,
    };

    const scheduleValidation = validateScheduleOptions(scheduleOpts);
    if (!scheduleValidation.valid) {
      throw new Error(`Invalid schedule: ${scheduleValidation.error}`);
    }

    const nextRunAt = computeNextRunAt(scheduleOpts);

    // 4. Derive display name if not provided
    const parsedUrl = new URL(canonicalUrl);
    const displayName = (input.name && input.name.trim()) || parsedUrl.hostname;

    const id = uuidv4();
    const now = new Date();

    const insertSql = `
      INSERT INTO pages (
        id, name, submitted_url, canonical_url, category, monitor_objective,
        status, schedule_type, schedule_timezone, schedule_hour, schedule_minute,
        schedule_weekday, next_run_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      ) RETURNING *;
    `;

    const values = [
      id,
      displayName,
      input.url.trim(),
      canonicalUrl,
      input.category || null,
      input.monitor_objective || null,
      'active',
      input.schedule_type,
      timezone,
      input.schedule_hour ?? null,
      input.schedule_minute ?? null,
      input.schedule_weekday ?? null,
      nextRunAt,
      now,
      now,
    ];

    const res = await query<PageRecord>(insertSql, values);
    logger.info('Created new monitored page', { pageId: id, canonicalUrl, scheduleType: input.schedule_type });
    return res.rows[0];
  }

  async getPage(id: string): Promise<PageRecord | null> {
    const res = await query<PageRecord>('SELECT * FROM pages WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async listPages(filters: ListPagesFilter = {}): Promise<{ pages: PageRecord[]; total: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.search) {
      conditions.push(`(name ILIKE $${idx} OR submitted_url ILIKE $${idx} OR canonical_url ILIKE $${idx})`);
      values.push(`%${filters.search}%`);
      idx++;
    }

    if (filters.category) {
      conditions.push(`category = $${idx}`);
      values.push(filters.category);
      idx++;
    }

    if (filters.status) {
      conditions.push(`status = $${idx}`);
      values.push(filters.status);
      idx++;
    } else {
      // By default exclude archived pages unless requested
      conditions.push(`status != 'archived'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) as count FROM pages ${whereClause};`;
    const countRes = await query<{ count: string }>(countSql, values);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    const querySql = `
      SELECT * FROM pages
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1};
    `;
    values.push(limit, offset);

    const res = await query<PageRecord>(querySql, values);
    return { pages: res.rows, total };
  }

  async updatePage(id: string, input: UpdatePageInput): Promise<PageRecord> {
    const current = await this.getPage(id);
    if (!current) {
      throw new Error(`Page not found: ${id}`);
    }

    if (current.status === 'archived') {
      throw new Error('Cannot update an archived page');
    }

    const scheduleType = input.schedule_type || current.schedule_type;
    const timezone = input.schedule_timezone || current.schedule_timezone;
    const hour = input.schedule_hour !== undefined ? input.schedule_hour : current.schedule_hour;
    const minute = input.schedule_minute !== undefined ? input.schedule_minute : current.schedule_minute;
    const weekday = input.schedule_weekday !== undefined ? input.schedule_weekday : current.schedule_weekday;

    const scheduleOpts = {
      schedule_type: scheduleType,
      schedule_timezone: timezone,
      schedule_hour: hour,
      schedule_minute: minute,
      schedule_weekday: weekday,
    };

    const scheduleValidation = validateScheduleOptions(scheduleOpts);
    if (!scheduleValidation.valid) {
      throw new Error(`Invalid schedule: ${scheduleValidation.error}`);
    }

    let nextRunAt = current.next_run_at;
    if (current.status === 'active') {
      nextRunAt = computeNextRunAt(scheduleOpts);
    }

    const updateSql = `
      UPDATE pages SET
        name = COALESCE($1, name),
        category = $2,
        monitor_objective = $3,
        schedule_type = $4,
        schedule_timezone = $5,
        schedule_hour = $6,
        schedule_minute = $7,
        schedule_weekday = $8,
        next_run_at = $9,
        updated_at = NOW()
      WHERE id = $10
      RETURNING *;
    `;

    const values = [
      input.name || null,
      input.category !== undefined ? input.category : current.category,
      input.monitor_objective !== undefined ? input.monitor_objective : current.monitor_objective,
      scheduleType,
      timezone,
      hour,
      minute,
      weekday,
      nextRunAt,
      id,
    ];

    const res = await query<PageRecord>(updateSql, values);
    logger.info('Updated page configuration', { pageId: id });
    return res.rows[0];
  }

  async pausePage(id: string): Promise<PageRecord> {
    const current = await this.getPage(id);
    if (!current) throw new Error(`Page not found: ${id}`);
    if (current.status === 'archived') throw new Error('Cannot pause an archived page');

    const res = await query<PageRecord>(
      `UPDATE pages SET status = 'paused', next_run_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *;`,
      [id]
    );
    logger.info('Paused page monitoring', { pageId: id });
    return res.rows[0];
  }

  async resumePage(id: string): Promise<PageRecord> {
    const current = await this.getPage(id);
    if (!current) throw new Error(`Page not found: ${id}`);
    if (current.status === 'archived') throw new Error('Cannot resume an archived page');

    const nextRun = computeNextRunAt({
      schedule_type: current.schedule_type,
      schedule_timezone: current.schedule_timezone,
      schedule_hour: current.schedule_hour,
      schedule_minute: current.schedule_minute,
      schedule_weekday: current.schedule_weekday,
    });

    const res = await query<PageRecord>(
      `UPDATE pages SET status = 'active', next_run_at = $1, updated_at = NOW() WHERE id = $2 RETURNING *;`,
      [nextRun, id]
    );
    logger.info('Resumed page monitoring', { pageId: id, nextRunAt: nextRun });
    return res.rows[0];
  }

  async archivePage(id: string): Promise<PageRecord> {
    const current = await this.getPage(id);
    if (!current) throw new Error(`Page not found: ${id}`);

    const res = await query<PageRecord>(
      `UPDATE pages SET status = 'archived', next_run_at = NULL, archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *;`,
      [id]
    );
    logger.info('Archived page', { pageId: id });
    return res.rows[0];
  }

  async getDashboardStats(): Promise<{
    total: number;
    active: number;
    paused: number;
    attention_required: number;
    setup_failed: number;
  }> {
    const res = await query<{ status: PageStatus; count: string }>(`
      SELECT status, COUNT(*) as count 
      FROM pages 
      WHERE status != 'archived'
      GROUP BY status;
    `);

    const stats = {
      total: 0,
      active: 0,
      paused: 0,
      attention_required: 0,
      setup_failed: 0,
    };

    for (const row of res.rows) {
      const c = parseInt(row.count, 10);
      stats.total += c;
      if (row.status === 'active') stats.active = c;
      else if (row.status === 'paused') stats.paused = c;
      else if (row.status === 'attention_required') stats.attention_required = c;
      else if (row.status === 'setup_failed') stats.setup_failed = c;
    }

    return stats;
  }
}

export const pageService = new PageService();
