-- Add SMB/CIFS share configuration for SCP exports (fallback for older iDRAC)
ALTER TABLE activity_settings
ADD COLUMN scp_share_enabled BOOLEAN DEFAULT false,
ADD COLUMN scp_share_type TEXT DEFAULT 'CIFS' CHECK (scp_share_type IN ('CIFS', 'NFS')),
ADD COLUMN scp_share_path TEXT,
ADD COLUMN scp_share_username TEXT,
ADD COLUMN scp_share_password_encrypted TEXT;

COMMENT ON COLUMN activity_settings.scp_share_enabled IS 'Enable network share export for older iDRAC firmware that does not support Local export';
COMMENT ON COLUMN activity_settings.scp_share_type IS 'Share type: CIFS (Windows/SMB) or NFS';
COMMENT ON COLUMN activity_settings.scp_share_path IS 'Full UNC path for CIFS (e.g., \\server\share\exports) or NFS mount path';
COMMENT ON COLUMN activity_settings.scp_share_username IS 'Username for CIFS share authentication';
COMMENT ON COLUMN activity_settings.scp_share_password_encrypted IS 'Encrypted password for CIFS share authentication';