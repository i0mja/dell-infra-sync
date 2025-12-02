-- Add AD-specific service account credentials to idm_settings
ALTER TABLE idm_settings 
ADD COLUMN IF NOT EXISTS ad_bind_dn text,
ADD COLUMN IF NOT EXISTS ad_bind_password_encrypted text;

COMMENT ON COLUMN idm_settings.ad_bind_dn IS 'AD service account for LDAP bind (e.g., svc_ldap@neopost.ad or CN=svc_ldap,CN=Users,DC=neopost,DC=ad)';
COMMENT ON COLUMN idm_settings.ad_bind_password_encrypted IS 'Encrypted password for AD service account';