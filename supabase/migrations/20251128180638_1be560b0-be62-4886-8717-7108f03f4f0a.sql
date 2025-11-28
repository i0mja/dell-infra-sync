-- Drop the existing constraint
ALTER TABLE maintenance_windows DROP CONSTRAINT IF EXISTS valid_maintenance_type;

-- Add new constraint with all maintenance types
ALTER TABLE maintenance_windows ADD CONSTRAINT valid_maintenance_type CHECK (
  maintenance_type = ANY (ARRAY[
    -- Original types
    'firmware_update'::text,
    'host_maintenance'::text,
    'cluster_upgrade'::text,
    'custom'::text,
    -- New ESXi-related types from ClusterUpdateWizard
    'firmware_only'::text,
    'esxi_only'::text,
    'esxi_then_firmware'::text,
    'firmware_then_esxi'::text,
    -- Types used by ScheduleMaintenanceDialog and edge functions
    'esxi_upgrade'::text,
    'full_update'::text,
    'safety_check'::text,
    'emergency_patch'::text
  ])
);