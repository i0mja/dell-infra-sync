-- Add key_algorithm column to ssh_keys table
ALTER TABLE ssh_keys 
ADD COLUMN IF NOT EXISTS key_algorithm text DEFAULT 'ed25519';

-- Add comment for documentation
COMMENT ON COLUMN ssh_keys.key_algorithm IS 'SSH key algorithm: ed25519, rsa, ecdsa';