-- Add additional metadata fields for SCP backups
ALTER TABLE public.scp_backups
ADD COLUMN IF NOT EXISTS scp_checksum TEXT,
ADD COLUMN IF NOT EXISTS components TEXT;
