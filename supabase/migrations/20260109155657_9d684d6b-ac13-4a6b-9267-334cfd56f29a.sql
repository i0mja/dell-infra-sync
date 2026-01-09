-- Add server location/rack information columns
ALTER TABLE servers ADD COLUMN IF NOT EXISTS datacenter text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS rack_id text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS rack_position text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS row_aisle text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS room_floor text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS location_notes text;

-- Add indexes for common filtering
CREATE INDEX IF NOT EXISTS idx_servers_datacenter ON servers(datacenter);
CREATE INDEX IF NOT EXISTS idx_servers_rack_id ON servers(rack_id);

-- Add comment for documentation
COMMENT ON COLUMN servers.datacenter IS 'Datacenter or site name (e.g., DC-East, Colo-NYC)';
COMMENT ON COLUMN servers.rack_id IS 'Rack identifier (e.g., R-A12, Rack-5)';
COMMENT ON COLUMN servers.rack_position IS 'U position in rack (e.g., U22-U24)';
COMMENT ON COLUMN servers.row_aisle IS 'Row and aisle location';
COMMENT ON COLUMN servers.room_floor IS 'Room or floor location';
COMMENT ON COLUMN servers.location_notes IS 'Additional location notes (power circuit, cabling, etc.)';