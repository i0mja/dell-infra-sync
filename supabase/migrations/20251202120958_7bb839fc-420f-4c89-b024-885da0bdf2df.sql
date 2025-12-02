-- Drop existing auth_mode constraint
ALTER TABLE idm_settings DROP CONSTRAINT IF EXISTS idm_settings_auth_mode_check;

-- Add new constraint with code-matching values
ALTER TABLE idm_settings ADD CONSTRAINT idm_settings_auth_mode_check 
CHECK (auth_mode = ANY (ARRAY['local_only'::text, 'idm_primary'::text, 'idm_fallback'::text]));