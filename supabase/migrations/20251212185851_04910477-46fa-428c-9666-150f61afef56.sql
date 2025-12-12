-- Create vcenter_datastore_vms junction table to track which VMs reside on which datastores
CREATE TABLE public.vcenter_datastore_vms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  datastore_id UUID NOT NULL REFERENCES vcenter_datastores(id) ON DELETE CASCADE,
  vm_id UUID NOT NULL REFERENCES vcenter_vms(id) ON DELETE CASCADE,
  source_vcenter_id UUID REFERENCES vcenters(id) ON DELETE CASCADE,
  -- Storage details
  committed_bytes BIGINT DEFAULT 0,
  uncommitted_bytes BIGINT DEFAULT 0,
  is_primary_datastore BOOLEAN DEFAULT false,  -- True if VM's vmx lives here
  last_sync TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(datastore_id, vm_id)
);

-- Indexes for fast lookups
CREATE INDEX idx_datastore_vms_datastore ON vcenter_datastore_vms(datastore_id);
CREATE INDEX idx_datastore_vms_vm ON vcenter_datastore_vms(vm_id);
CREATE INDEX idx_datastore_vms_vcenter ON vcenter_datastore_vms(source_vcenter_id);

-- RLS policies
ALTER TABLE vcenter_datastore_vms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view datastore VMs"
  ON vcenter_datastore_vms FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage datastore VMs"
  ON vcenter_datastore_vms FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "System can insert datastore VMs"
  ON vcenter_datastore_vms FOR INSERT
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE vcenter_datastore_vms IS 'Tracks which VMs are stored on which datastores, populated during vCenter sync';