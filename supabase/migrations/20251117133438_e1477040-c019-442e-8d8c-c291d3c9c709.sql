-- Add cpu_health column to server_health table
ALTER TABLE server_health 
ADD COLUMN IF NOT EXISTS cpu_health TEXT;