# Coding Standards

## General

- Prefer small, composable functions
- Keep side effects (infra calls) at the edges
- Separate “plan” from “execute” when feasible

## TypeScript / Frontend

- Keep UI state explicit; avoid hidden global mutations
- Prefer typed Supabase calls and centralized data access helpers
- Maintain route stability; avoid breaking deep links without redirects

## Python / On-prem executors

- Every handler must:
  - validate inputs
  - validate connectivity/auth before action
  - emit structured logs
  - return a clear success/failure result

- Wrap external calls with:
  - timeouts
  - retries (only where safe)
  - clear exception messages

## Logging

- Include correlation IDs (job id, command id, target host) wherever available.
- Log at start and end of each phase with duration.
- Avoid logging payloads that may contain secrets.

## Backward compatibility

- Edge Function routes are public API for agents/scripts.
- Database schema changes require migrations and coordinated client updates.
