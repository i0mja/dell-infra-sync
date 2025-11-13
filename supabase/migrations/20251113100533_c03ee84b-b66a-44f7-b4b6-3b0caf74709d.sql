-- Add per-server credential storage columns to servers table
ALTER TABLE public.servers 
ADD COLUMN idrac_username TEXT,
ADD COLUMN idrac_password_encrypted TEXT,
ADD COLUMN credential_last_tested TIMESTAMPTZ,
ADD COLUMN credential_test_status TEXT CHECK (credential_test_status IN ('valid', 'invalid', 'unknown'));

-- Add comment for documentation
COMMENT ON COLUMN public.servers.idrac_username IS 'iDRAC username for this specific server. If null, executor uses default credentials.';
COMMENT ON COLUMN public.servers.idrac_password_encrypted IS 'Encrypted iDRAC password for this specific server. If null, executor uses default credentials.';
COMMENT ON COLUMN public.servers.credential_last_tested IS 'Timestamp of last credential validation test';
COMMENT ON COLUMN public.servers.credential_test_status IS 'Status of last credential test: valid, invalid, or unknown';