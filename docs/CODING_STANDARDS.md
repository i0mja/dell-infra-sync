# Coding Standards

## TypeScript (UI and Edge Functions)
- Prefer explicit types for request/response payloads.
- Avoid `any` in public API surfaces (Edge Function request bodies).
- Errors should be returned as structured JSON with appropriate HTTP codes.
- Keep CORS handling consistent.

## Python (executor)
- Prefer small, testable modules in `job_executor/`.
- Every external call must have:
  - timeout
  - exception handling
  - log context (job_id, target, action)
- Avoid global mutable state (except intentional caches with bounds).

## Logging
- Always include identifiers: job_id, task_id, server_id/hostname, vcenter/ome targets where relevant.
- Redact secrets by default.
