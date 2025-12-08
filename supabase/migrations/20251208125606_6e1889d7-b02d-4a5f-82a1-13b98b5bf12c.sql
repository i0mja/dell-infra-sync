-- Add ssh_command to the operation_type enum
ALTER TYPE public.operation_type ADD VALUE IF NOT EXISTS 'ssh_command';