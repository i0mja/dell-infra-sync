-- Normalize old 'connected' status to 'online' for consistency
UPDATE vcenter_hosts 
SET status = 'online' 
WHERE status = 'connected';