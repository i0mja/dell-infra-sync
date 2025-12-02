-- Add ad_dc_use_ssl column to idm_settings
ALTER TABLE public.idm_settings ADD COLUMN IF NOT EXISTS ad_dc_use_ssl BOOLEAN DEFAULT true;