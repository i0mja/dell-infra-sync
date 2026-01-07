-- Add missing enum values for session logging
ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'session_create';
ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'session_delete';