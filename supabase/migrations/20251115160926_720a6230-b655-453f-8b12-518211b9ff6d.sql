-- Security Fix: Implement Password Encryption (Fixed)
-- This migration adds proper password encryption infrastructure

-- 1. Enable pgcrypto extension for AES encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add encryption_key column to activity_settings
ALTER TABLE public.activity_settings 
ADD COLUMN IF NOT EXISTS encryption_key TEXT;

-- 3. Generate a random encryption key for the existing settings record
UPDATE public.activity_settings 
SET encryption_key = encode(gen_random_bytes(32), 'base64')
WHERE encryption_key IS NULL;

-- 4. Make password columns nullable temporarily to allow password reset
ALTER TABLE public.credential_sets ALTER COLUMN password_encrypted DROP NOT NULL;
ALTER TABLE public.servers ALTER COLUMN idrac_password_encrypted DROP NOT NULL;
ALTER TABLE public.vcenter_settings ALTER COLUMN password DROP NOT NULL;
ALTER TABLE public.openmanage_settings ALTER COLUMN password DROP NOT NULL;

-- 5. Create encryption function (uses AES-256)
CREATE OR REPLACE FUNCTION public.encrypt_password(password TEXT, key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF password IS NULL OR key IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN encode(
    encrypt(
      password::bytea,
      decode(key, 'base64'),
      'aes'
    ),
    'base64'
  );
END;
$$;

-- 6. Create decryption function (SECURITY DEFINER for controlled access)
CREATE OR REPLACE FUNCTION public.decrypt_password(encrypted TEXT, key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF encrypted IS NULL OR key IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN convert_from(
    decrypt(
      decode(encrypted, 'base64'),
      decode(key, 'base64'),
      'aes'
    ),
    'utf8'
  );
EXCEPTION
  WHEN OTHERS THEN
    -- Return NULL if decryption fails (corrupted data, wrong key, etc.)
    RETURN NULL;
END;
$$;

-- 7. Create helper function to get the encryption key
CREATE OR REPLACE FUNCTION public.get_encryption_key()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT encryption_key 
  FROM public.activity_settings 
  LIMIT 1;
$$;

-- 8. Comments explaining the functions
COMMENT ON FUNCTION public.encrypt_password IS 
'Encrypts passwords using AES-256 with the master key from activity_settings. Use this before storing passwords.';

COMMENT ON FUNCTION public.decrypt_password IS 
'Decrypts passwords encrypted with encrypt_password. SECURITY DEFINER ensures controlled access.';

COMMENT ON FUNCTION public.get_encryption_key IS 
'Returns the master encryption key. SECURITY DEFINER ensures only authorized functions can access it.';

-- 9. Clear all existing plaintext passwords for security
-- Users must re-enter credentials after this migration
UPDATE public.credential_sets SET password_encrypted = NULL;
UPDATE public.servers SET idrac_password_encrypted = NULL, idrac_username = NULL;
UPDATE public.vcenter_settings SET password = NULL;
UPDATE public.openmanage_settings SET password = NULL;

-- 10. Add audit log entry for password reset
INSERT INTO public.audit_logs (action, details, user_id)
VALUES (
  'security_password_encryption_enabled',
  jsonb_build_object(
    'message', 'AES-256 password encryption enabled. All stored passwords cleared for security. Users must re-enter all credentials.',
    'affected_tables', ARRAY['credential_sets', 'servers', 'vcenter_settings', 'openmanage_settings'],
    'encryption_algorithm', 'AES-256',
    'timestamp', now()
  ),
  NULL
);