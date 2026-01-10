-- Add SNMP write community column for PDUs
ALTER TABLE public.pdus 
  ADD COLUMN IF NOT EXISTS snmp_write_community TEXT DEFAULT 'private';

-- Add comments explaining the difference between read and write communities
COMMENT ON COLUMN public.pdus.snmp_community IS 'SNMP community for read operations (GET/WALK) - typically "public"';
COMMENT ON COLUMN public.pdus.snmp_write_community IS 'SNMP community for write operations (SET) - typically "private"';

-- Update protocol column to include 'auto' option and set as new default
-- First, update any existing rows to ensure valid values
UPDATE public.pdus SET protocol = 'nmc' WHERE protocol IS NULL;

-- Drop existing constraint if it exists and add new one with 'auto' option
ALTER TABLE public.pdus DROP CONSTRAINT IF EXISTS pdus_protocol_check;
ALTER TABLE public.pdus 
  ADD CONSTRAINT pdus_protocol_check 
    CHECK (protocol IN ('snmp', 'nmc', 'auto'));

-- Set default to 'auto' for new PDUs
ALTER TABLE public.pdus ALTER COLUMN protocol SET DEFAULT 'auto';