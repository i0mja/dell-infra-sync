# Troubleshooting

## “UI works but executor does nothing”
- Confirm executor can authenticate to Supabase / Edge Functions:
  - `SUPABASE_URL`
  - `SERVICE_ROLE_KEY` or `DSM_API_TOKEN` / `DSM_EMAIL`+`DSM_PASSWORD`
- Confirm network reachability from executor host to control plane

## “vCenter sync failing”
- Validate vCenter creds (`VCENTER_HOST`, `VCENTER_USER`, `VCENTER_PASSWORD`)
- Use Edge Function `test-vcenter-connection` to validate connectivity

## “OME sync failing”
- Validate OME connection settings (`OME_HOST`, `OME_USERNAME`, `OME_PASSWORD`)
- Check `OME_VERIFY_SSL` (do not disable in production unless necessary)

## “Jobs stuck in a state”
- Inspect `jobs` and `job_tasks` rows for the job_id
- Check Edge Function logs for `create-job` / `update-job`
- Ensure executor logs include the job_id and handler selection
