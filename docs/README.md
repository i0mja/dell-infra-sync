# Documentation Index

This repository is a **hybrid cloud + on‑prem** infrastructure management platform (“Dell Server Manager” in the current UI).
It includes:

- A **cloud web UI** (Vite + React + TypeScript + shadcn/ui)
- A **Supabase backend** (Postgres + Auth + Edge Functions)
- **On‑prem executors and sync agents** (Python) that can reach private resources (iDRAC/Redfish, OpenManage Enterprise, vCenter/ESXi, ZFS targets, etc.)

The primary intent of this `/docs` directory is to make the system **agent-friendly** for OpenAI Codex Web and similar tools:
it documents architecture, invariants, workflows, and change boundaries so automated edits do not break production assumptions.

## Read Order (for humans and agents)

1. `AGENTS.md` (how to work safely in this repo)
2. `REPO_MAP.md` (where everything lives)
3. `ARCHITECTURE.md` (how the pieces interact)
4. `WORKFLOWS.md` (end-to-end operational flows)
5. `SAFETY_CONSTRAINTS.md` (non-negotiables)
6. `CODING_STANDARDS.md` (how to write code here)
7. `TROUBLESHOOTING.md` (common failure modes and where to look)

## Audience

- Infra/SRE engineers
- Virtualization admins
- Storage engineers
- Developers making controlled changes
- Automated agents (Codex) performing refactors or feature additions
