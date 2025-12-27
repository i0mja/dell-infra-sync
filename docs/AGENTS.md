# AGENTS — Rules for Automated Changes (Codex Web)

This repository controls **infrastructure operations**. It is not a generic CRUD app.
Automated changes must preserve safety, traceability, and operator control.

## 1. Required agent posture

Agents must behave like a production engineer:
- Prefer explicitness over convenience
- Prefer additive changes over rewriting
- Preserve existing behavior unless a change request explicitly says otherwise
- Never “guess” infrastructure state; always verify via API responses

## 2. What agents may do

Agents MAY:
- Improve documentation, typing, and internal structure
- Add new features behind flags/config
- Add tests and tooling that do not change runtime behavior
- Refactor UI components while preserving routes/behavior
- Refactor Python handlers while preserving payload schemas and side effects

## 3. What agents must not do

Agents MUST NOT:
- Introduce destructive infrastructure operations (delete/destroy/reset) without:
  - explicit operator intent
  - explicit UI confirmation and/or feature flag
  - audit logging
- Change job execution semantics (state machine / phases / retries) without also updating:
  - docs (`WORKFLOWS.md`)
  - schema expectations (Supabase tables / edge functions)
  - backward compatibility strategy

Agents MUST NOT:
- Remove/disable validation, safety checks, or rate limiting (e.g., iDRAC throttling)
- Change authentication/authorization model casually
- Rename database columns, edge function routes, or API payload fields without migrations and compatibility shims

## 4. Change checklist (required in PR descriptions / Codex plan)

Before implementing a change, an agent must produce:
- **Impact summary**: what files, modules, and user flows change
- **Backward compatibility**: what existing clients/executors assume
- **Failure modes**: how the change fails and how it is surfaced to operators
- **Observability**: what gets logged and where (UI + edge functions + executor logs)

## 5. Golden rules for infra operations

- Fail **fast and loud**; never silently ignore errors
- Every infra action must have:
  - a clear operator-visible intent
  - a traceable log entry
  - a deterministic timeout and retry policy
- If a step is not safe to repeat, it must be guarded with idempotency checks

## 6. “Do not invent APIs”

If the agent cannot find a function, route, schema, or environment variable:
- search the codebase first
- then add it **explicitly** with documentation and wiring
- never pretend it exists

## 7. Where to look first

- Supabase edge functions: `supabase/functions/*`
- Local on-prem executors: `job-executor.py` and `job_executor/**`
- Sync scripts (OME, vCenter): `openmanage-sync-script.py`, `vcenter-sync-script.py`
- Frontend UI: `src/**`
