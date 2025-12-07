-- Add SSH key management job types to the enum
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'ssh_key_deploy';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'ssh_key_verify';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'ssh_key_remove';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'ssh_key_rotate';
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'ssh_key_health_check';