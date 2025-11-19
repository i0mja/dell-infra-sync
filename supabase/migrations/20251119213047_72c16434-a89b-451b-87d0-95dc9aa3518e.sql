-- Add firmware source tracking to jobs table
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS firmware_source text DEFAULT 'manual_repository',
ADD COLUMN IF NOT EXISTS dell_catalog_url text DEFAULT 'https://downloads.dell.com/catalog/Catalog.xml',
ADD COLUMN IF NOT EXISTS auto_select_latest boolean DEFAULT true;

-- Add index for querying by firmware source
CREATE INDEX IF NOT EXISTS idx_jobs_firmware_source ON jobs(firmware_source);

COMMENT ON COLUMN jobs.firmware_source IS 'Source of firmware: manual_repository, dell_online_catalog, or dell_direct_url';
COMMENT ON COLUMN jobs.dell_catalog_url IS 'Dell catalog URL for automatic firmware updates';
COMMENT ON COLUMN jobs.auto_select_latest IS 'Automatically select latest firmware from catalog';