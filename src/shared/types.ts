export type ScheduleType = 'hourly' | 'daily' | 'weekly';

export type PageStatus =
  | 'pending'
  | 'active'
  | 'paused'
  | 'setup_failed'
  | 'archived'
  | 'attention_required';

export type RunTriggerType = 'scheduled' | 'manual';

export type RunStatus =
  | 'queued'
  | 'dispatching'
  | 'running'
  | 'awaiting_monitor_result'
  | 'processing'
  | 'succeeded'
  | 'partial_success'
  | 'failed'
  | 'timed_out';

export type IntegrationStatus =
  | 'not_started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';

export type MonitorOutcome = 'baseline' | 'changed' | 'unchanged' | 'unknown';

export type DiffSummaryStatus = 'pending' | 'complete' | 'failed' | 'skipped';

export type WebhookProcessingStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'retryable_error'
  | 'permanent_error'
  | 'unmatched';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'retryable_error'
  | 'permanent_error';

export interface PageRecord {
  id: string;
  name: string;
  submitted_url: string;
  canonical_url: string;
  last_observed_url: string | null;
  category: string | null;
  monitor_objective: string | null;
  monitor_external_id: string | null;
  status: PageStatus;
  schedule_type: ScheduleType;
  schedule_timezone: string;
  schedule_hour: number | null;
  schedule_minute: number | null;
  schedule_weekday: number | null;
  next_run_at: Date | string | null;
  last_run_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}

export interface MonitorRunRecord {
  id: string;
  page_id: string;
  trigger_type: RunTriggerType;
  status: RunStatus;
  idempotency_key: string;
  scheduled_for: Date | string | null;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  monitor_status: IntegrationStatus;
  browser_status: IntegrationStatus;
  monitor_external_run_id: string | null;
  monitor_started_at: Date | string | null;
  monitor_completed_at: Date | string | null;
  browser_started_at: Date | string | null;
  browser_completed_at: Date | string | null;
  monitor_outcome: MonitorOutcome | null;
  content_hash: string | null;
  version_id: string | null;
  error_code: string | null;
  error_message: string | null;
  screenshot_artifact_path?: string | null;
  retry_count?: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PageVersionRecord {
  id: string;
  page_id: string;
  run_id: string;
  version_number: number;
  observed_at: Date | string;
  source_url: string;
  content_format: string;
  raw_content_hash: string;
  normalized_content_hash: string;
  content_artifact_path: string;
  screenshot_artifact_path: string;
  is_baseline?: boolean;
  html_artifact_path?: string | null;
  created_at: Date | string;
}

export interface DiffCollectionItem {
  section?: string;
  path?: string;
  before?: string;
  after?: string;
  value?: string;
}

export interface StructuredDiff {
  has_changes: boolean;
  is_baseline: boolean;
  added: DiffCollectionItem[];
  removed: DiffCollectionItem[];
  modified: DiffCollectionItem[];
  summary_counts: {
    added: number;
    removed: number;
    modified: number;
  };
}

export interface PageDiffRecord {
  id: string;
  page_id: string;
  from_version_id: string | null;
  to_version_id: string;
  diff_json: StructuredDiff;
  change_summary: string | null;
  relevance: string | null;
  summary_status: DiffSummaryStatus;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_version: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface WebhookEventRecord {
  id: string;
  external_event_id: string | null;
  event_deduplication_key: string;
  page_id: string | null;
  run_id: string | null;
  monitor_external_id: string | null;
  payload_json: Record<string, unknown>;
  processing_status: WebhookProcessingStatus;
  received_at: Date | string;
  processed_at: Date | string | null;
  last_error: string | null;
  retry_count?: number;
  processing_error?: string | null;
}

export interface ProcessingJobRecord {
  id: string;
  job_type: string;
  entity_type: string | null;
  entity_id: string | null;
  payload_json: Record<string, unknown>;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}
