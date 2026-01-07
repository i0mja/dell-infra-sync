-- Clear stale capability caches to force re-detection with new expand_storage and expand_network_adapters flags
UPDATE servers SET supported_endpoints = NULL WHERE supported_endpoints IS NOT NULL;