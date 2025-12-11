-- Step 1: Delete duplicate VMs, keeping only the most recently synced/created
DELETE FROM vcenter_vms 
WHERE id IN (
  SELECT id FROM (
    SELECT id, 
           ROW_NUMBER() OVER (
             PARTITION BY name, source_vcenter_id 
             ORDER BY last_sync DESC NULLS LAST, created_at DESC
           ) as rn
    FROM vcenter_vms
  ) ranked
  WHERE rn > 1
);

-- Step 2: Add composite unique constraint on (name, source_vcenter_id)
ALTER TABLE vcenter_vms 
ADD CONSTRAINT vcenter_vms_name_source_unique 
UNIQUE (name, source_vcenter_id);