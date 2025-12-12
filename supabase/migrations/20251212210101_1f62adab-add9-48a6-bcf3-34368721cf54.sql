-- Add exchange_ssh_keys job type for SSH key exchange between paired ZFS replication targets
ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'exchange_ssh_keys';