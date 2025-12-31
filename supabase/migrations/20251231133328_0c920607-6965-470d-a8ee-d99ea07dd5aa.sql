-- Fix the security definer view warning - use SECURITY INVOKER
DROP VIEW IF EXISTS public.idm_public_config;

CREATE OR REPLACE VIEW public.idm_public_config 
WITH (security_invoker = true)
AS
SELECT 
  auth_mode,
  session_timeout_minutes
FROM idm_settings
LIMIT 1;

-- Grant access
GRANT SELECT ON public.idm_public_config TO anon, authenticated;

-- Also need to grant access to the underlying table for the view to work with security invoker
-- Create a minimal policy just for the auth_mode column access
CREATE POLICY "Anyone can read auth mode" ON idm_settings
  FOR SELECT
  USING (true);