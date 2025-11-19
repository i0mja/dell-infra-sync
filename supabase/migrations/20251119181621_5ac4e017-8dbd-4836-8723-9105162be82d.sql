-- Scheduled Cluster Safety Checks Migration (Fixed)

-- Create scheduled_safety_checks table
CREATE TABLE scheduled_safety_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean DEFAULT false,
  schedule_cron text DEFAULT '0 */6 * * *',
  check_all_clusters boolean DEFAULT true,
  specific_clusters text[],
  min_required_hosts integer DEFAULT 2,
  notify_on_unsafe boolean DEFAULT true,
  notify_on_warnings boolean DEFAULT false,
  notify_on_safe_to_unsafe_change boolean DEFAULT true,
  last_run_at timestamp with time zone,
  last_status text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

INSERT INTO scheduled_safety_checks (enabled) VALUES (false);

ALTER TABLE scheduled_safety_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage scheduled checks" ON scheduled_safety_checks FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated users can view scheduled checks" ON scheduled_safety_checks FOR SELECT USING (auth.uid() IS NOT NULL);

ALTER TABLE cluster_safety_checks 
  ADD COLUMN is_scheduled boolean DEFAULT false,
  ADD COLUMN scheduled_check_id uuid REFERENCES scheduled_safety_checks(id),
  ADD COLUMN previous_status text,
  ADD COLUMN status_changed boolean DEFAULT false;

ALTER TABLE notification_settings
  ADD COLUMN notify_on_unsafe_cluster boolean DEFAULT true,
  ADD COLUMN notify_on_cluster_warning boolean DEFAULT false,
  ADD COLUMN notify_on_cluster_status_change boolean DEFAULT true;

CREATE OR REPLACE FUNCTION run_scheduled_cluster_safety_checks()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  config_record RECORD;
  cluster_record RECORD;
  job_id uuid;
  system_user_id uuid;
BEGIN
  SELECT * INTO config_record FROM scheduled_safety_checks WHERE enabled = true LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  
  SELECT id INTO system_user_id FROM profiles WHERE id IN (SELECT user_id FROM user_roles WHERE role = 'admin') LIMIT 1;
  IF system_user_id IS NULL THEN RAISE EXCEPTION 'No admin user found'; END IF;
  
  FOR cluster_record IN SELECT DISTINCT cluster FROM vcenter_hosts WHERE cluster IS NOT NULL AND (config_record.check_all_clusters = true OR cluster = ANY(config_record.specific_clusters))
  LOOP
    INSERT INTO jobs (job_type, created_by, status, details, target_scope) 
    VALUES ('cluster_safety_check', system_user_id, 'pending', jsonb_build_object('cluster_name', cluster_record.cluster, 'min_required_hosts', config_record.min_required_hosts, 'check_drs', true, 'check_ha', true, 'is_scheduled', true, 'scheduled_check_id', config_record.id), '{}'::jsonb);
  END LOOP;
  
  UPDATE scheduled_safety_checks SET last_run_at = NOW(), updated_at = NOW() WHERE id = config_record.id;
END;
$$;