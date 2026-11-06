-- Migration 002: Final Audit, Resilience, and Schema Completeness
-- Adds missing fields for run tracking, version baseline flag, and webhook retry tracking.

-- 1. monitor_runs enhancements
ALTER TABLE monitor_runs ADD COLUMN IF NOT EXISTS screenshot_artifact_path TEXT;
ALTER TABLE monitor_runs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

-- 2. page_versions enhancements
ALTER TABLE page_versions ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE page_versions ADD COLUMN IF NOT EXISTS html_artifact_path TEXT;

-- 3. Update existing version 1 records to is_baseline = true
UPDATE page_versions SET is_baseline = true WHERE version_number = 1;

-- 4. webhook_events enhancements
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_error TEXT;

-- 5. Indexes for fast as-of historical lookup and idempotency
CREATE INDEX IF NOT EXISTS ix_page_versions_as_of ON page_versions (page_id, observed_at ASC);
CREATE INDEX IF NOT EXISTS ix_monitor_runs_idempotency ON monitor_runs (idempotency_key);
