-- Fix idm_auth_sessions: Replace permissive "System can manage sessions" policy
-- Currently uses USING (true) FOR ALL which exposes all session data

DROP POLICY IF EXISTS "System can manage sessions" ON public.idm_auth_sessions;

-- Create separate policies for write operations (system use)
CREATE POLICY "System can insert sessions"
  ON public.idm_auth_sessions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update sessions"
  ON public.idm_auth_sessions
  FOR UPDATE
  USING (true);

CREATE POLICY "System can delete sessions"
  ON public.idm_auth_sessions
  FOR DELETE
  USING (true);

-- The existing SELECT policies handle read access correctly:
-- - "Admins can view all sessions" - admins see all
-- - "Users can view own sessions" - users see only their own

-- Fix auth_rate_limits: Replace permissive "System can manage rate limits" policy
-- Currently uses USING (true) FOR ALL which exposes login attempt data

DROP POLICY IF EXISTS "System can manage rate limits" ON public.auth_rate_limits;

-- Only admins should view rate limit data
CREATE POLICY "Admins can view rate limits"
  ON public.auth_rate_limits
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- System functions need write access only (check_auth_rate_limit and record_auth_attempt are SECURITY DEFINER)
CREATE POLICY "System can insert rate limits"
  ON public.auth_rate_limits
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "System can update rate limits"
  ON public.auth_rate_limits
  FOR UPDATE
  USING (true);

CREATE POLICY "System can delete rate limits"
  ON public.auth_rate_limits
  FOR DELETE
  USING (true);