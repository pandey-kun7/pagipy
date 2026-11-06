import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/index.js';
import { PageVersionRecord, PageDiffRecord, PageRecord, StructuredDiff } from '../../shared/types.js';
import { diffEngine } from './diffEngine.js';
import { gemmaAdapter } from '../adapters/llm/gemmaAdapter.js';
import { artifactStorage } from '../storage/artifactStorage.js';
import { pageService } from './pageService.js';
import { logger } from '../utils/logger.js';

export interface ComparisonResult {
  fromVersion: PageVersionRecord | null;
  toVersion: PageVersionRecord;
  diff: StructuredDiff;
  changeSummary: string | null;
  significance: string | null;
  summaryStatus: string;
  isCached: boolean;
}

export interface HistoricalAnswerResult {
  version: PageVersionRecord;
  page: PageRecord;
  answer: string;
  citedContentExcerpt: string;
  screenshotUrl: string;
}

export class HistoryService {
  /**
   * Resolves the latest archived version at or before the requested cutoff date.
   * INVARIANT: Never returns a future version for a past date.
   */
  async resolveAsOfVersion(pageId: string, cutoffDate: Date): Promise<PageVersionRecord | null> {
    const res = await query<PageVersionRecord>(
      `SELECT * FROM page_versions 
       WHERE page_id = $1 AND observed_at <= $2 
       ORDER BY observed_at DESC, version_number DESC 
       LIMIT 1`,
      [pageId, cutoffDate]
    );
    return res.rows[0] || null;
  }

  /**
   * Compares two versions for a page, calculates deterministic diff,
   * generates Gemma explanation, and persists/caches in page_diffs.
   */
  async compareVersions(pageId: string, fromVersionId: string | null, toVersionId: string): Promise<ComparisonResult> {
    const page = await pageService.getPage(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);

    // 1. Fetch toVersion
    const toRes = await query<PageVersionRecord>('SELECT * FROM page_versions WHERE id = $1 AND page_id = $2', [toVersionId, pageId]);
    if (toRes.rowCount === 0) throw new Error(`Target version not found: ${toVersionId}`);
    const toVersion = toRes.rows[0];

    // 2. Fetch fromVersion (if specified)
    let fromVersion: PageVersionRecord | null = null;
    if (fromVersionId) {
      const fromRes = await query<PageVersionRecord>('SELECT * FROM page_versions WHERE id = $1 AND page_id = $2', [fromVersionId, pageId]);
      if (fromRes.rowCount === 0) throw new Error(`Source version not found: ${fromVersionId}`);
      fromVersion = fromRes.rows[0];
    }

    // 3. Check cached diff in database
    const cachedDiff = await query<PageDiffRecord>(
      `SELECT * FROM page_diffs 
       WHERE page_id = $1 AND ((from_version_id = $2) OR (from_version_id IS NULL AND $2 IS NULL)) AND to_version_id = $3`,
      [pageId, fromVersionId, toVersionId]
    );

    if (cachedDiff.rowCount && cachedDiff.rowCount > 0) {
      const record = cachedDiff.rows[0];
      return {
        fromVersion,
        toVersion,
        diff: record.diff_json,
        changeSummary: record.change_summary,
        significance: record.relevance,
        summaryStatus: record.summary_status,
        isCached: true,
      };
    }

    // 4. Read snapshots
    let oldMarkdown: string | null = null;
    if (fromVersion) {
      const oldBuf = await artifactStorage.readArtifact(fromVersion.content_artifact_path);
      oldMarkdown = oldBuf.toString('utf-8');
    }

    const newBuf = await artifactStorage.readArtifact(toVersion.content_artifact_path);
    const newMarkdown = newBuf.toString('utf-8');

    // 5. Deterministic diff computation
    const diff = diffEngine.computeDiff(oldMarkdown, newMarkdown);

    // 6. Gemma summary generation (or deterministic fallback)
    const summaryOutcome = await gemmaAdapter.generateSummary({
      pageName: page.name,
      category: page.category,
      objective: page.monitor_objective,
      diff,
    });

    const diffId = uuidv4();
    const now = new Date();

    // 7. Persist to page_diffs
    const insertSql = `
      INSERT INTO page_diffs (
        id, page_id, from_version_id, to_version_id, diff_json,
        change_summary, relevance, summary_status, llm_provider,
        llm_model, prompt_version, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      ) RETURNING *;
    `;

    const insertValues = [
      diffId,
      pageId,
      fromVersionId,
      toVersionId,
      JSON.stringify(diff),
      summaryOutcome.summary.summary,
      summaryOutcome.summary.significance,
      summaryOutcome.status,
      summaryOutcome.provider,
      summaryOutcome.model,
      summaryOutcome.promptVersion,
      now,
      now,
    ];

    await query(insertSql, insertValues);

    return {
      fromVersion,
      toVersion,
      diff,
      changeSummary: summaryOutcome.summary.summary,
      significance: summaryOutcome.summary.significance,
      summaryStatus: summaryOutcome.status,
      isCached: false,
    };
  }

  /**
   * Compares two arbitrary dates for the same page:
   * Resolves each date to the latest version at or before that date,
   * sorts them chronologically, and compares those two snapshots.
   */
  async compareDates(pageId: string, date1: Date, date2: Date): Promise<ComparisonResult> {
    const d1Time = date1.getTime();
    const d2Time = date2.getTime();

    const earlierDate = d1Time <= d2Time ? date1 : date2;
    const laterDate = d1Time <= d2Time ? date2 : date1;

    const fromVersion = await this.resolveAsOfVersion(pageId, earlierDate);
    const toVersion = await this.resolveAsOfVersion(pageId, laterDate);

    if (!toVersion) {
      throw new Error(`No historical snapshot exists for page at or before ${laterDate.toISOString()}`);
    }

    if (!fromVersion) {
      // If no version existed at earlier date, compare toVersion as baseline
      return this.compareVersions(pageId, null, toVersion.id);
    }

    return this.compareVersions(pageId, fromVersion.id, toVersion.id);
  }

  /**
   * Answers what a page said on a specific historical date.
   * Grounds the answer strictly in the archived Markdown snapshot.
   */
  async askHistoricalQuestion(pageId: string, asOfDate: Date, question: string): Promise<HistoricalAnswerResult> {
    const page = await pageService.getPage(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);

    const version = await this.resolveAsOfVersion(pageId, asOfDate);
    if (!version) {
      throw new Error(`No historical snapshot exists for page "${page.name}" at or before ${asOfDate.toISOString()}. Earliest capture history is unavailable.`);
    }

    const snapshotBuf = await artifactStorage.readArtifact(version.content_artifact_path);
    const snapshotText = snapshotBuf.toString('utf-8');

    // Call Gemma for grounded natural language synthesis with snapshot evidence
    const gemmaQa = await gemmaAdapter.answerQuestion({
      question,
      pageName: page.name,
      observedAt: new Date(version.observed_at),
      versionNumber: version.version_number,
      snapshotMarkdown: snapshotText,
    });

    const screenshotUrl = `/api/artifacts/${version.screenshot_artifact_path.replace(/\\/g, '/')}`;

    return {
      version,
      page,
      answer: gemmaQa.answer,
      citedContentExcerpt: gemmaQa.citedExcerpt,
      screenshotUrl,
    };
  }

  /**
   * Generates or retrieves a Gemma summary for an individual page version based on its snapshot.md.
   */
  async getVersionSummary(pageId: string, versionId: string): Promise<{
    version: PageVersionRecord;
    page: PageRecord;
    summary: {
      executiveSummary: string;
      keyPoints: string[];
      categoryContext: string;
      headings: string[];
      provider: string;
      model: string;
    };
    snapshotLength: number;
    screenshotUrl: string;
  }> {
    const page = await pageService.getPage(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);

    const vRes = await query<PageVersionRecord>(
      'SELECT * FROM page_versions WHERE id = $1 AND page_id = $2',
      [versionId, pageId]
    );
    if (vRes.rowCount === 0) throw new Error(`Version not found: ${versionId}`);
    const version = vRes.rows[0];

    const snapshotBuf = await artifactStorage.readArtifact(version.content_artifact_path);
    const snapshotText = snapshotBuf.toString('utf-8');

    const summary = await gemmaAdapter.summarizePageSnapshot({
      pageName: page.name,
      category: page.category,
      objective: page.monitor_objective,
      versionNumber: version.version_number,
      observedAt: new Date(version.observed_at),
      snapshotMarkdown: snapshotText,
    });

    const screenshotUrl = `/api/artifacts/${version.screenshot_artifact_path.replace(/\\/g, '/')}`;

    return {
      version,
      page,
      summary,
      snapshotLength: snapshotText.length,
      screenshotUrl,
    };
  }

  /**
   * Retrieves the raw snapshot.md content for a given version.
   */
  async getVersionSnapshotMarkdown(pageId: string, versionId: string): Promise<{
    version: PageVersionRecord;
    markdown: string;
  }> {
    const vRes = await query<PageVersionRecord>(
      'SELECT * FROM page_versions WHERE id = $1 AND page_id = $2',
      [versionId, pageId]
    );
    if (vRes.rowCount === 0) throw new Error(`Version not found: ${versionId}`);
    const version = vRes.rows[0];

    const snapshotBuf = await artifactStorage.readArtifact(version.content_artifact_path);
    return {
      version,
      markdown: snapshotBuf.toString('utf-8'),
    };
  }
}

export const historyService = new HistoryService();
