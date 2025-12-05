-- Enable realtime for workflow_executions table
ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_executions;

-- Ensure REPLICA IDENTITY FULL for complete row data
ALTER TABLE public.workflow_executions REPLICA IDENTITY FULL;