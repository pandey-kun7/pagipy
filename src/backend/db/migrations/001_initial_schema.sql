-- Migration 001: Initial Schema for Time Machine
-- Matches todo.md Section 3 specification

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 3.1 pages
CREATE TABLE IF NOT EXISTS pages (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    submitted_url TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    last_observed_url TEXT,
    category VARCHAR(100),
    monitor_objective TEXT,
    monitor_external_id VARCHAR(255) UNIQUE,
    status VARCHAR(50) NOT NULL,
    schedule_type VARCHAR(20) NOT NULL,
    schedule_timezone VARCHAR(100) NOT NULL,
    schedule_hour INTEGER,
    schedule_minute INTEGER,
    schedule_weekday INTEGER,
    next_run_at TIMESTAMP WITH TIME ZONE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    archived_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_pages_canonical_url ON pages (canonical_url);
CREATE INDEX IF NOT EXISTS ix_pages_next_run_at ON pages (next_run_at);

-- 3.2 monitor_runs
CREATE TABLE IF NOT EXISTS monitor_runs (
    id UUID PRIMARY KEY,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    trigger_type VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    scheduled_for TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    monitor_status VARCHAR(50) NOT NULL,
    browser_status VARCHAR(50) NOT NULL,
    monitor_external_run_id VARCHAR(255),
    monitor_started_at TIMESTAMP WITH TIME ZONE,
    monitor_completed_at TIMESTAMP WITH TIME ZONE,
    browser_started_at TIMESTAMP WITH TIME ZONE,
    browser_completed_at TIMESTAMP WITH TIME ZONE,
    monitor_outcome VARCHAR(50),
    content_hash VARCHAR(64),
    version_id UUID,
    error_code VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_monitor_runs_page_id ON monitor_runs (page_id);

-- 3.3 page_versions
CREATE TABLE IF NOT EXISTS page_versions (
    id UUID PRIMARY KEY,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES monitor_runs(id) ON DELETE RESTRICT UNIQUE,
    version_number INTEGER NOT NULL,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    source_url TEXT NOT NULL,
    content_format VARCHAR(50) NOT NULL,
    raw_content_hash VARCHAR(64) NOT NULL,
    normalized_content_hash VARCHAR(64) NOT NULL,
    content_artifact_path TEXT NOT NULL,
    screenshot_artifact_path TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_page_version_number UNIQUE (page_id, version_number)
);

CREATE INDEX IF NOT EXISTS ix_page_versions_page_id ON page_versions (page_id);
CREATE INDEX IF NOT EXISTS idx_page_observed_at_desc ON page_versions (page_id, observed_at DESC);

-- 3.4 page_diffs
CREATE TABLE IF NOT EXISTS page_diffs (
    id UUID PRIMARY KEY,
    page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    from_version_id UUID REFERENCES page_versions(id) ON DELETE SET NULL,
    to_version_id UUID NOT NULL REFERENCES page_versions(id) ON DELETE CASCADE,
    diff_json JSONB NOT NULL,
    change_summary TEXT,
    relevance VARCHAR(50),
    summary_status VARCHAR(50) NOT NULL,
    llm_provider VARCHAR(100),
    llm_model VARCHAR(100),
    prompt_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_diff_from_to_version UNIQUE (from_version_id, to_version_id)
);

CREATE INDEX IF NOT EXISTS ix_page_diffs_page_id ON page_diffs (page_id);
CREATE INDEX IF NOT EXISTS ix_page_diffs_from_version_id ON page_diffs (from_version_id);
CREATE INDEX IF NOT EXISTS ix_page_diffs_to_version_id ON page_diffs (to_version_id);
CREATE INDEX IF NOT EXISTS idx_diff_page_to_version ON page_diffs (page_id, to_version_id);

-- 3.5 webhook_events
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY,
    external_event_id VARCHAR(255),
    event_deduplication_key VARCHAR(255) NOT NULL UNIQUE,
    page_id UUID REFERENCES pages(id) ON DELETE SET NULL,
    run_id UUID REFERENCES monitor_runs(id) ON DELETE SET NULL,
    monitor_external_id VARCHAR(255),
    payload_json JSONB NOT NULL,
    processing_status VARCHAR(50) NOT NULL,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS ix_webhook_events_page_id ON webhook_events (page_id);
CREATE INDEX IF NOT EXISTS ix_webhook_events_run_id ON webhook_events (run_id);
CREATE INDEX IF NOT EXISTS ix_webhook_events_monitor_external_id ON webhook_events (monitor_external_id);

-- 3.6 processing_jobs
CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID PRIMARY KEY,
    job_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    payload_json JSONB NOT NULL,
    status VARCHAR(50) NOT NULL,
    attempt_count INTEGER NOT NULL,
    max_attempts INTEGER NOT NULL,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by VARCHAR(255),
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_processing_jobs_next_attempt_at ON processing_jobs (next_attempt_at);
