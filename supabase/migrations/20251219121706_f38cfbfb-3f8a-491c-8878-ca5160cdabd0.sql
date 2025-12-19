-- Phase 2: VM Snapshots, Custom Attributes, and vcenter_vms extensions

-- Step 5: Create vcenter_vm_snapshots table
CREATE TABLE IF NOT EXISTS public.vcenter_vm_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vm_id UUID NOT NULL REFERENCES public.vcenter_vms(id) ON DELETE CASCADE,
  snapshot_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ,
  size_bytes BIGINT DEFAULT 0,
  is_current BOOLEAN DEFAULT false,
  parent_snapshot_id TEXT,
  source_vcenter_id UUID REFERENCES public.vcenters(id) ON DELETE SET NULL,
  last_sync TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vm_id, snapshot_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_vm_snapshots_vm_id ON public.vcenter_vm_snapshots(vm_id);
CREATE INDEX IF NOT EXISTS idx_vm_snapshots_source ON public.vcenter_vm_snapshots(source_vcenter_id);

-- Enable RLS
ALTER TABLE public.vcenter_vm_snapshots ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view VM snapshots"
  ON public.vcenter_vm_snapshots
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage VM snapshots"
  ON public.vcenter_vm_snapshots
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "System can insert VM snapshots"
  ON public.vcenter_vm_snapshots
  FOR INSERT
  WITH CHECK (true);

-- Step 6: Create vcenter_vm_custom_attributes table
CREATE TABLE IF NOT EXISTS public.vcenter_vm_custom_attributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vm_id UUID NOT NULL REFERENCES public.vcenter_vms(id) ON DELETE CASCADE,
  attribute_key TEXT NOT NULL,
  attribute_value TEXT,
  source_vcenter_id UUID REFERENCES public.vcenters(id) ON DELETE SET NULL,
  last_sync TIMESTAMPTZ DEFAULT now(),
  UNIQUE(vm_id, attribute_key)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_vm_custom_attrs_vm_id ON public.vcenter_vm_custom_attributes(vm_id);
CREATE INDEX IF NOT EXISTS idx_vm_custom_attrs_source ON public.vcenter_vm_custom_attributes(source_vcenter_id);

-- Enable RLS
ALTER TABLE public.vcenter_vm_custom_attributes ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view VM custom attributes"
  ON public.vcenter_vm_custom_attributes
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage VM custom attributes"
  ON public.vcenter_vm_custom_attributes
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "System can insert VM custom attributes"
  ON public.vcenter_vm_custom_attributes
  FOR INSERT
  WITH CHECK (true);

-- Step 7: Extend vcenter_vms table with new columns
ALTER TABLE public.vcenter_vms 
  ADD COLUMN IF NOT EXISTS resource_pool TEXT,
  ADD COLUMN IF NOT EXISTS hardware_version TEXT,
  ADD COLUMN IF NOT EXISTS folder_path TEXT,
  ADD COLUMN IF NOT EXISTS snapshot_count INTEGER DEFAULT 0;