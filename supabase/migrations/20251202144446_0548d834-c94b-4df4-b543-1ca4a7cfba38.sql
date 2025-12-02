-- Add ad_domain_fqdn field to idm_settings for explicit NETBIOS-to-FQDN mapping
ALTER TABLE idm_settings ADD COLUMN IF NOT EXISTS ad_domain_fqdn TEXT DEFAULT NULL;

-- Add comment explaining the field
COMMENT ON COLUMN idm_settings.ad_domain_fqdn IS 'Explicit AD domain FQDN (e.g., neopost.ad) used when NETBIOS name (e.g., NEOPOSTAD) differs from the domain FQDN';