-- Fix search path to include extensions schema for pgcrypto functions

CREATE OR REPLACE FUNCTION public.encrypt_password(password text, key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF password IS NULL OR key IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN encode(
    encrypt(
      password::bytea,
      decode(key, 'base64'),
      'aes'::text
    ),
    'base64'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_password(encrypted text, key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF encrypted IS NULL OR key IS NULL THEN
    RETURN NULL;
  END IF;
  
  RETURN convert_from(
    decrypt(
      decode(encrypted, 'base64'),
      decode(key, 'base64'),
      'aes'::text
    ),
    'utf8'
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;