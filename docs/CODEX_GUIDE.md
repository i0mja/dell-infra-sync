# Codex Guide

This document provides explicit instructions for OpenAI Codex or other automated agents making changes to this codebase.

## Before Making Any Change

1. **Read the mandatory docs** (in order):
   - `CODEX.md` (project overview)
   - `docs/AGENTS.md` (agent rules)
   - `docs/SAFETY_CONSTRAINTS.md` (what not to break)
   - This file

2. **Identify the change surface**:
   - UI only → `src/**`
   - Edge Function → `supabase/functions/**`
   - Executor logic → `job_executor/**`
   - Database schema → `supabase/migrations/**`

3. **Identify contracts impacted**:
   - Job payload shapes
   - Edge Function request/response
   - Database columns/types

## Where to Make Changes

### UI Components

| Change Type | Location |
|-------------|----------|
| New page | Create `src/pages/YourPage.tsx`, add route to `src/App.tsx` |
| New component | `src/components/<feature>/YourComponent.tsx` |
| Shared UI component | `src/components/ui/` |
| Hooks | `src/hooks/` |
| API calls | `src/services/` or `src/lib/` |
| Types | `src/types/` or inline in component file |

### Backend (Supabase)

| Change Type | Location |
|-------------|----------|
| New Edge Function | `supabase/functions/<name>/index.ts` |
| Shared utilities | `supabase/functions/_shared/` |
| Database schema | Create migration in `supabase/migrations/` |
| RLS policies | Include in migration SQL |

### Executor (Python)

| Change Type | Location |
|-------------|----------|
| New job handler | `job_executor/handlers/<name>.py` |
| Shared mixins | `job_executor/mixins/` |
| Config/env | `job_executor/config.py` |
| Utilities | `job_executor/utils.py` or new module |

## Where NOT to Make Changes

### Auto-generated Files (READ-ONLY)

- `src/integrations/supabase/types.ts` — Generated from DB schema
- `src/integrations/supabase/client.ts` — Configured automatically
- `supabase/config.toml` — Managed by Supabase
- `.env` — Contains secrets, managed separately

### Sensitive Areas (REQUIRES EXPLICIT APPROVAL)

- `job_executor/mixins/credentials.py` — Credential handling
- `supabase/functions/encrypt-credentials/` — Encryption logic
- Any file with `password`, `secret`, `key` in the name
- RLS policy changes that could expose data

## Files That Must Be Changed Together

### Adding a New Job Type

1. `src/components/<wizard>/` — UI for job creation
2. `supabase/functions/create-job/index.ts` — Validate and create job
3. `job_executor/handlers/<type>.py` — Execute the job
4. `job_executor/__init__.py` or dispatch logic — Register handler
5. `docs/API_CONTRACT.md` — Document the job payload

### Adding a Database Column

1. `supabase/migrations/<timestamp>_description.sql` — Add column
2. Edge Functions that read/write the table — Handle new field
3. UI components that display the data — Show new field
4. Types in `src/types/` if using local types

### Modifying Workflow Steps

1. `job_executor/handlers/cluster.py` — Step execution logic
2. `src/components/jobs/WorkflowExecutionViewer.tsx` — Step display
3. `src/components/jobs/results/WorkflowStepDetails.tsx` — Step details
4. `docs/STATE_MODEL.md` — Document step changes

## Safe Refactoring Patterns

### Extracting Shared Logic

1. Identify at least 2 call sites with identical behavior
2. Create the shared function in appropriate location:
   - Pure helpers → `src/lib/`
   - Hooks → `src/hooks/`
   - API calls → `src/services/`
3. Migrate call sites one at a time
4. Test after each migration
5. Remove old code only after all sites migrated

### Renaming/Moving Files

1. Update all import statements
2. Run type checker to find broken references
3. Check for dynamic imports or string references

### Changing Function Signatures

1. Make new parameters optional with defaults
2. Update call sites to use new signature
3. Only remove old parameters after all callers updated

## Common Mistakes to Avoid

### 1. Breaking JSON Serialization

**Wrong:**
```python
details = {"host": host_object}  # pyvmomi object
self.update_job_status(job_id, "running", details=details)
```

**Right:**
```python
details = {"host": str(host_object)}  # String representation
# OR use _deep_sanitize_for_json()
```

### 2. Missing Error Handling

**Wrong:**
```python
response = requests.get(url)
data = response.json()  # Crashes if not 200
```

**Right:**
```python
response = requests.get(url, timeout=10)
if response.ok:
    data = response.json()
else:
    self.log(f"Request failed: {response.status_code}", "ERROR")
    return None
```

### 3. Hardcoded Secrets

**Wrong:**
```typescript
const apiKey = "sk-1234567890";
```

**Right:**
```typescript
// Use Supabase secrets for Edge Functions
const apiKey = Deno.env.get("API_KEY");
```

### 4. Silent Failures

**Wrong:**
```python
try:
    do_something()
except:
    pass  # Silent failure
```

**Right:**
```python
try:
    do_something()
except Exception as e:
    self.log(f"Operation failed: {e}", "ERROR")
    raise  # Or handle appropriately
```

### 5. Missing Wizard Actions

**Wrong:**
```tsx
<Dialog>
  <DialogContent>
    {step === 'confirm' && <ConfirmStep />}
    {/* No buttons when step is 'loading' */}
    {step === 'loading' && <Spinner />}
  </DialogContent>
</Dialog>
```

**Right:**
```tsx
<Dialog>
  <DialogContent>
    {step === 'loading' ? <Spinner /> : <ConfirmStep />}
  </DialogContent>
  <DialogFooter>
    <Button onClick={onCancel}>Cancel</Button>
    <Button onClick={onNext} disabled={step === 'loading'}>
      {step === 'loading' ? 'Processing...' : 'Continue'}
    </Button>
  </DialogFooter>
</Dialog>
```

## Testing Changes

### UI Changes
1. Run `npm run build` to check TypeScript errors
2. Test in browser with dev tools console open
3. Check mobile responsiveness

### Executor Changes
1. Run Python type checker if configured
2. Test with a real job (use test/dev infrastructure)
3. Check logs for errors

### Edge Function Changes
1. Deploy and test via HTTP client
2. Check Supabase function logs
3. Verify database state after execution

## Debugging Tips

### Finding Where Code Lives
```bash
# Search for function/component name
grep -r "functionName" src/

# Search for job type handler
grep -r "job_type.*=.*'your_type'" job_executor/
```

### Understanding Data Flow
1. Start from UI component
2. Find the Supabase query or Edge Function call
3. Trace to database table
4. Find executor handler that processes the data

### Reading Logs
- UI console logs: Browser DevTools
- Edge Function logs: Supabase dashboard or CLI
- Executor logs: Python stdout/stderr

## Checklist Before Committing

- [ ] TypeScript builds without errors
- [ ] No secrets hardcoded
- [ ] Error handling for all external calls
- [ ] UI has visible cancel/close actions
- [ ] New database fields have defaults for existing rows
- [ ] Changes documented if they affect contracts
- [ ] No breaking changes to job payloads without migration plan
