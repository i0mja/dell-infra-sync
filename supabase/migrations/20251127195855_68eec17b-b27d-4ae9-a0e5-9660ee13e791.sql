-- Backfill source_vcenter_id for existing vCenter data
DO $$
DECLARE
  existing_vcenter_id uuid;
BEGIN
  -- Get the first (or only) vCenter connection
  SELECT id INTO existing_vcenter_id FROM vcenters ORDER BY created_at ASC LIMIT 1;
  
  IF existing_vcenter_id IS NOT NULL THEN
    -- Update all orphaned vCenter data to link to the existing vCenter
    UPDATE vcenter_hosts 
    SET source_vcenter_id = existing_vcenter_id 
    WHERE source_vcenter_id IS NULL;
    
    UPDATE vcenter_vms 
    SET source_vcenter_id = existing_vcenter_id 
    WHERE source_vcenter_id IS NULL;
    
    UPDATE vcenter_clusters 
    SET source_vcenter_id = existing_vcenter_id 
    WHERE source_vcenter_id IS NULL;
    
    UPDATE vcenter_datastores 
    SET source_vcenter_id = existing_vcenter_id 
    WHERE source_vcenter_id IS NULL;
    
    UPDATE vcenter_alarms 
    SET source_vcenter_id = existing_vcenter_id 
    WHERE source_vcenter_id IS NULL;
    
    RAISE NOTICE 'Backfilled source_vcenter_id for existing vCenter data';
  ELSE
    RAISE NOTICE 'No vCenter connection found - skipping backfill';
  END IF;
END $$;