-- Add use_job_executor_for_idrac setting to activity_settings
ALTER TABLE activity_settings 
ADD COLUMN use_job_executor_for_idrac BOOLEAN DEFAULT true;

COMMENT ON COLUMN activity_settings.use_job_executor_for_idrac IS 'When enabled, routes iDRAC operations through Job Executor instead of edge functions. Enable for private networks or air-gapped deployments.';