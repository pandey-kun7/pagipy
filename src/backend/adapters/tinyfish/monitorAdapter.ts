import {
  ITinyFishMonitorAdapter,
  MonitorInvocationResult,
  MonitorSetupResult,
} from './types.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { query } from '../../db/index.js';
import { MonitorOutcome } from '../../../shared/types.js';

/**
 * Adapter for TinyFish Monitor service.
 * 
 * Interacts with TinyFish Monitor API (https://agent.tinyfish.ai/v1/monitors).
 * Sets up monitors with target URLs, triggers on-demand runs via
 * POST /v1/monitors/{id}/runs, and extracts markdown page content directly
 * from the monitor's output results.
 */
export class TinyFishMonitorAdapter implements ITinyFishMonitorAdapter {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(apiKey = config.tinyfishApiKey, endpoint = config.tinyfishMonitorEndpoint) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
  }

  async setupMonitor(params: {
    pageId: string;
    url: string;
    objective?: string | null;
  }): Promise<MonitorSetupResult> {
    logger.info('Setting up TinyFish Monitor for page', { pageId: params.pageId, url: params.url });

    const isPlaceholder =
      process.env.NODE_ENV === 'test' ||
      !this.apiKey ||
      !this.endpoint ||
      this.apiKey.includes('placeholder') ||
      this.endpoint.includes('placeholder');

    if (isPlaceholder) {
      return {
        monitorExternalId: `tf-mon-placeholder-${params.pageId}`,
        setupStatus: 'active',
      };
    }

    try {
      const baseUrl = this.endpoint.replace(/\/+$/, '');

      // 1. Check if a monitor for this URL already exists on TinyFish
      const listRes = await fetch(`${baseUrl}/v1/monitors`, {
        headers: {
          'X-API-Key': this.apiKey,
        },
      });

      if (listRes.ok) {
        const listData = (await listRes.json()) as {
          monitors?: Array<{ id: string; config?: { url?: string }; status?: string }>;
        };
        const existing = listData.monitors?.find(
          (m) => m.config?.url?.toLowerCase() === params.url.toLowerCase()
        );

        if (existing) {
          logger.info('Found existing TinyFish Monitor for URL', {
            monitorId: existing.id,
            url: params.url,
            status: existing.status,
          });

          // Save to database
          await query(`UPDATE pages SET monitor_external_id = $1 WHERE id = $2`, [
            existing.id,
            params.pageId,
          ]).catch(() => {});

          return {
            monitorExternalId: existing.id,
            setupStatus: 'active',
            rawResponse: existing,
          };
        }
      }

      // 2. Create new monitor if not found
      const createRes = await fetch(`${baseUrl}/v1/monitors`, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `Page ${params.pageId.slice(0, 8)}`,
          schedule_cron: '0 * * * *',
          type: 'fetch',
          purpose: params.objective || undefined,
          config: {
            url: params.url,
            format: 'markdown',
            links: false,
            image_links: false,
            ttl: 0,
          },
        }),
      });

      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`TinyFish Monitor creation failed HTTP ${createRes.status}: ${errText}`);
      }

      const created = (await createRes.json()) as { id?: string; monitor?: { id: string } };
      const monitorId = created.id || created.monitor?.id;

      if (!monitorId) {
        throw new Error('TinyFish Monitor response missing monitor ID');
      }

      logger.info('Successfully created TinyFish Monitor', {
        monitorId,
        pageId: params.pageId,
        url: params.url,
      });

      // Save to database
      await query(`UPDATE pages SET monitor_external_id = $1 WHERE id = $2`, [
        monitorId,
        params.pageId,
      ]).catch(() => {});

      return {
        monitorExternalId: monitorId,
        setupStatus: 'active',
        rawResponse: created,
      };
    } catch (err) {
      logger.error('Failed to setup TinyFish monitor', err, { pageId: params.pageId });
      return {
        monitorExternalId: '',
        setupStatus: 'failed',
      };
    }
  }

  async triggerCheck(params: {
    pageId: string;
    runId: string;
    url: string;
    monitorExternalId?: string | null;
    objective?: string | null;
  }): Promise<MonitorInvocationResult> {
    logger.info('Invoking TinyFish Monitor check', {
      pageId: params.pageId,
      runId: params.runId,
      url: params.url,
      monitorExternalId: params.monitorExternalId || undefined,
    });

    const isPlaceholder =
      process.env.NODE_ENV === 'test' ||
      !this.apiKey ||
      !this.endpoint ||
      this.apiKey.includes('placeholder') ||
      this.endpoint.includes('placeholder');

    if (isPlaceholder) {
      return {
        success: true,
        isAsync: false,
        outcome: 'baseline',
        contentMarkdown: `# Content for ${params.url}\n\nAutomated observation captured at ${new Date().toISOString()}.\nObjective: ${params.objective || 'General monitoring'}\n`,
        externalRunId: `tf-run-${params.runId}`,
        rawResponse: { mode: 'adapter_placeholder', pageId: params.pageId, runId: params.runId },
      };
    }

    try {
      const baseUrl = this.endpoint.replace(/\/+$/, '');
      let monitorId = params.monitorExternalId;

      // If monitorExternalId is missing, resolve or create it
      if (!monitorId) {
        const setup = await this.setupMonitor({
          pageId: params.pageId,
          url: params.url,
          objective: params.objective,
        });
        if (setup.setupStatus === 'active' && setup.monitorExternalId) {
          monitorId = setup.monitorExternalId;
        }
      }

      if (monitorId) {
        // Execute on-demand monitor run via POST /v1/monitors/{id}/runs
        const runRes = await fetch(`${baseUrl}/v1/monitors/${monitorId}/runs`, {
          method: 'POST',
          headers: {
            'X-API-Key': this.apiKey,
          },
        });

        if (runRes.ok) {
          const runData = (await runRes.json()) as {
            run?: {
              id?: string;
              is_baseline?: boolean;
              results?: Array<{
                url?: string;
                title?: string;
                text?: string;
                not_modified?: boolean;
                format?: string;
              }>;
            };
          };

          const run = runData.run;
          const result = run?.results?.[0];
          const rawText = result?.text || '';
          const contentMarkdown = rawText
            ? (result?.title && !rawText.startsWith('#') ? `# ${result.title}\n\n${rawText}` : rawText)
            : `# Content for ${params.url}\n\n(No text content extracted)`;

          const outcome: MonitorOutcome = run?.is_baseline
            ? 'baseline'
            : result?.not_modified
              ? 'unchanged'
              : 'changed';

          logger.info('TinyFish Monitor check succeeded', {
            monitorId,
            runId: params.runId,
            externalRunId: run?.id,
            outcome,
            contentLength: contentMarkdown.length,
          });

          return {
            success: true,
            isAsync: false,
            outcome,
            contentMarkdown,
            externalRunId: run?.id || `tf-run-${params.runId}`,
            rawResponse: runData,
          };
        } else {
          const errText = await runRes.text();
          logger.warn('TinyFish Monitor run endpoint returned error, attempting fallback', {
            status: runRes.status,
            error: errText,
          });
        }
      }

      // Fallback to TinyFish Fetch API if monitor creation or execution hit unexpected error
      logger.info('Executing TinyFish Fetch fallback for monitor content', {
        url: params.url,
        runId: params.runId,
      });

      const fetchRes = await fetch('https://api.fetch.tinyfish.ai', {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: [params.url],
          format: 'markdown',
        }),
      });

      if (!fetchRes.ok) {
        const fetchErr = await fetchRes.text();
        throw new Error(`TinyFish Fetch API failed HTTP ${fetchRes.status}: ${fetchErr}`);
      }

      const fetchData = (await fetchRes.json()) as {
        results?: Array<{
          title?: string;
          text?: string;
          not_modified?: boolean;
        }>;
      };

      const item = fetchData.results?.[0];
      const text = item?.text || '';
      const contentMarkdown = text
        ? (item?.title && !text.startsWith('#') ? `# ${item.title}\n\n${text}` : text)
        : `# Content for ${params.url}\n\n(No content extracted)`;

      return {
        success: true,
        isAsync: false,
        outcome: item?.not_modified ? 'unchanged' : 'changed',
        contentMarkdown,
        externalRunId: `tf-fetch-${params.runId}`,
        rawResponse: fetchData,
      };
    } catch (err) {
      logger.error('TinyFish Monitor trigger error', err, {
        pageId: params.pageId,
        runId: params.runId,
        url: params.url,
      });
      return {
        success: false,
        isAsync: false,
        errorCode: 'MONITOR_TRIGGER_FAILED',
        errorMessage: (err as Error).message,
      };
    }
  }
}

export const monitorAdapter = new TinyFishMonitorAdapter();
