-- Create API tokens table for secure script authentication
CREATE TABLE public.api_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  last_used_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- Users can view their own tokens
CREATE POLICY "Users can view own tokens"
ON public.api_tokens
FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own tokens
CREATE POLICY "Users can create own tokens"
ON public.api_tokens
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can delete their own tokens
CREATE POLICY "Users can delete own tokens"
ON public.api_tokens
FOR DELETE
USING (auth.uid() = user_id);

-- Function to validate API token
CREATE OR REPLACE FUNCTION public.validate_api_token(token_input text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_user_id uuid;
BEGIN
  -- Hash the input token and look it up
  SELECT user_id INTO token_user_id
  FROM public.api_tokens
  WHERE token_hash = encode(digest(token_input, 'sha256'), 'hex')
    AND (expires_at IS NULL OR expires_at > now());
  
  -- Update last_used_at if token found
  IF token_user_id IS NOT NULL THEN
    UPDATE public.api_tokens
    SET last_used_at = now()
    WHERE token_hash = encode(digest(token_input, 'sha256'), 'hex');
  END IF;
  
  RETURN token_user_id;
END;
$$;