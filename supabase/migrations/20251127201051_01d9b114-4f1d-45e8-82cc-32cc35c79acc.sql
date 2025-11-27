-- Enable full replica identity for realtime to work properly with UPDATE events
-- This ensures Supabase Realtime can capture complete row data for UPDATE events
ALTER TABLE public.jobs REPLICA IDENTITY FULL;
ALTER TABLE public.job_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.idrac_commands REPLICA IDENTITY FULL;