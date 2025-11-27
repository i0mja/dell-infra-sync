-- Function to auto-link server to vCenter host by service_tag = serial_number
CREATE OR REPLACE FUNCTION public.auto_link_server_vcenter()
RETURNS TRIGGER AS $$
BEGIN
  -- Only proceed if service_tag is set and not empty
  IF NEW.service_tag IS NOT NULL AND NEW.service_tag != '' THEN
    -- If server doesn't have a vcenter_host_id yet, try to find a match
    IF NEW.vcenter_host_id IS NULL THEN
      -- Find matching vCenter host that isn't already linked
      SELECT id INTO NEW.vcenter_host_id
      FROM public.vcenter_hosts
      WHERE serial_number = NEW.service_tag
        AND server_id IS NULL
      LIMIT 1;
      
      -- If we found a match, also update the vcenter_hosts table
      IF NEW.vcenter_host_id IS NOT NULL THEN
        UPDATE public.vcenter_hosts
        SET server_id = NEW.id
        WHERE id = NEW.vcenter_host_id;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger on INSERT or UPDATE of service_tag
CREATE TRIGGER trigger_auto_link_vcenter
BEFORE INSERT OR UPDATE OF service_tag ON public.servers
FOR EACH ROW
EXECUTE FUNCTION public.auto_link_server_vcenter();