# Safety Constraints (Non-Negotiable)

These constraints are intended to prevent accidental outages, data loss, or security regressions.

## Infrastructure actions

- No destructive operations (delete/destroy/reset) without explicit operator intent.
- Every infra action must have:
  - a job record (who/what/when)
  - an audit log trail
  - timeouts and retry policy
- Never assume success: validate by reading back authoritative state (API response or follow-up query).

## Authentication and secrets

- Do not log secrets (tokens, passwords, private keys).
- Use environment variables and server-side secret stores where possible.
- Preserve Supabase RLS protections; do not weaken policies for convenience.

## Throttling and concurrency

- iDRAC, OME, vCenter, ESXi endpoints can rate-limit or lock accounts.
- Preserve/extend `idrac_throttler.py` or equivalent controls.
- Default to conservative concurrency; make higher values explicit and configurable.

## Data plane vs control plane

- Private network operations must remain on-prem.
- Cloud components must not require direct access to private IP space.
- Edge Functions should remain thin coordinators, not heavy executors.
