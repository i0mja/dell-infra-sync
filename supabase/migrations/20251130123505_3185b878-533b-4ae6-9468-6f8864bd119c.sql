-- Phase 1: FreeIPA/IDM Integration - Database Schema
-- =====================================================

-- 1. Create IDM Settings Table
CREATE TABLE IF NOT EXISTS public.idm_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Authentication mode
  auth_mode text NOT NULL DEFAULT 'local_only' CHECK (auth_mode IN ('local_only', 'idm_only', 'hybrid', 'idm_with_local_fallback')),
  
  -- FreeIPA Connection
  server_host text,
  server_port integer DEFAULT 389,
  use_ldaps boolean DEFAULT true,
  ldaps_port integer DEFAULT 636,
  base_dn text,
  user_search_base text DEFAULT 'cn=users,cn=accounts',
  group_search_base text DEFAULT 'cn=groups,cn=accounts',
  
  -- Service Account
  bind_dn text,
  bind_password_encrypted text,
  
  -- User Sync
  sync_enabled boolean DEFAULT false,
  sync_interval_minutes integer DEFAULT 60,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  
  -- Security Policies
  require_ldaps boolean DEFAULT true,
  verify_certificate boolean DEFAULT true,
  ca_certificate text,
  session_timeout_minutes integer DEFAULT 480,
  max_failed_attempts integer DEFAULT 5,
  lockout_duration_minutes integer DEFAULT 30,
  
  -- Failover
  failover_behavior text DEFAULT 'fail_secure' CHECK (failover_behavior IN ('fail_secure', 'fail_open_read_only', 'local_fallback')),
  connection_timeout_seconds integer DEFAULT 10,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.idm_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage IDM settings"
  ON public.idm_settings FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view IDM auth mode"
  ON public.idm_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 2. Create IDM Group Mappings Table
CREATE TABLE IF NOT EXISTS public.idm_group_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idm_group_dn text NOT NULL,
  idm_group_name text NOT NULL,
  app_role app_role NOT NULL,
  priority integer DEFAULT 100,
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(idm_group_dn)
);

ALTER TABLE public.idm_group_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage group mappings"
  ON public.idm_group_mappings FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view group mappings"
  ON public.idm_group_mappings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 3. Create IDM Auth Sessions Table
CREATE TABLE IF NOT EXISTS public.idm_auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  idm_user_dn text NOT NULL,
  idm_uid text NOT NULL,
  idm_groups jsonb,
  mapped_role app_role NOT NULL,
  auth_method text DEFAULT 'ldap_bind',
  session_started_at timestamptz DEFAULT now(),
  session_expires_at timestamptz,
  last_activity_at timestamptz DEFAULT now(),
  ip_address text,
  user_agent text,
  is_active boolean DEFAULT true,
  invalidated_at timestamptz,
  invalidation_reason text
);

ALTER TABLE public.idm_auth_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all sessions"
  ON public.idm_auth_sessions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own sessions"
  ON public.idm_auth_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can manage sessions"
  ON public.idm_auth_sessions FOR ALL
  USING (true)
  WITH CHECK (true);

-- 4. Create Break-Glass Admins Table
CREATE TABLE IF NOT EXISTS public.break_glass_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  is_active boolean DEFAULT false,
  activation_reason text,
  activated_at timestamptz,
  activated_by uuid REFERENCES public.profiles(id),
  deactivated_at timestamptz,
  last_used_at timestamptz,
  use_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id)
);

ALTER TABLE public.break_glass_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage break-glass accounts"
  ON public.break_glass_admins FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- 5. Create Auth Rate Limits Table
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('username', 'ip_address')),
  attempt_count integer DEFAULT 0,
  first_attempt_at timestamptz DEFAULT now(),
  last_attempt_at timestamptz DEFAULT now(),
  locked_until timestamptz,
  UNIQUE(identifier, identifier_type)
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can manage rate limits"
  ON public.auth_rate_limits FOR ALL
  USING (true)
  WITH CHECK (true);

-- 6. Rate Limiting Functions
CREATE OR REPLACE FUNCTION public.check_auth_rate_limit(
  p_identifier text,
  p_identifier_type text,
  p_max_attempts integer DEFAULT 5,
  p_lockout_minutes integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record auth_rate_limits%ROWTYPE;
  v_is_locked boolean := false;
  v_remaining_attempts integer;
  v_lockout_remaining_seconds integer;
BEGIN
  SELECT * INTO v_record 
  FROM auth_rate_limits 
  WHERE identifier = p_identifier AND identifier_type = p_identifier_type;
  
  IF NOT FOUND THEN
    INSERT INTO auth_rate_limits (identifier, identifier_type)
    VALUES (p_identifier, p_identifier_type)
    RETURNING * INTO v_record;
  END IF;
  
  IF v_record.locked_until IS NOT NULL AND v_record.locked_until > now() THEN
    v_is_locked := true;
    v_lockout_remaining_seconds := EXTRACT(EPOCH FROM (v_record.locked_until - now()))::integer;
  ELSE
    IF v_record.locked_until IS NOT NULL AND v_record.locked_until <= now() THEN
      UPDATE auth_rate_limits 
      SET attempt_count = 0, locked_until = NULL, first_attempt_at = now()
      WHERE id = v_record.id;
      v_record.attempt_count := 0;
    END IF;
  END IF;
  
  v_remaining_attempts := p_max_attempts - v_record.attempt_count;
  
  RETURN jsonb_build_object(
    'is_locked', v_is_locked,
    'attempt_count', v_record.attempt_count,
    'remaining_attempts', GREATEST(v_remaining_attempts, 0),
    'lockout_remaining_seconds', COALESCE(v_lockout_remaining_seconds, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_auth_attempt(
  p_identifier text,
  p_identifier_type text,
  p_success boolean,
  p_max_attempts integer DEFAULT 5,
  p_lockout_minutes integer DEFAULT 30
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count integer;
BEGIN
  IF p_success THEN
    DELETE FROM auth_rate_limits 
    WHERE identifier = p_identifier AND identifier_type = p_identifier_type;
  ELSE
    INSERT INTO auth_rate_limits (identifier, identifier_type, attempt_count, last_attempt_at)
    VALUES (p_identifier, p_identifier_type, 1, now())
    ON CONFLICT (identifier, identifier_type) 
    DO UPDATE SET 
      attempt_count = auth_rate_limits.attempt_count + 1,
      last_attempt_at = now()
    RETURNING attempt_count INTO v_new_count;
    
    IF v_new_count >= p_max_attempts THEN
      UPDATE auth_rate_limits 
      SET locked_until = now() + (p_lockout_minutes || ' minutes')::interval
      WHERE identifier = p_identifier AND identifier_type = p_identifier_type;
    END IF;
  END IF;
END;
$$;

-- 7. Extend Profiles Table
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS idm_source text DEFAULT 'local' CHECK (idm_source IN ('local', 'freeipa')),
  ADD COLUMN IF NOT EXISTS idm_user_dn text,
  ADD COLUMN IF NOT EXISTS idm_uid text,
  ADD COLUMN IF NOT EXISTS idm_groups jsonb,
  ADD COLUMN IF NOT EXISTS last_idm_sync timestamptz,
  ADD COLUMN IF NOT EXISTS idm_disabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS idm_mail text,
  ADD COLUMN IF NOT EXISTS idm_department text,
  ADD COLUMN IF NOT EXISTS idm_title text;

-- 8. Extend Audit Logs Table
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS auth_source text,
  ADD COLUMN IF NOT EXISTS idm_user_dn text,
  ADD COLUMN IF NOT EXISTS idm_groups_at_login jsonb,
  ADD COLUMN IF NOT EXISTS auth_method text;

-- 9. Add IDM Job Types
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_type') THEN
    RAISE EXCEPTION 'job_type enum does not exist';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'idm_authenticate' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_type')) THEN
    ALTER TYPE job_type ADD VALUE 'idm_authenticate';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'idm_sync_users' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_type')) THEN
    ALTER TYPE job_type ADD VALUE 'idm_sync_users';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'idm_test_connection' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'job_type')) THEN
    ALTER TYPE job_type ADD VALUE 'idm_test_connection';
  END IF;
END $$;