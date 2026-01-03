-- Add SCP backup age threshold settings to idrac_settings table
ALTER TABLE idrac_settings 
ADD COLUMN scp_backup_max_age_days integer DEFAULT 30,
ADD COLUMN scp_backup_only_if_stale boolean DEFAULT true;