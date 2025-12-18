-- Backfill vcenter_hosts.server_id from servers.vcenter_host_id
UPDATE vcenter_hosts h
SET server_id = s.id
FROM servers s
WHERE s.vcenter_host_id = h.id
  AND h.server_id IS NULL;