-- Add the missing idrac_api_fallback enum value to operation_type
ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'idrac_api_fallback';