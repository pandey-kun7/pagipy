import { query } from '../src/backend/db/index.js';
import fs from 'fs/promises';
import path from 'path';

export async function cleanupPageIds(pageIds: string[]) {
  if (!pageIds || pageIds.length === 0) return;

  try {
    await query(`DELETE FROM processing_jobs WHERE entity_id = ANY($1::uuid[])`, [pageIds]);
    await query(`DELETE FROM webhook_events WHERE page_id = ANY($1::uuid[])`, [pageIds]);
    await query(`DELETE FROM page_diffs WHERE page_id = ANY($1::uuid[])`, [pageIds]);
    await query(`DELETE FROM page_versions WHERE page_id = ANY($1::uuid[])`, [pageIds]);
    await query(`DELETE FROM monitor_runs WHERE page_id = ANY($1::uuid[])`, [pageIds]);
    await query(`DELETE FROM pages WHERE id = ANY($1::uuid[])`, [pageIds]);

    const storagePages = path.resolve(process.cwd(), 'storage', 'pages');
    for (const id of pageIds) {
      try {
        await fs.rm(path.join(storagePages, id), { recursive: true, force: true });
      } catch {
        // Ignore storage cleanup errors
      }
    }
  } catch {
    // Silent catch during test teardown
  }
}
