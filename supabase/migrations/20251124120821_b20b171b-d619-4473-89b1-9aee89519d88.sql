-- Enable pg_net extension for http requests (required by maintenance reminder functions)
CREATE EXTENSION IF NOT EXISTS pg_net SCHEMA extensions;