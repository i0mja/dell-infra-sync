-- Add ldap_api to operation_type enum for LDAP activity logging
ALTER TYPE operation_type ADD VALUE IF NOT EXISTS 'ldap_api';