-- Create iso_images table for ISO file management
CREATE TABLE IF NOT EXISTS iso_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  checksum TEXT,
  upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'uploading', 'ready', 'error')),
  upload_progress INTEGER DEFAULT 0 CHECK (upload_progress >= 0 AND upload_progress <= 100),
  local_path TEXT,
  served_url TEXT,
  description TEXT,
  tags TEXT[] DEFAULT '{}',
  last_mounted_at TIMESTAMPTZ,
  mount_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_iso_images_filename ON iso_images(filename);
CREATE INDEX IF NOT EXISTS idx_iso_images_upload_status ON iso_images(upload_status);
CREATE INDEX IF NOT EXISTS idx_iso_images_tags ON iso_images USING GIN(tags);

-- Enable RLS
ALTER TABLE iso_images ENABLE ROW LEVEL SECURITY;

-- Admins and operators can manage ISO images
CREATE POLICY "Admins and operators can manage ISO images"
  ON iso_images
  FOR ALL
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'operator'));

-- Authenticated users can view ISO images
CREATE POLICY "Authenticated users can view ISO images"
  ON iso_images
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Add trigger for updated_at
CREATE TRIGGER update_iso_images_updated_at
  BEFORE UPDATE ON iso_images
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add iso_upload to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'iso_upload';