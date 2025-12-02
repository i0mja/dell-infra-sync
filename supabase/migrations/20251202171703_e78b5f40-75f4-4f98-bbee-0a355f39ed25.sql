-- Drop the old restrictive policy that requires authentication
DROP POLICY IF EXISTS "Authenticated users can view IDM auth mode" ON idm_settings;

-- Create new public access policy so login page can read auth_mode
CREATE POLICY "Public can read auth mode for login"
ON idm_settings
FOR SELECT
TO public, anon
USING (true);