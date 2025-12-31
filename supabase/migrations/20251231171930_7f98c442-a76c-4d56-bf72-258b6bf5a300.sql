-- Add encrypted shared secret column to activity_settings
ALTER TABLE activity_settings 
ADD COLUMN IF NOT EXISTS executor_shared_secret_encrypted text;

COMMENT ON COLUMN activity_settings.executor_shared_secret_encrypted IS 
  'Encrypted shared secret for HMAC authentication between executor and edge functions';