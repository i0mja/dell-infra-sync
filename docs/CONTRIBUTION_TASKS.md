# Contribution Tasks (Codex Playbook)

This document is a pragmatic **recipe book** for making safe, consistent changes in this repository using OpenAI Codex.

This platform is multi-surface:
- **React/Vite UI** in `src/`
- **Supabase Edge Functions** in `supabase/functions/`
- **On‑prem Job Executor** in `job_executor/` (plus `job-executor.py` entrypoint)
- **Sync scripts** (e.g. `openmanage-sync-script.py`, `vcenter-sync-script.py`, `idrac_throttler.py`)
- **Deployment / offline packaging** in `scripts/`

If you are using Codex:
1. Read `CODEX.md` and `docs/AGENTS.md` before any edits.
2. Use the recipes below (they encode the expected shape of changes).
3. Keep deltas small and reversible.

---

## Quick start commands

### UI (local)
- Install deps: `npm ci` (or use your preferred Node/Bun workflow)
- Dev server: `npm run dev`
- Build: `npm run build`

### Supabase (local)
- Local stack: `scripts/setup-local-supabase.sh` (or `supabase start` if you run it manually)
- Functions live under: `supabase/functions/<function>/index.ts`

### Job Executor (local)
- Python deps: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
- Entrypoint: `job-executor.py` (wraps `job_executor/*`)

---

## Recipe index

1. Add a new UI page/route
2. Add a new “job type” end-to-end (UI → Edge Function → Executor)
3. Add a new Supabase Edge Function
4. Add a new background cleanup/maintenance function
5. Add a new integration in Job Executor (`job_executor/`)
6. Add / change a database field safely (migration + RLS + UI)
7. Add a new connectivity test (vCenter / SMB / SSH / iDRAC)
8. Add a new notification type
9. Add a new offline packaging asset
10. Add a new diagnostic bundle item

Each recipe includes:
- **Scope** (files/areas to touch)
- **Checklist**
- **Codex prompt template** (copy/paste into Codex Web)

---

## 1) Add a new UI page/route

**Scope**
- `src/App.tsx` (routes)
- `src/` page/component files (pattern depends on current structure)

**Checklist**
- Add a route in `src/App.tsx`
- Add the page component
- Wire data fetching via Supabase client (`@supabase/supabase-js`) if needed
- Add basic error + loading states
- Keep UI consistent with existing shadcn/tailwind patterns

**Codex prompt template**
> Read `CODEX.md`, `docs/AGENTS.md`, and `docs/CODING_STANDARDS.md`.  
> Add a new UI page called `<NAME>` accessible at route `<PATH>`.  
> Reuse existing layout/components patterns in `src/`.  
> Ensure loading/error states and no breaking changes.  
> List the files you changed and why.

---

## 2) Add a new “job type” end-to-end (UI → Edge Function → Executor)

This is the most common cross-cutting change.

**Scope**
- UI: job creation form / wizard (likely under `src/`)
- Edge: `supabase/functions/create-job/index.ts` and/or a dedicated function
- Executor: `job_executor/` handlers/utilities and `job-executor.py` dispatch
- DB: jobs tables / job payload schema (migrations if required)

**Checklist**
- Define the job payload shape (inputs, defaults, validation)
- Add UI form fields and client-side validation (Zod is available)
- Add server-side validation in the Edge Function
- Ensure executor can **idempotently** run/resume the job
- Ensure job status/progress updates are persisted (Edge `update-job` or equivalent)
- Add audit-friendly logs (no secrets)
- Update docs if you introduce a new job category

**Codex prompt template**
> Read `CODEX.md`, `docs/AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/SAFETY_CONSTRAINTS.md`.  
> Implement a new job type named `<JOB_TYPE>` end-to-end.  
> Requirements:  
> - UI allows creating the job with inputs: `<FIELDS>`  
> - Supabase Edge validates inputs and persists a job record  
> - Job Executor can execute the job idempotently and emit progress/status updates  
> - No destructive operations are introduced; preserve existing defaults  
> Provide a file-by-file change list and any migration required.

---

## 3) Add a new Supabase Edge Function

**Scope**
- `supabase/functions/<name>/index.ts`
- Optional shared utilities: `supabase/functions/_shared/*`

**Checklist**
- Create the function folder and `index.ts`
- Use existing auth patterns (e.g., service key vs user JWT) consistent with nearby functions
- Return stable JSON responses (explicit schema)
- Add timeouts/retries only if already used in similar functions
- Avoid embedding secrets in logs

**Codex prompt template**
> Read `docs/API_CONTRACT.md` and scan `supabase/functions/` for similar patterns.  
> Create a new Edge Function `<NAME>` that does `<BEHAVIOR>`.  
> Follow the existing request parsing, auth checks, and error response shape.  
> Update `docs/API_CONTRACT.md` to include the new endpoint with request/response examples.

---

## 4) Add a background cleanup/maintenance function

You already have patterns like `cleanup-old-jobs` and `cleanup-activity-logs`.

**Scope**
- `supabase/functions/cleanup-*/index.ts`
- Potential DB migration if new fields/indexes are needed

**Checklist**
- Ensure the function can run repeatedly without side effects
- Filter by age/status, do not delete “active” or “in-flight” entities
- Emit summary logs: counts, durations, errors
- Prefer soft-delete if that’s the repo pattern; otherwise preserve auditability

**Codex prompt template**
> Inspect existing cleanup functions in `supabase/functions/`.  
> Add a new cleanup function `<NAME>` that removes/archives `<THING>` older than `<AGE>` with safeguards.  
> Ensure idempotency and audit-friendly logging.  
> Update `docs/API_CONTRACT.md` and `docs/TROUBLESHOOTING.md` with how to run it and what it logs.

---

## 5) Add a new integration in the Job Executor (`job_executor/`)

**Scope**
- `job_executor/` (new module or extend existing)
- `job-executor.py` (dispatch), if applicable
- `job_executor/config.py` for env/config additions
- `requirements.txt` if adding libraries (prefer minimal deps)

**Checklist**
- Implement connectivity testing first (fail early)
- Keep network calls bounded and timeouts explicit
- Return structured results (not ad-hoc prints)
- Ensure the integration can be used in “dry-run” mode if the repo supports it for that action class
- Do not leak credentials; redact safely

**Codex prompt template**
> Read `docs/SAFETY_CONSTRAINTS.md` and scan `job_executor/` for patterns.  
> Add a new executor integration `<NAME>` that performs `<ACTION>` against `<TARGET>`.  
> Add preflight connectivity checks, explicit timeouts, and structured logging.  
> Wire it into the executor dispatch so it can be invoked by a job payload of type `<JOB_TYPE>`.

---

## 6) Add / change a database field safely (migration + RLS + UI)

**Scope**
- `supabase/migrations/*.sql`
- Any Edge Functions that read/write the table
- UI types and forms

**Checklist**
- Add migration with explicit up changes
- Add indexes if needed (especially for job lookups / time-based cleanup)
- Update RLS policies if your change affects data exposure
- Update Edge Functions to handle NULL/defaults safely
- Update UI types and ensure backwards compatibility

**Codex prompt template**
> Inspect `supabase/migrations/` for naming and style.  
> Add a new field `<FIELD>` to table `<TABLE>` with default `<DEFAULT>` and any needed indexes.  
> Update Edge Functions that read/write this field.  
> Update UI types/forms to support it while remaining backwards compatible with existing rows.

---

## 7) Add a new connectivity test (vCenter / SMB / SSH / iDRAC)

The repo already has Edge functions like `test-vcenter-connection` and `test-virtual-media-share`, and executor utilities under `job_executor/connectivity.py` and `job_executor/ssh_utils.py`.

**Scope**
- `supabase/functions/test-*/index.ts` (cloud-side tests)
- `job_executor/connectivity.py` (on-prem tests)

**Checklist**
- Decide where the test should run:
  - Cloud-side: only if the target is reachable from Supabase runtime (often it is not)
  - On-prem executor: preferred for private networks
- Keep output actionable: “what failed” and “what to check”
- Avoid long-running probes; keep timeouts low

**Codex prompt template**
> Read `docs/ARCHITECTURE.md` and decide whether the test must run on-prem.  
> Implement a connectivity test for `<TARGET>` using existing patterns (`test-vcenter-connection`, `validate-network-prerequisites`, `job_executor/connectivity.py`).  
> Return clear structured results and error causes.  
> Update `docs/TROUBLESHOOTING.md` with failure signatures and remedies.

---

## 8) Add a new notification type

**Scope**
- `supabase/functions/send-notification/index.ts`
- UI (if user-configurable)
- DB (if you store templates / preferences)

**Checklist**
- Add new notification “event type” with a stable identifier
- Ensure payloads are versioned or backwards compatible
- Avoid embedding secrets in messages
- Include correlation identifiers (job_id, host_id, etc.) for auditability

**Codex prompt template**
> Inspect `supabase/functions/send-notification/index.ts`.  
> Add a notification type `<EVENT>` fired when `<CONDITION>`.  
> Ensure message includes identifiers (job_id, target).  
> Update `docs/API_CONTRACT.md` with the new event and example payload.

---

## 9) Add a new offline packaging asset

The repo includes offline scripts under `scripts/` (Windows + RHEL9).

**Scope**
- `scripts/create-offline-package.*`
- `scripts/install-offline-*`
- Any referenced manifest or directory

**Checklist**
- Keep offline packages deterministic (same inputs → same outputs)
- Add verification steps (hashes, existence checks)
- Avoid downloading during “offline install” path
- Document where the asset is expected to be placed

**Codex prompt template**
> Review `scripts/create-offline-package.sh` and `.ps1`.  
> Add `<ASSET>` to the offline package, including verification (hash or size) and install steps.  
> Ensure the offline install scripts do not download anything.  
> Update `docs/ENVIRONMENT.md` and `docs/TROUBLESHOOTING.md` with offline expectations.

---

## 10) Add a new diagnostic bundle item

The repo has diagnostic collection scripts (e.g., `scripts/collect-diagnostics.ps1`) and health checks.

**Scope**
- `scripts/collect-diagnostics.*`
- `scripts/health-check.*`
- Potential executor-side logs

**Checklist**
- Include: version info, config summary (redacted), recent logs, connectivity checks
- Redact secrets aggressively
- Keep the bundle size bounded

**Codex prompt template**
> Inspect existing diagnostic scripts in `scripts/`.  
> Add a new diagnostic item collecting `<INFO>` with secret redaction.  
> Ensure the output is suitable for sending to support (no credentials).  
> Update `docs/TROUBLESHOOTING.md` to mention the new artifact and where it is stored.

---

## “Vibe coding” guardrails (what to tell Codex)

If you want Codex to move fast while staying safe, prepend this to most prompts:

> Read `CODEX.md` and `docs/AGENTS.md` first.  
> Do not change semantics, only implement the requested feature.  
> Prefer minimal diffs.  
> Add/extend tests where feasible.  
> Provide a short checklist of what to manually verify after the change.

EOF
