-- Add columns to store raw SCP content and format for proper Dell Redfish API handling
ALTER TABLE scp_backups 
ADD COLUMN IF NOT EXISTS scp_raw_content TEXT,
ADD COLUMN IF NOT EXISTS scp_format TEXT DEFAULT 'JSON' CHECK (scp_format IN ('JSON', 'XML'));