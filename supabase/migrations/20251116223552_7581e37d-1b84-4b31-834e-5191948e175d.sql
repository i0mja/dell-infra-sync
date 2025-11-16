-- Add operation_type to idrac_commands table for unified activity logging
-- This allows tracking both iDRAC and vCenter operations in one table

-- Create enum for operation types
CREATE TYPE operation_type AS ENUM ('idrac_api', 'vcenter_api', 'openmanage_api');

-- Add operation_type column with default for existing records
ALTER TABLE public.idrac_commands 
ADD COLUMN operation_type operation_type DEFAULT 'idrac_api'::operation_type NOT NULL;

-- Update column to be nullable after backfilling
ALTER TABLE public.idrac_commands 
ALTER COLUMN operation_type DROP DEFAULT;

-- Add index for filtering by operation type
CREATE INDEX idx_idrac_commands_operation_type ON public.idrac_commands(operation_type);

-- Add comment for documentation
COMMENT ON COLUMN public.idrac_commands.operation_type IS 'Type of operation: idrac_api for iDRAC REST API calls, vcenter_api for vCenter API calls, openmanage_api for OpenManage API calls';