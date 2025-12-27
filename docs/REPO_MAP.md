# Repository Map

This map is written for fast navigation (humans and automated agents).

## Web UI (Vite + React + TypeScript)
- `src/` — application code
- `src/integrations/supabase/client.ts` — Supabase client wiring
- `public/` — static assets
- `vite.config.ts`, `tailwind.config.ts` — tooling

## Supabase (Control Plane)
- `supabase/functions/` — Edge Functions (HTTP API)
- `supabase/migrations/` — Postgres schema migrations (authoritative schema)
- `supabase/config.toml` — Supabase configuration

## Python (Data Plane / Executors)
- `job-executor.py` — main runner for job execution
- `job_executor/` — modules:
  - `handlers/` — job-type handlers (iDRAC, OME, vCenter, media, replication, etc.)
  - `config.py` — executor environment variables
  - shared utilities in package

## Sync scripts (inventory / connectivity)
- `openmanage-sync-script.py`
- `vcenter-sync-script.py`
- `idrac_throttler.py`

## Tests / Tooling
- `vitest.config.ts` and `src/test/**` — UI tests
- `scripts/backup-database.ts`, `scripts/restore-database.ts` — database tooling

## Key contracts to preserve
- Job types and payloads used by UI + Edge Functions + executor must remain compatible.
- Supabase tables referenced by Edge Functions must remain consistent with migrations.
