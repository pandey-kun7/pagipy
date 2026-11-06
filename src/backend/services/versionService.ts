import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/index.js';
import { MonitorRunRecord, PageVersionRecord, PageRecord } from '../../shared/types.js';
import { artifactStorage } from '../storage/artifactStorage.js';
import { logger } from '../utils/logger.js';

export class VersionService {
  /**
   * Normalizes markdown content for meaningful comparison:
   * Strips dynamic volatile tokens/session query strings while preserving
   * tables, dates, numbers, prices, currencies, and textual headings.
   */
  normalizeContent(rawContent: string): string {
    return rawContent
      // Normalize line endings
      .replace(/\r\n/g, '\n')
      // Strip trailing whitespace per line
      .split('\n')
      .map((line) => line.trimEnd())
      .join('\n')
      // Normalize consecutive blank lines to at most 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * Retrieves the latest version for a page.
   */
  async getLatestVersion(pageId: string): Promise<PageVersionRecord | null> {
    const res = await query<PageVersionRecord>(
      `SELECT * FROM page_versions WHERE page_id = $1 ORDER BY version_number DESC LIMIT 1`,
      [pageId]
    );
    return res.rows[0] || null;
  }

  /**
   * Creates an immutable version record for a run.
   * Ensures screenshot and content artifacts both exist and are durably verified.
   */
  async createVersionForRun(params: {
    pageId: string;
    runId: string;
    contentMarkdown: string;
    sourceUrl: string;
    observedAt?: Date;
    forceBaseline?: boolean;
  }): Promise<{ version: PageVersionRecord | null; isNew: boolean; reason?: string }> {
    const { pageId, runId, contentMarkdown, sourceUrl } = params;
    const observedAt = params.observedAt || new Date();

    // 1. Check if this run already produced a version
    const existingRunVersion = await query<PageVersionRecord>(
      `SELECT * FROM page_versions WHERE run_id = $1`,
      [runId]
    );
    if (existingRunVersion.rowCount && existingRunVersion.rowCount > 0) {
      return { version: existingRunVersion.rows[0], isNew: false, reason: 'Version already exists for this run' };
    }

    // 2. Compute content hashes
    const rawContentHash = artifactStorage.computeSha256(contentMarkdown);
    const normalized = this.normalizeContent(contentMarkdown);
    const normalizedContentHash = artifactStorage.computeSha256(normalized);

    // 3. Check latest version for this page
    const latest = await this.getLatestVersion(pageId);
    let versionNumber = 1;

    if (latest) {
      // Check if normalized content changed
      if (!params.forceBaseline && latest.normalized_content_hash === normalizedContentHash) {
        logger.info('No meaningful content change detected between runs; skipping version creation', {
          pageId,
          runId,
          latestVersionNumber: latest.version_number,
        });
        return { version: null, isNew: false, reason: 'Content unchanged from previous version' };
      }
      versionNumber = latest.version_number + 1;
    }

    // 4. Verify that the run has a captured screenshot
    const runScreenshotRelPath = `pages/${pageId}/runs/${runId}/screenshot.png`;
    const screenshotVer = await artifactStorage.verifyArtifact(runScreenshotRelPath);
    if (!screenshotVer.exists || !screenshotVer.valid) {
      logger.warn('Cannot mark version complete: run screenshot is missing or invalid', {
        pageId,
        runId,
        runScreenshotRelPath,
      });
      return { version: null, isNew: false, reason: 'Run screenshot is missing or invalid' };
    }

    // 5. Read screenshot buffer from run
    const screenshotBuffer = await artifactStorage.readArtifact(runScreenshotRelPath);

    // 6. Save version artifacts in storage (snapshot.md, screenshot.png, version-manifest.json)
    const versionManifest = await artifactStorage.saveVersionArtifacts({
      pageId,
      versionNumber,
      snapshot: contentMarkdown,
      screenshot: screenshotBuffer,
      sourceRunId: runId,
    });

    const versionId = uuidv4();
    const now = new Date();

    const isBaseline = versionNumber === 1 || Boolean(params.forceBaseline);

    // 7. Insert version record and link run in a single transaction
    const newVersion = await withTransaction(async (client) => {
      const insertSql = `
        INSERT INTO page_versions (
          id, page_id, run_id, version_number, observed_at, source_url,
          content_format, raw_content_hash, normalized_content_hash,
          content_artifact_path, screenshot_artifact_path, is_baseline, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        ) RETURNING *;
      `;

      const insertValues = [
        versionId,
        pageId,
        runId,
        versionNumber,
        observedAt,
        sourceUrl,
        'text/markdown',
        rawContentHash,
        normalizedContentHash,
        versionManifest.files.snapshot.path,
        versionManifest.files.screenshot.path,
        isBaseline,
        now,
      ];

      const vRes = await client.query<PageVersionRecord>(insertSql, insertValues);

      // Link version_id to monitor_runs and mark run completed
      await client.query(
        `UPDATE monitor_runs 
         SET version_id = $1, status = 'succeeded', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() 
         WHERE id = $2`,
        [versionId, runId]
      );

      return vRes.rows[0];
    });

    logger.info('Created new immutable page version', {
      pageId,
      runId,
      versionId: newVersion.id,
      versionNumber: newVersion.version_number,
    });

    return { version: newVersion, isNew: true };
  }

  async getVersionsForPage(pageId: string): Promise<PageVersionRecord[]> {
    const res = await query<PageVersionRecord>(
      `SELECT * FROM page_versions WHERE page_id = $1 ORDER BY version_number DESC`,
      [pageId]
    );
    return res.rows;
  }

  async getVersionById(versionId: string): Promise<PageVersionRecord | null> {
    const res = await query<PageVersionRecord>(
      `SELECT * FROM page_versions WHERE id = $1`,
      [versionId]
    );
    return res.rows[0] || null;
  }
}

export const versionService = new VersionService();
