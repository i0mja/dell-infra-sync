-- Add firmware_inventory_scan job type
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'firmware_inventory_scan';

-- Create server_firmware_inventory table
CREATE TABLE IF NOT EXISTS public.server_firmware_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id UUID NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Component details from iDRAC /redfish/v1/UpdateService/FirmwareInventory
  component_id TEXT NOT NULL,
  component_name TEXT NOT NULL,
  component_type TEXT,
  version TEXT NOT NULL,
  updateable BOOLEAN DEFAULT true,
  status TEXT,
  
  -- Dell OEM fields
  device_id TEXT,
  component_category TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Unique constraint: one entry per component per collection
  CONSTRAINT unique_component_per_collection UNIQUE(server_id, component_id, collected_at)
);

-- Indexes for efficient queries
CREATE INDEX idx_firmware_inventory_server ON public.server_firmware_inventory(server_id);
CREATE INDEX idx_firmware_inventory_collected ON public.server_firmware_inventory(collected_at DESC);
CREATE INDEX idx_firmware_inventory_category ON public.server_firmware_inventory(component_category);
CREATE INDEX idx_firmware_inventory_version ON public.server_firmware_inventory(version);
CREATE INDEX idx_firmware_inventory_job ON public.server_firmware_inventory(job_id);

-- Enable RLS
ALTER TABLE public.server_firmware_inventory ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view firmware inventory"
  ON public.server_firmware_inventory FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert firmware inventory"
  ON public.server_firmware_inventory FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Admins and operators can manage firmware inventory"
  ON public.server_firmware_inventory FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'operator')
    )
  );

-- Add baseline tracking columns to firmware_packages
ALTER TABLE public.firmware_packages 
  ADD COLUMN IF NOT EXISTS is_baseline BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS baseline_for_models TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS component_name_pattern TEXT;

-- Index for baseline lookups
CREATE INDEX IF NOT EXISTS idx_firmware_packages_baseline 
  ON public.firmware_packages(is_baseline) 
  WHERE is_baseline = true;