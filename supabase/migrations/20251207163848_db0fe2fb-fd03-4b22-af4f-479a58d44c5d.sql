-- Add is_template column to vcenter_vms table
ALTER TABLE vcenter_vms ADD COLUMN is_template boolean DEFAULT false;

-- Create index for filtering templates
CREATE INDEX idx_vcenter_vms_is_template ON vcenter_vms(is_template);