-- Add column for iDRAC-reported hostname (auto-updated by discovery)
ALTER TABLE servers ADD COLUMN idrac_hostname text;

-- Add helpful comments
COMMENT ON COLUMN servers.idrac_hostname IS 'Hostname reported by iDRAC Redfish API - auto-updated on discovery';
COMMENT ON COLUMN servers.hostname IS 'User-assigned display name - never auto-overwritten by discovery';