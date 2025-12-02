-- Add AD Domain Controller fields for AD Trust pass-through authentication
ALTER TABLE idm_settings ADD COLUMN IF NOT EXISTS ad_dc_host text DEFAULT NULL;
ALTER TABLE idm_settings ADD COLUMN IF NOT EXISTS ad_dc_port integer DEFAULT 636;

-- Add comment for documentation
COMMENT ON COLUMN idm_settings.ad_dc_host IS 'Active Directory Domain Controller hostname for AD Trust pass-through authentication';
COMMENT ON COLUMN idm_settings.ad_dc_port IS 'AD DC LDAPS port (default 636)';