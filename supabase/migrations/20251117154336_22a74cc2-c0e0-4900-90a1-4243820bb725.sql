-- Add iDRAC operation safety settings to activity_settings
ALTER TABLE public.activity_settings 
ADD COLUMN IF NOT EXISTS pause_idrac_operations BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS discovery_max_threads INTEGER DEFAULT 5,
ADD COLUMN IF NOT EXISTS idrac_request_delay_ms INTEGER DEFAULT 500,
ADD COLUMN IF NOT EXISTS idrac_max_concurrent INTEGER DEFAULT 4;

COMMENT ON COLUMN public.activity_settings.pause_idrac_operations IS 'Kill switch: pause all iDRAC operations immediately';
COMMENT ON COLUMN public.activity_settings.discovery_max_threads IS 'Maximum concurrent threads for IP discovery scans (Local Mode safety)';
COMMENT ON COLUMN public.activity_settings.idrac_request_delay_ms IS 'Minimum delay between sequential iDRAC requests to same IP (ms)';
COMMENT ON COLUMN public.activity_settings.idrac_max_concurrent IS 'Maximum concurrent iDRAC requests across all servers';