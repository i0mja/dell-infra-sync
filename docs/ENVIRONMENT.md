# Environment & Configuration

This repo has three runtime surfaces:

1. Web UI (Vite/React) — calls Supabase
2. Supabase control plane (Postgres + Edge Functions)
3. Python executor / integrations — runs close to infrastructure

## Environment variables (Python executor)

These are read via `os.getenv()` in `job_executor/config.py` and related modules:

- `API_SERVER_ENABLED`
- `API_SERVER_PORT`
- `API_SERVER_SSL_CERT`
- `API_SERVER_SSL_ENABLED`
- `API_SERVER_SSL_KEY`
- `DSM_API_TOKEN`
- `DSM_EDGE_FUNCTION_URL`
- `DSM_EMAIL`
- `DSM_PASSWORD`
- `DSM_URL`
- `ENABLE_DEEP_RELATIONSHIPS`
- `FIRMWARE_DIRECTORY`
- `FIRMWARE_MAX_STORAGE_GB`
- `FIRMWARE_REPO_URL`
- `IDRAC_PASSWORD`
- `IDRAC_USER`
- `ISO_DIRECTORY`
- `ISO_MAX_STORAGE_GB`
- `MEDIA_SERVER_ENABLED`
- `MEDIA_SERVER_PORT`
- `OME_HOST`
- `OME_PASSWORD`
- `OME_PORT`
- `OME_USERNAME`
- `OME_VERIFY_SSL`
- `SERVICE_ROLE_KEY`
- `SUPABASE_URL`
- `VCENTER_HOST`
- `VCENTER_PASSWORD`
- `VCENTER_USER`

### Notes on key variables

- `SUPABASE_URL`  
  Supabase project URL (local or hosted)

- `SERVICE_ROLE_KEY`  
  Supabase service role key (treat as secret; never expose client-side)

- `DSM_URL` / `DSM_EDGE_FUNCTION_URL`  
  Base URL(s) used by the executor to call the control-plane API

- `DSM_API_TOKEN` or `DSM_EMAIL`/`DSM_PASSWORD`  
  Authentication strategy for executor-to-control-plane communication (keep consistent with current code)

- `OME_HOST` / `OME_USERNAME` / `OME_PASSWORD` (+ `OME_VERIFY_SSL`)  
  OpenManage Enterprise connectivity

- `VCENTER_HOST` / `VCENTER_USER` / `VCENTER_PASSWORD`  
  vCenter connectivity

- `IDRAC_USER` / `IDRAC_PASSWORD`  
  iDRAC defaults for workflows that require them

- `FIRMWARE_DIRECTORY` / `ISO_DIRECTORY` and `*_MAX_STORAGE_GB`  
  Local storage for artifacts; enforce quotas and validate paths

- `API_SERVER_ENABLED` / `MEDIA_SERVER_ENABLED` (+ ports/SSL settings)  
  Optional local servers exposed by the executor (treat as privileged)

## UI environment variables

The UI reads Supabase configuration in `src/integrations/supabase/client.ts`.
If adding new UI env vars, document them and ensure they are prefixed correctly for Vite.

## Security rules
- Never commit real secrets to `.env`
- Do not print these values in logs
- Prefer per-environment secret injection (CI/CD, local secret store, etc.)

## Recommended local dev layout

- Copy `.env.offline.template` to `.env` and fill placeholders
- Use Supabase local stack for development whenever possible
- Use read-only or lab credentials for vCenter/OME in dev
