-- Create maintenance_windows table
CREATE TABLE maintenance_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  cluster_ids text[] NOT NULL,
  planned_start timestamp with time zone NOT NULL,
  planned_end timestamp with time zone NOT NULL,
  maintenance_type text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  created_by uuid REFERENCES profiles(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  safety_check_snapshot jsonb,
  
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  
  job_ids uuid[],
  
  notify_before_hours integer DEFAULT 24,
  notification_sent boolean DEFAULT false,
  
  requires_approval boolean DEFAULT false,
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamp with time zone,
  
  CONSTRAINT valid_date_range CHECK (planned_end > planned_start),
  CONSTRAINT valid_maintenance_type CHECK (maintenance_type IN ('firmware_update', 'host_maintenance', 'cluster_upgrade', 'custom')),
  CONSTRAINT valid_status CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled'))
);

-- Enable RLS
ALTER TABLE maintenance_windows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins and operators can manage maintenance windows" 
  ON maintenance_windows FOR ALL 
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'operator'::app_role));

CREATE POLICY "Authenticated users can view maintenance windows" 
  ON maintenance_windows FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- Indexes for performance
CREATE INDEX idx_maintenance_windows_dates ON maintenance_windows(planned_start, planned_end);
CREATE INDEX idx_maintenance_windows_status ON maintenance_windows(status);
CREATE INDEX idx_maintenance_windows_clusters ON maintenance_windows USING GIN(cluster_ids);

-- Trigger for updated_at
CREATE TRIGGER update_maintenance_windows_updated_at
  BEFORE UPDATE ON maintenance_windows
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to send maintenance reminders
CREATE OR REPLACE FUNCTION send_maintenance_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  window_record RECORD;
  supabase_url text;
  service_role_key text;
BEGIN
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_role_key := current_setting('app.settings.service_role_key', true);
  
  IF supabase_url IS NULL OR service_role_key IS NULL THEN
    RETURN;
  END IF;
  
  FOR window_record IN
    SELECT * FROM maintenance_windows
    WHERE status = 'planned'
      AND notification_sent = false
      AND planned_start <= NOW() + (notify_before_hours || ' hours')::INTERVAL
      AND planned_start > NOW()
  LOOP
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/send-notification',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_role_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'notification_type', 'maintenance_reminder',
        'maintenance_window', row_to_json(window_record)
      )
    );
    
    UPDATE maintenance_windows 
    SET notification_sent = true 
    WHERE id = window_record.id;
  END LOOP;
END;
$$;