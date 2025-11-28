-- Add credential type support for ESXi credentials
-- Phase 5: ESXi Credential Management

-- Create credential_type enum
CREATE TYPE credential_type AS ENUM ('idrac', 'esxi');

-- Add credential_type column (default 'idrac' for existing records)
ALTER TABLE credential_sets 
  ADD COLUMN credential_type credential_type DEFAULT 'idrac' NOT NULL;

-- Add optional vcenter_host_id for per-host ESXi credentials
ALTER TABLE credential_sets 
  ADD COLUMN vcenter_host_id uuid REFERENCES vcenter_hosts(id) ON DELETE SET NULL;

-- Create indexes for efficient lookups
CREATE INDEX idx_credential_sets_type ON credential_sets(credential_type);
CREATE INDEX idx_credential_sets_vcenter_host ON credential_sets(vcenter_host_id);

-- Add comment explaining the new columns
COMMENT ON COLUMN credential_sets.credential_type IS 'Type of credential: idrac for Dell iDRAC management, esxi for VMware ESXi SSH access';
COMMENT ON COLUMN credential_sets.vcenter_host_id IS 'Optional link to specific vCenter host for per-host ESXi credentials';