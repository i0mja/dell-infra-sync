-- Add missing SCP backup metadata columns
ALTER TABLE public.scp_backups
ADD COLUMN IF NOT EXISTS scp_checksum TEXT,
ADD COLUMN IF NOT EXISTS components TEXT;