-- Add new job type for AD group search
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'idm_search_ad_groups';

-- Add source column to idm_group_mappings to distinguish FreeIPA vs AD groups
ALTER TABLE idm_group_mappings ADD COLUMN IF NOT EXISTS source text DEFAULT 'freeipa';

-- Add check constraint for source values
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'idm_group_mappings_source_check'
  ) THEN
    ALTER TABLE idm_group_mappings ADD CONSTRAINT idm_group_mappings_source_check 
    CHECK (source IN ('freeipa', 'ad'));
  END IF;
END $$;