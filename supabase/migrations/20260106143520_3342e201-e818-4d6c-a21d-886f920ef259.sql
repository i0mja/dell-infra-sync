-- Add fetch_memory column to idrac_settings table for memory/DIMM collection toggle
ALTER TABLE public.idrac_settings 
ADD COLUMN IF NOT EXISTS fetch_memory BOOLEAN NOT NULL DEFAULT true;