-- ClickUp cross-workspace task sync mapping
-- Tracks which VantageBP tasks have been mirrored to the Personal workspace

CREATE TABLE IF NOT EXISTS clickup_task_sync (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vantagebp_task_id TEXT NOT NULL UNIQUE,
  personal_task_id TEXT NOT NULL UNIQUE,
  task_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for reverse lookup (personal → vantagebp)
CREATE INDEX IF NOT EXISTS idx_clickup_sync_personal
  ON clickup_task_sync (personal_task_id);
