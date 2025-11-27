-- Add firmware_upload and catalog_sync job types
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'firmware_upload';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'catalog_sync';

-- Create firmware_packages table
CREATE TABLE IF NOT EXISTS public.firmware_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  checksum TEXT,
  local_path TEXT,
  served_url TEXT,
  
  -- Dell metadata
  component_type TEXT NOT NULL, -- 'BIOS', 'iDRAC', 'NIC', 'RAID', 'Drivers', 'Other'
  dell_version TEXT NOT NULL,
  dell_package_version TEXT,
  applicable_models TEXT[], -- ['PowerEdge R640', 'PowerEdge R740']
  criticality TEXT, -- 'Critical', 'Recommended', 'Optional'
  release_date TIMESTAMP WITH TIME ZONE,
  reboot_required BOOLEAN DEFAULT true,
  
  -- User metadata
  description TEXT,
  tags TEXT[],
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Usage tracking
  upload_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'uploading', 'completed', 'failed'
  upload_progress INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  use_count INTEGER DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.firmware_packages ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Authenticated users can view firmware packages"
  ON public.firmware_packages FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and operators can manage firmware packages"
  ON public.firmware_packages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'operator')
    )
  );

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_firmware_packages_component_type ON public.firmware_packages(component_type);
CREATE INDEX IF NOT EXISTS idx_firmware_packages_upload_status ON public.firmware_packages(upload_status);

-- Update timestamp trigger
CREATE TRIGGER update_firmware_packages_updated_at
  BEFORE UPDATE ON public.firmware_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();