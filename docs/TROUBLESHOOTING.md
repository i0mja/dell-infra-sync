# Troubleshooting

## Where to look

- UI issues: browser console + network tab
- Edge Function issues: Supabase function logs
- Database issues: Supabase Postgres logs + RLS policy failures
- On-prem execution issues: terminal output and local logs from `job-executor.py`

## Common failure modes

### 1. Supabase Auth / RLS blocks
Symptoms:
- 401/403 responses from edge functions
- UI sees empty tables despite data existing

Check:
- Supabase Auth session in UI
- RLS policies in `supabase/migrations/**`
- Function JWT verification logic (if present)

### 2. vCenter connectivity / SSL
Symptoms:
- pyVmomi SSL errors or auth failures

Check:
- DNS resolution from the on-prem agent host
- Cert trust settings (do not disable verification unless explicitly configured)
- vCenter permissions for the service account

### 3. iDRAC throttling / lockouts
Symptoms:
- intermittent 429/timeout
- account lockout

Check:
- concurrency settings
- `idrac_throttler.py`
- iDRAC event logs

### 4. Job stuck “running”
Symptoms:
- UI shows running but no progress

Check:
- on-prem executor is online and polling
- executor is posting status updates
- edge function or DB write failures
