-- Fix: Remove the overly permissive policy we just added
DROP POLICY IF EXISTS "Anyone can read auth mode" ON idm_settings;

-- Better approach: Use a SECURITY DEFINER function to safely expose minimal data
CREATE OR REPLACE FUNCTION public.get_idm_auth_mode()
RETURNS TABLE (auth_mode text, session_timeout_minutes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth_mode, session_timeout_minutes 
  FROM idm_settings 
  LIMIT 1;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION public.get_idm_auth_mode() TO anon, authenticated;

-- Drop the view since we're using a function instead
DROP VIEW IF EXISTS public.idm_public_config;