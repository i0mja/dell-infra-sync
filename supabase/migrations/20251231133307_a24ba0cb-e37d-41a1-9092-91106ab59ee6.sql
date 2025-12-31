-- Fix #1: Restrict profiles table to self + admins (was exposing all user data)
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;

CREATE POLICY "Users view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins view all profiles"
  ON profiles FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Also allow operators to view profiles for job attribution/user management
CREATE POLICY "Operators view all profiles"
  ON profiles FOR SELECT
  USING (has_role(auth.uid(), 'operator'::app_role));

-- Fix #2: Restrict idm_settings and create public view for auth_mode only
DROP POLICY IF EXISTS "Public can read auth mode for login" ON idm_settings;

-- Create a limited view for login page that only exposes auth_mode
CREATE OR REPLACE VIEW public.idm_public_config AS
SELECT 
  auth_mode,
  session_timeout_minutes
FROM idm_settings
LIMIT 1;

-- Grant anonymous and authenticated access to the view
GRANT SELECT ON public.idm_public_config TO anon, authenticated;

-- Revoke direct table access from non-admins (admins keep full access via existing policy)
REVOKE SELECT ON idm_settings FROM anon;