-- Add new columns to servers table for comprehensive iDRAC data
ALTER TABLE public.servers 
ADD COLUMN IF NOT EXISTS manager_mac_address text,
ADD COLUMN IF NOT EXISTS product_name text,
ADD COLUMN IF NOT EXISTS manufacturer text DEFAULT 'Dell',
ADD COLUMN IF NOT EXISTS redfish_version text,
ADD COLUMN IF NOT EXISTS supported_endpoints jsonb;