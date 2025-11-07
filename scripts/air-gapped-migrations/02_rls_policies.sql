-- Row Level Security Policies Migration (Air-Gapped Mode)
-- This migration enables RLS and creates security policies for all tables

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcenter_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.openmanage_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Authenticated users can view servers" ON public.servers;
DROP POLICY IF EXISTS "Admins and operators can insert servers" ON public.servers;
DROP POLICY IF EXISTS "Admins and operators can update servers" ON public.servers;
DROP POLICY IF EXISTS "Admins can delete servers" ON public.servers;
DROP POLICY IF EXISTS "Authenticated users can view vcenter hosts" ON public.vcenter_hosts;
DROP POLICY IF EXISTS "Admins and operators can manage vcenter hosts" ON public.vcenter_hosts;
DROP POLICY IF EXISTS "Authenticated users can view jobs" ON public.jobs;
DROP POLICY IF EXISTS "Admins and operators can create jobs" ON public.jobs;
DROP POLICY IF EXISTS "Admins and operators can update jobs" ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can view job tasks" ON public.job_tasks;
DROP POLICY IF EXISTS "Admins and operators can manage job tasks" ON public.job_tasks;
DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Authenticated users can view notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Admins can manage notification settings" ON public.notification_settings;
DROP POLICY IF EXISTS "Admins can manage openmanage settings" ON public.openmanage_settings;
DROP POLICY IF EXISTS "Users can view own tokens" ON public.api_tokens;
DROP POLICY IF EXISTS "Users can create own tokens" ON public.api_tokens;
DROP POLICY IF EXISTS "Users can delete own tokens" ON public.api_tokens;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON public.profiles FOR SELECT
  USING (TRUE);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- User roles policies
CREATE POLICY "Users can view all roles"
  ON public.user_roles FOR SELECT
  USING (TRUE);

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Servers policies
CREATE POLICY "Authenticated users can view servers"
  ON public.servers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can insert servers"
  ON public.servers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins and operators can update servers"
  ON public.servers FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins can delete servers"
  ON public.servers FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- VCenter hosts policies
CREATE POLICY "Authenticated users can view vcenter hosts"
  ON public.vcenter_hosts FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter hosts"
  ON public.vcenter_hosts FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- Jobs policies
CREATE POLICY "Authenticated users can view jobs"
  ON public.jobs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can create jobs"
  ON public.jobs FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

CREATE POLICY "Admins and operators can update jobs"
  ON public.jobs FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- Job tasks policies
CREATE POLICY "Authenticated users can view job tasks"
  ON public.job_tasks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage job tasks"
  ON public.job_tasks FOR ALL
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator'));

-- Audit logs policies
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (TRUE);

-- Notification settings policies
CREATE POLICY "Authenticated users can view notification settings"
  ON public.notification_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage notification settings"
  ON public.notification_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- OpenManage settings policies
CREATE POLICY "Admins can manage openmanage settings"
  ON public.openmanage_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- API tokens policies
CREATE POLICY "Users can view own tokens"
  ON public.api_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tokens"
  ON public.api_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
  ON public.api_tokens FOR DELETE
  USING (auth.uid() = user_id);
