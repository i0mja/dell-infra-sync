-- Add credential_set_id to servers table to track which credential set was used
ALTER TABLE public.servers
ADD COLUMN credential_set_id uuid REFERENCES public.credential_sets(id) ON DELETE SET NULL;