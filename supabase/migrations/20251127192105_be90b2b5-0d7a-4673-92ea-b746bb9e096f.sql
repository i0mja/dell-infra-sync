-- Add scan_local_isos and register_iso_url to job_type enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'scan_local_isos';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'register_iso_url';

-- Add source tracking columns to iso_images table
ALTER TABLE iso_images 
  ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'upload' CHECK (source_type IN ('local', 'url', 'upload')),
  ADD COLUMN IF NOT EXISTS source_url text;

COMMENT ON COLUMN iso_images.source_type IS 'How the ISO was registered: local (scanned from disk), url (from HTTP share), upload (browser upload)';
COMMENT ON COLUMN iso_images.source_url IS 'Original URL if registered from HTTP share';