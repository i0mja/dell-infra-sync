-- Add missing columns to vcenter_hosts table that are sent by sync_vcenter_fast
ALTER TABLE vcenter_hosts 
ADD COLUMN IF NOT EXISTS cpu_usage_mhz BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS memory_usage_mb BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT DEFAULT 0,
ADD COLUMN IF NOT EXISTS memory_size BIGINT DEFAULT 0;