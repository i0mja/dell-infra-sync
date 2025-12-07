-- Fix vCenter sync conflict resolution bug for datastores and networks
-- The MoRef ID (vcenter_id) is not unique across different vCenters, causing data collision

-- Step 1: Clean up duplicate datastores (keep the one with the latest last_sync)
WITH ranked_datastores AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY vcenter_id, source_vcenter_id 
    ORDER BY last_sync DESC NULLS LAST, created_at DESC NULLS LAST
  ) as rn
  FROM vcenter_datastores
)
DELETE FROM vcenter_datastores 
WHERE id IN (SELECT id FROM ranked_datastores WHERE rn > 1);

-- Step 2: Drop old unique constraint on datastores if it exists
ALTER TABLE vcenter_datastores DROP CONSTRAINT IF EXISTS vcenter_datastores_vcenter_id_key;

-- Step 3: Add proper composite unique constraint for datastores
ALTER TABLE vcenter_datastores 
ADD CONSTRAINT vcenter_datastores_vcenter_id_source_unique 
UNIQUE (vcenter_id, source_vcenter_id);

-- Step 4: Clean up duplicate networks (keep the one with the latest last_sync)
WITH ranked_networks AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY vcenter_id, source_vcenter_id 
    ORDER BY last_sync DESC NULLS LAST, created_at DESC NULLS LAST
  ) as rn
  FROM vcenter_networks
)
DELETE FROM vcenter_networks 
WHERE id IN (SELECT id FROM ranked_networks WHERE rn > 1);

-- Step 5: Drop old unique constraint on networks if it exists
ALTER TABLE vcenter_networks DROP CONSTRAINT IF EXISTS vcenter_networks_vcenter_id_key;

-- Step 6: Add proper composite unique constraint for networks
ALTER TABLE vcenter_networks 
ADD CONSTRAINT vcenter_networks_vcenter_id_source_unique 
UNIQUE (vcenter_id, source_vcenter_id);