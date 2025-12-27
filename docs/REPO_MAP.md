# Repository Map

## Top-level

- `src/`  
  React + TypeScript frontend (Vite). shadcn/ui components, routing, pages, and state.

- `supabase/`  
  Supabase config, local docker stack, database migrations, and Edge Functions (`supabase/functions/*`).

- `job-executor.py`  
  On-prem entrypoint that runs **inside the private network** to execute jobs created in the cloud UI.
  It depends on the `job_executor/` support package located adjacent to it.

- `job_executor/`  
  Python support package for the on-prem executor:
  - API server and job polling
  - connectivity validation
  - handlers for iDRAC/Redfish, ESXi, vCenter, ZFS targets, templates, media upload, etc.

- `openmanage-sync-script.py`  
  On-prem sync agent for **OpenManage Enterprise → Supabase Edge Function**.

- `vcenter-sync-script.py`  
  On-prem sync agent for **vCenter/ESXi → Supabase Edge Function**.

- `idrac_throttler.py`  
  Local helper for iDRAC concurrency/rate control.

## Frontend (typical)

- `src/App.tsx`  
  Application root + routing.

- `src/pages/**`  
  Major screens (inventory, jobs, activity, settings, etc.)

- `src/components/**`  
  Reusable UI building blocks.

- `src/integrations/supabase/**` (if present)  
  Supabase client wiring and typed helpers.

## Supabase

- `supabase/migrations/**`  
  Database schema changes (authoritative for tables, columns, triggers, RLS).

- `supabase/functions/**`  
  Edge Functions: API surface used by UI and sync agents.
  Examples in this repo include sync endpoints, cleanup jobs, authentication helpers, and orchestration utilities.

- `supabase/docker/**`  
  Local dev stack.

## On-prem executor package

- `job_executor/api_server.py`  
  Local API server / orchestration entry points.

- `job_executor/handlers/**`  
  Individual capability handlers:
  firmware, power, network, vCenter, replication, ZFS targets, templates, etc.

- `job_executor/dell_redfish/**`  
  Redfish adapter, endpoint helpers, and Dell-specific operations.

- `job_executor/esxi/**`  
  ESXi orchestration helpers and SSH client (where applicable).

## Primary integration boundaries

- **UI ↔ Supabase**: `src/**` uses Supabase JS + Edge Functions
- **On-prem ↔ Supabase**: Python executors call edge functions / REST endpoints and write back status
- **On-prem ↔ Private infra**: iDRAC/OME/vCenter/ESXi/ZFS accessed only from on-prem scripts
