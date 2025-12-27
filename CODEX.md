# CODEX — Agentic Development Guide (Codex Web)

This repository is a **production-grade infrastructure orchestration platform** (“Dell Server Manager”).
It contains:
- A **React/TypeScript** web UI (Vite)
- A **Supabase** control plane (Postgres + Edge Functions)
- A **Python job executor** and integrations that run close to infrastructure (iDRAC / OME / vCenter / ESXi / storage targets)

## Mandatory reading order for Codex
1. `docs/AGENTS.md` (agent contract / hard rules)
2. `docs/REPO_MAP.md` (where things live)
3. `docs/SAFETY_CONSTRAINTS.md` (what must never be broken)
4. `docs/API_CONTRACT.md` (Edge Functions + DB touchpoints)
5. `docs/ENVIRONMENT.md` (runtime configuration)

If you modify code without satisfying these docs, you are likely to introduce unsafe behavior.

## What Codex should optimize for
- Correctness and safety over novelty
- Idempotent workflows (safe re-runs)
- Clear observability (structured logs + traceable job state)
- Compatibility with existing DB schema + Edge Function interface

## What Codex must not do
- Invent new DB tables/columns without a migration
- Change job state semantics casually (jobs are resumable and audited)
- Add destructive operations (e.g., wiping data, force operations) without explicit operator gating

## Local development (quick start)

### Web UI
```bash
npm install
npm run dev
```

### Supabase (local)
Supabase configuration is under `supabase/`.
Typical flow (if you use the Supabase CLI locally):
```bash
supabase start
supabase db reset
supabase functions serve
```

### Python job executor
Python entrypoint: `job-executor.py`

Install:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run:
```bash
python job-executor.py
```

See `docs/ENVIRONMENT.md` for required environment variables.

## Where to implement changes
- UI/UX changes: `src/**`
- Supabase Edge Functions: `supabase/functions/**`
- DB changes: `supabase/migrations/**`
- Job execution logic: `job_executor/**` and `job-executor.py`
- Infra sync helpers: `openmanage-sync-script.py`, `vcenter-sync-script.py`

## How to propose changes (Codex checklist)
For any change, include:
- Files touched
- DB migration (if schema changes)
- Safety impact statement (what could go wrong + mitigations)
- Rollback path
