-- Create vcenter_datastore_hosts junction table
CREATE TABLE public.vcenter_datastore_hosts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  datastore_id uuid NOT NULL REFERENCES vcenter_datastores(id) ON DELETE CASCADE,
  host_id uuid NOT NULL REFERENCES vcenter_hosts(id) ON DELETE CASCADE,
  source_vcenter_id uuid REFERENCES vcenters(id) ON DELETE CASCADE,
  mount_path text,
  accessible boolean DEFAULT true,
  read_only boolean DEFAULT false,
  last_sync timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(datastore_id, host_id)
);

-- Enable RLS
ALTER TABLE vcenter_datastore_hosts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view datastore hosts"
  ON vcenter_datastore_hosts
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage datastore hosts"
  ON vcenter_datastore_hosts
  FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'operator'));

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE vcenter_datastore_hosts;

-- Indexes for fast lookups
CREATE INDEX idx_datastore_hosts_datastore ON vcenter_datastore_hosts(datastore_id);
CREATE INDEX idx_datastore_hosts_host ON vcenter_datastore_hosts(host_id);
CREATE INDEX idx_datastore_hosts_vcenter ON vcenter_datastore_hosts(source_vcenter_id);

COMMENT ON TABLE vcenter_datastore_hosts IS 'Junction table tracking which ESXi hosts have access to which datastores';