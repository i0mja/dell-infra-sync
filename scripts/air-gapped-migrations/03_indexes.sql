-- Performance Indexes Migration (Air-Gapped Mode)
-- This migration creates indexes for frequently queried columns

-- Drop existing indexes if they exist
DROP INDEX IF EXISTS idx_profiles_email;
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_user_roles_role;
DROP INDEX IF EXISTS idx_servers_ip_address;
DROP INDEX IF EXISTS idx_servers_hostname;
DROP INDEX IF EXISTS idx_servers_service_tag;
DROP INDEX IF EXISTS idx_servers_connection_status;
DROP INDEX IF EXISTS idx_servers_vcenter_host_id;
DROP INDEX IF EXISTS idx_servers_openmanage_device_id;
DROP INDEX IF EXISTS idx_servers_created_at;
DROP INDEX IF EXISTS idx_vcenter_hosts_vcenter_id;
DROP INDEX IF EXISTS idx_vcenter_hosts_serial_number;
DROP INDEX IF EXISTS idx_vcenter_hosts_server_id;
DROP INDEX IF EXISTS idx_vcenter_hosts_status;
DROP INDEX IF EXISTS idx_jobs_status;
DROP INDEX IF EXISTS idx_jobs_job_type;
DROP INDEX IF EXISTS idx_jobs_created_by;
DROP INDEX IF EXISTS idx_jobs_parent_job_id;
DROP INDEX IF EXISTS idx_jobs_schedule_at;
DROP INDEX IF EXISTS idx_jobs_created_at;
DROP INDEX IF EXISTS idx_job_tasks_job_id;
DROP INDEX IF EXISTS idx_job_tasks_server_id;
DROP INDEX IF EXISTS idx_job_tasks_vcenter_host_id;
DROP INDEX IF EXISTS idx_job_tasks_status;
DROP INDEX IF EXISTS idx_job_tasks_created_at;
DROP INDEX IF EXISTS idx_audit_logs_user_id;
DROP INDEX IF EXISTS idx_audit_logs_action;
DROP INDEX IF EXISTS idx_audit_logs_timestamp;
DROP INDEX IF EXISTS idx_api_tokens_user_id;
DROP INDEX IF EXISTS idx_api_tokens_token_hash;
DROP INDEX IF EXISTS idx_api_tokens_expires_at;

-- Profiles indexes
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- User roles indexes
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role ON public.user_roles(role);

-- Servers indexes
CREATE INDEX idx_servers_ip_address ON public.servers(ip_address);
CREATE INDEX idx_servers_hostname ON public.servers(hostname);
CREATE INDEX idx_servers_service_tag ON public.servers(service_tag);
CREATE INDEX idx_servers_connection_status ON public.servers(connection_status);
CREATE INDEX idx_servers_vcenter_host_id ON public.servers(vcenter_host_id);
CREATE INDEX idx_servers_openmanage_device_id ON public.servers(openmanage_device_id);
CREATE INDEX idx_servers_created_at ON public.servers(created_at DESC);

-- VCenter hosts indexes
CREATE INDEX idx_vcenter_hosts_vcenter_id ON public.vcenter_hosts(vcenter_id);
CREATE INDEX idx_vcenter_hosts_serial_number ON public.vcenter_hosts(serial_number);
CREATE INDEX idx_vcenter_hosts_server_id ON public.vcenter_hosts(server_id);
CREATE INDEX idx_vcenter_hosts_status ON public.vcenter_hosts(status);

-- Jobs indexes
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_jobs_job_type ON public.jobs(job_type);
CREATE INDEX idx_jobs_created_by ON public.jobs(created_by);
CREATE INDEX idx_jobs_parent_job_id ON public.jobs(parent_job_id);
CREATE INDEX idx_jobs_schedule_at ON public.jobs(schedule_at);
CREATE INDEX idx_jobs_created_at ON public.jobs(created_at DESC);

-- Job tasks indexes
CREATE INDEX idx_job_tasks_job_id ON public.job_tasks(job_id);
CREATE INDEX idx_job_tasks_server_id ON public.job_tasks(server_id);
CREATE INDEX idx_job_tasks_vcenter_host_id ON public.job_tasks(vcenter_host_id);
CREATE INDEX idx_job_tasks_status ON public.job_tasks(status);
CREATE INDEX idx_job_tasks_created_at ON public.job_tasks(created_at DESC);

-- Audit logs indexes
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs(timestamp DESC);

-- API tokens indexes
CREATE INDEX idx_api_tokens_user_id ON public.api_tokens(user_id);
CREATE INDEX idx_api_tokens_token_hash ON public.api_tokens(token_hash);
CREATE INDEX idx_api_tokens_expires_at ON public.api_tokens(expires_at);
