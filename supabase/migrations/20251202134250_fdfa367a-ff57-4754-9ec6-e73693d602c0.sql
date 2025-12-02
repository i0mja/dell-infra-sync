-- Add trusted_domains column for AD Trust user support
ALTER TABLE idm_settings ADD COLUMN IF NOT EXISTS trusted_domains text[] DEFAULT '{}';

-- Add comment explaining usage
COMMENT ON COLUMN idm_settings.trusted_domains IS 'List of trusted Active Directory domains for AD Trust authentication (e.g., neopost.ad, corp.local)';