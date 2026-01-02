-- Fix search_path security for newly created functions
CREATE OR REPLACE FUNCTION update_vcenter_next_sync()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sync_enabled = true THEN
    NEW.next_sync_at := COALESCE(NEW.last_sync, now()) + (NEW.sync_interval_minutes || ' minutes')::interval;
  ELSE
    NEW.next_sync_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_vcenter_initial_next_sync()
RETURNS trigger 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sync_enabled = true AND NEW.next_sync_at IS NULL THEN
    NEW.next_sync_at := COALESCE(NEW.last_sync, now()) + (NEW.sync_interval_minutes || ' minutes')::interval;
  END IF;
  RETURN NEW;
END;
$$;