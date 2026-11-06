import { IntegrationStatus, MonitorOutcome } from '../../../shared/types.js';

export interface MonitorSetupResult {
  monitorExternalId: string;
  setupStatus: 'active' | 'pending' | 'failed';
  rawResponse?: unknown;
}

export interface MonitorInvocationResult {
  success: boolean;
  externalRunId?: string;
  isAsync: boolean;
  outcome?: MonitorOutcome;
  contentMarkdown?: string;
  rawResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface BrowserCaptureResult {
  success: boolean;
  screenshotBuffer?: Buffer;
  mimeType?: string;
  renderedContent?: string;
  pageTitle?: string;
  rawResponse?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export interface ITinyFishMonitorAdapter {
  setupMonitor(params: {
    pageId: string;
    url: string;
    objective?: string | null;
  }): Promise<MonitorSetupResult>;

  triggerCheck(params: {
    pageId: string;
    runId: string;
    url: string;
    monitorExternalId?: string | null;
    objective?: string | null;
  }): Promise<MonitorInvocationResult>;
}

export interface ITinyFishBrowserAdapter {
  captureScreenshot(params: {
    pageId: string;
    runId: string;
    url: string;
  }): Promise<BrowserCaptureResult>;
}
