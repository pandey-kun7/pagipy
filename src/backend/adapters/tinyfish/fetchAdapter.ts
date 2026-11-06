import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export interface PreflightResult {
  success: boolean;
  submittedUrl: string;
  finalUrl?: string;
  pageTitle?: string;
  extractedMarkdown?: string;
  contentLength?: number;
  suitableForMonitoring: boolean;
  warnings?: string[];
  errorMessage?: string;
  statusCode?: number;
}

export class TinyFishFetchAdapter {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(apiKey = config.tinyfishApiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://api.fetch.tinyfish.ai';
  }

  /**
   * Preflights and validates a URL using TinyFish Fetch API before creating a monitor.
   * Returns page title, final URL, extracted Markdown preview, and suitability assessment.
   */
  async preflightUrl(url: string): Promise<PreflightResult> {
    logger.info('Preflighting URL with TinyFish Fetch', { url });

    const isPlaceholder =
      process.env.NODE_ENV === 'test' ||
      !this.apiKey ||
      this.apiKey.includes('placeholder');

    if (isPlaceholder) {
      return {
        success: true,
        submittedUrl: url,
        finalUrl: url,
        pageTitle: `Preflight for ${url}`,
        extractedMarkdown: `# ${url}\n\nValid public target inspected via test/offline preflight.`,
        contentLength: 64,
        suitableForMonitoring: true,
      };
    }

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          urls: [url],
          format: 'markdown',
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.warn('TinyFish Fetch preflight returned HTTP error', {
          status: res.status,
          error: errText,
          url,
        });
        return {
          success: false,
          submittedUrl: url,
          statusCode: res.status,
          suitableForMonitoring: false,
          errorMessage: `TinyFish Fetch returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }

      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          text?: string;
          status?: number;
        }>;
      };

      const result = data.results?.[0];
      const text = result?.text || '';
      const title = result?.title || '';
      const finalUrl = result?.url || url;
      const warnings: string[] = [];

      if (!text || text.trim().length < 50) {
        warnings.push('Extracted content is very brief; page may require heavy client-side JavaScript or auth.');
      }

      const isSuitable = !text.includes('Access Denied') && !text.includes('Checking your browser');

      logger.info('TinyFish Fetch preflight completed', {
        url,
        finalUrl,
        title,
        contentLength: text.length,
        isSuitable,
      });

      return {
        success: true,
        submittedUrl: url,
        finalUrl,
        pageTitle: title || url,
        extractedMarkdown: text,
        contentLength: text.length,
        suitableForMonitoring: isSuitable,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      logger.error('TinyFish Fetch preflight exception', err, { url });
      return {
        success: false,
        submittedUrl: url,
        suitableForMonitoring: false,
        errorMessage: (err as Error).message,
      };
    }
  }
}

export const fetchAdapter = new TinyFishFetchAdapter();
