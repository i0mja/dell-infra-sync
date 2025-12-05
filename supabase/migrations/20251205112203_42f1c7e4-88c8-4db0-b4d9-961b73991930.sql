-- Allow created_by to be NULL so we can preserve job history when users are deleted
ALTER TABLE public.jobs ALTER COLUMN created_by DROP NOT NULL;