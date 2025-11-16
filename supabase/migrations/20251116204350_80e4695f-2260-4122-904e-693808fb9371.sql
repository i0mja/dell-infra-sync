-- Fix foreign key constraint on job_tasks.server_id to allow server deletion
-- This changes the constraint from NO ACTION to ON DELETE SET NULL
-- This preserves job history while allowing servers to be deleted

-- Drop the existing foreign key constraint
ALTER TABLE public.job_tasks 
DROP CONSTRAINT IF EXISTS job_tasks_server_id_fkey;

-- Recreate with proper ON DELETE behavior
ALTER TABLE public.job_tasks 
ADD CONSTRAINT job_tasks_server_id_fkey 
FOREIGN KEY (server_id) 
REFERENCES public.servers(id) 
ON DELETE SET NULL;