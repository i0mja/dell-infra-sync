-- Add site code and VM prefix columns to vcenters table
ALTER TABLE public.vcenters 
  ADD COLUMN IF NOT EXISTS site_code text,
  ADD COLUMN IF NOT EXISTS vm_prefix text;

-- Add comment for documentation
COMMENT ON COLUMN public.vcenters.site_code IS 'Site code for naming conventions (e.g., MAR, LYO)';
COMMENT ON COLUMN public.vcenters.vm_prefix IS 'VM name prefix for this site (e.g., S06, S16)';