-- Add server_ids column to maintenance_windows table to support individual server maintenance
ALTER TABLE maintenance_windows 
ADD COLUMN server_ids uuid[] NULL;

COMMENT ON COLUMN maintenance_windows.server_ids IS 'Individual server IDs for standalone maintenance (not part of a cluster or group)';