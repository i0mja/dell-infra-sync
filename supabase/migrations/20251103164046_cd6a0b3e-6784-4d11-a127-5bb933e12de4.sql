-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('admin', 'operator', 'viewer');

-- Create enum for job status
CREATE TYPE public.job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');

-- Create enum for job type
CREATE TYPE public.job_type AS ENUM ('firmware_update', 'discovery_scan', 'vcenter_sync');

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create user_roles table for RBAC
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- Create servers table (Dell iDRAC inventory)
CREATE TABLE public.servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ip_address TEXT NOT NULL UNIQUE,
  hostname TEXT,
  model TEXT,
  service_tag TEXT UNIQUE,
  idrac_firmware TEXT,
  bios_version TEXT,
  cpu_count INTEGER,
  memory_gb INTEGER,
  last_seen TIMESTAMPTZ,
  vcenter_host_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create vcenter_hosts table (ESXi hosts)
CREATE TABLE public.vcenter_hosts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  cluster TEXT,
  vcenter_id TEXT UNIQUE,
  serial_number TEXT,
  server_id UUID REFERENCES public.servers(id) ON DELETE SET NULL,
  esxi_version TEXT,
  status TEXT DEFAULT 'unknown',
  maintenance_mode BOOLEAN DEFAULT FALSE,
  last_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add foreign key from servers to vcenter_hosts
ALTER TABLE public.servers 
ADD CONSTRAINT fk_servers_vcenter_host 
FOREIGN KEY (vcenter_host_id) REFERENCES public.vcenter_hosts(id) ON DELETE SET NULL;

-- Create jobs table
CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type public.job_type NOT NULL,
  status public.job_status NOT NULL DEFAULT 'pending',
  target_scope JSONB,
  details JSONB,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  schedule_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Create job_tasks table (granular tracking)
CREATE TABLE public.job_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  server_id UUID REFERENCES public.servers(id),
  vcenter_host_id UUID REFERENCES public.vcenter_hosts(id),
  status public.job_status NOT NULL DEFAULT 'pending',
  log TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES public.profiles(id),
  action TEXT NOT NULL,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  
  -- Assign default viewer role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer');
  
  RETURN NEW;
END;
$$;

-- Trigger for new user creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to check user role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Add update triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_servers_updated_at BEFORE UPDATE ON public.servers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vcenter_hosts_updated_at BEFORE UPDATE ON public.vcenter_hosts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vcenter_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for user_roles
CREATE POLICY "Users can view all roles" ON public.user_roles
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for servers
CREATE POLICY "Authenticated users can view servers" ON public.servers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can insert servers" ON public.servers
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

CREATE POLICY "Admins and operators can update servers" ON public.servers
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

CREATE POLICY "Admins can delete servers" ON public.servers
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for vcenter_hosts
CREATE POLICY "Authenticated users can view vcenter hosts" ON public.vcenter_hosts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage vcenter hosts" ON public.vcenter_hosts
  FOR ALL USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

-- RLS Policies for jobs
CREATE POLICY "Authenticated users can view jobs" ON public.jobs
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can create jobs" ON public.jobs
  FOR INSERT WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

CREATE POLICY "Admins and operators can update jobs" ON public.jobs
  FOR UPDATE USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

-- RLS Policies for job_tasks
CREATE POLICY "Authenticated users can view job tasks" ON public.job_tasks
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage job tasks" ON public.job_tasks
  FOR ALL USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'operator')
  );

-- RLS Policies for audit_logs
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert audit logs" ON public.audit_logs
  FOR INSERT WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX idx_servers_service_tag ON public.servers(service_tag);
CREATE INDEX idx_servers_ip_address ON public.servers(ip_address);
CREATE INDEX idx_vcenter_hosts_serial ON public.vcenter_hosts(serial_number);
CREATE INDEX idx_vcenter_hosts_cluster ON public.vcenter_hosts(cluster);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_created_by ON public.jobs(created_by);
CREATE INDEX idx_job_tasks_job_id ON public.job_tasks(job_id);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);