# Safety Constraints

These constraints are design requirements.

## Credentials and secrets
- Never log secrets (tokens, passwords, private keys).
- Encryption flows must not be weakened.
- UI must not receive service role secrets.

## Infrastructure operations
- No silent power operations.
- No “force” operations by default (force reboot, force media detach, etc.).
- All high-risk actions must be explicitly initiated by an operator job.

## State integrity
- Jobs and tasks must be updated atomically and consistently.
- Avoid “best effort” updates that leave ambiguous state.

## Backwards compatibility
- Existing Edge Function payloads are contracts.
- Job types are contracts across UI + functions + executor.
