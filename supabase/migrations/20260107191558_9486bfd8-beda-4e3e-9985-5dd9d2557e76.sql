-- Add requires_legacy_ssl column to servers table for iDRAC 8 compatibility
ALTER TABLE public.servers 
ADD COLUMN IF NOT EXISTS requires_legacy_ssl boolean DEFAULT false;

COMMENT ON COLUMN public.servers.requires_legacy_ssl IS 
  'True if server iDRAC requires legacy TLS (iDRAC 7/8 with older firmware using TLSv1.0/1.1)';