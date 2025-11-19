-- Create server_groups table
CREATE TABLE server_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  group_type text NOT NULL DEFAULT 'application',
  color text DEFAULT '#3b82f6',
  icon text DEFAULT 'Server',
  min_healthy_servers integer DEFAULT 1,
  created_by uuid REFERENCES profiles(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Many-to-many relationship between servers and groups
CREATE TABLE server_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_group_id uuid REFERENCES server_groups(id) ON DELETE CASCADE,
  server_id uuid REFERENCES servers(id) ON DELETE CASCADE,
  role text,
  priority integer DEFAULT 100,
  added_at timestamp with time zone DEFAULT now(),
  UNIQUE(server_group_id, server_id)
);

-- Server group safety checks (parallel to cluster_safety_checks)
CREATE TABLE server_group_safety_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_group_id uuid REFERENCES server_groups(id),
  job_id uuid REFERENCES jobs(id),
  check_timestamp timestamp with time zone DEFAULT now(),
  safe_to_proceed boolean NOT NULL,
  total_servers integer NOT NULL,
  healthy_servers integer NOT NULL,
  min_required_servers integer NOT NULL,
  warnings text[],
  details jsonb,
  is_scheduled boolean DEFAULT false,
  scheduled_check_id uuid REFERENCES scheduled_safety_checks(id),
  previous_status text,
  status_changed boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Extend maintenance_windows to support server groups
ALTER TABLE maintenance_windows 
  ADD COLUMN server_group_ids uuid[],
  ALTER COLUMN cluster_ids DROP NOT NULL;

-- RLS Policies for server_groups
ALTER TABLE server_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can manage server groups" 
  ON server_groups FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Authenticated users can view server groups" 
  ON server_groups FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for server_group_members
ALTER TABLE server_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can manage group members" 
  ON server_group_members FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Authenticated users can view group members" 
  ON server_group_members FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- RLS Policies for server_group_safety_checks
ALTER TABLE server_group_safety_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and operators can insert group safety checks" 
  ON server_group_safety_checks FOR INSERT 
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Authenticated users can view group safety checks" 
  ON server_group_safety_checks FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- Indexes for performance
CREATE INDEX idx_server_group_members_group ON server_group_members(server_group_id);
CREATE INDEX idx_server_group_members_server ON server_group_members(server_id);
CREATE INDEX idx_server_group_safety_checks_group ON server_group_safety_checks(server_group_id);
CREATE INDEX idx_server_group_safety_checks_timestamp ON server_group_safety_checks(check_timestamp);

-- Trigger for updated_at
CREATE TRIGGER update_server_groups_updated_at
  BEFORE UPDATE ON server_groups
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();