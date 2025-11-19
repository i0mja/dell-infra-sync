-- Fix search_path for send_maintenance_reminders function
DROP FUNCTION IF EXISTS send_maintenance_reminders();

CREATE OR REPLACE FUNCTION send_maintenance_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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