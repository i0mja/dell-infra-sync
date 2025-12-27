# AGENTS — Rules for Codex and Other Automated Editors

This repo controls real infrastructure. Automated edits must be conservative.

## Non-negotiable rules
- Do not introduce destructive behavior by default (power off, wipe, delete, force).
- Do not change the meaning of existing job states, job types, or task semantics without a migration plan.
- Do not log secrets (passwords, tokens, private keys, raw credential payloads).

## Required working method
Before implementing any change:
1. Identify which surface area you are changing:
   - UI (`src/**`)
   - Edge Functions (`supabase/functions/**`)
   - Executor (`job_executor/**`, `job-executor.py`)
   - Schema (`supabase/migrations/**`)
2. Identify the contract(s) impacted:
   - Edge Function API shape
   - DB schema
   - Job type/payload shape
3. Add/adjust docs if the contract changes (`docs/API_CONTRACT.md`, `docs/DATABASE.md`).

## Allowed change types
- Refactors that preserve behavior
- Better validation and observability
- Additive features behind feature flags / new job types
- New Edge Functions (prefer additive rather than breaking)

## Forbidden change types (without explicit operator approval)
- Renaming/removing job types or job fields consumed elsewhere
- Changing credential handling / encryption flows
- Relaxing safety checks (maintenance windows, safety rails)
- Anything that could reduce auditability (removing audit logs, reducing log detail)

## Default posture
Fail closed. Be explicit. Prefer safe no-ops over risky automation.
