# Database Backup & Migration Guide

Complete guide for backing up your Dell Server Manager database and migrating to a self-hosted Supabase instance.

## Quick Start

### Backup Current Database

```bash
# Create a complete backup
npm run backup
```

This creates a timestamped directory in `backups/` containing:
- All table data as JSON files
- Backup manifest with metadata
- Restore scripts (both Node.js and Bash)
- Comprehensive README with instructions

### Restore to Self-Hosted Instance

```bash
# Update .env with your self-hosted Supabase URL and keys
# Then run:
npm run restore -- --backup-dir=./backups/backup-2025-01-05T12-30-00
```

## What Gets Backed Up

### Included ✅
- All application data from these tables:
  - `profiles` - User profile information
  - `user_roles` - Role assignments (admin/viewer)
  - `notification_settings` - SMTP and Teams configuration
  - `servers` - Dell server inventory
  - `vcenter_hosts` - vCenter infrastructure data
  - `jobs` - Job definitions and history
  - `job_tasks` - Task execution records
  - `audit_logs` - System audit trail

### NOT Included ❌
- **User passwords & authentication data** (stored in `auth.users` schema)
- **Database schema** (tables, functions, policies, triggers)
- **Storage bucket files** (if any uploaded files exist)
- **Edge function code** (already in your Git repository)

## Complete Migration Process

### Step 1: Backup Current Database

```bash
# Run the backup script
npm run backup

# Output example:
# 📁 Backup directory: backups/backup-2025-01-05T12-30-00
# 📦 Exporting profiles... ✅ Exported 5 records
# 📦 Exporting servers... ✅ Exported 23 records
# ...
# ✅ Backup completed successfully!
```

### Step 2: Export Database Schema

The backup script exports data only. For the complete schema:

```bash
# Option A: Using Supabase CLI (recommended)
supabase db dump -f schema.sql

# Option B: Using pg_dump with Docker
docker exec supabase-db pg_dump -U postgres \
  --schema-only \
  --no-owner \
  --no-privileges \
  postgres > schema.sql
```

### Step 3: Set Up Self-Hosted Supabase

```bash
# Clone Supabase repository
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker

# Configure environment
cp .env.example .env
# Edit .env with your preferences (passwords, ports, etc.)

# Start all services
docker compose up -d

# Wait for services to start (30-60 seconds)
docker compose ps
```

Services started:
- PostgreSQL database (port 5432)
- PostgREST API (port 3000)
- GoTrue Auth (port 9999)
- Realtime (port 4000)
- Storage API (port 5000)
- Kong API Gateway (port 8000)
- Studio Dashboard (port 8000)

### Step 4: Import Schema

```bash
# Apply migrations from your project
cd /path/to/your/project

# Option A: Copy migration files to container and run
for f in supabase/migrations/*.sql; do
  docker exec -i supabase-db psql -U postgres -d postgres < "$f"
done

# Option B: If you have the full schema dump
docker exec -i supabase-db psql -U postgres -d postgres < schema.sql
```

### Step 5: Update Application Configuration

Update your `.env` file:

```env
# Before (Lovable Cloud)
VITE_SUPABASE_URL=https://ylwkczjqvymshktuuqkx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGc...
VITE_SUPABASE_PROJECT_ID=ylwkczjqvymshktuuqkx

# After (Self-Hosted)
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
VITE_SUPABASE_PROJECT_ID=<your-project-id>
```

Get the anon key from Docker logs:
```bash
docker compose logs kong | grep -A 5 "anon key"
```

### Step 6: Import Data

```bash
# Update .env with self-hosted credentials first!
npm run restore -- --backup-dir=./backups/backup-2025-01-05T12-30-00
```

### Step 7: Recreate User Accounts

User passwords are not included in the backup. You need to:

**Option A: Let users reset passwords**
1. Users visit the auth page
2. Click "Forgot password"
3. Enter their email
4. Set a new password via the reset link

**Option B: Create accounts manually**
```bash
# In Supabase Studio (http://localhost:8000)
# Go to Authentication → Users → Add User
# Or use SQL:

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'user@example.com',
  crypt('temporary-password', gen_salt('bf')),
  now(),
  now(),
  now()
);
```

### Step 8: Verify Migration

```bash
# Test the application
npm run dev

# Check record counts match
# In psql or Supabase Studio:
SELECT 'profiles' as table, COUNT(*) FROM profiles
UNION ALL
SELECT 'servers', COUNT(*) FROM servers
UNION ALL
SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL
SELECT 'user_roles', COUNT(*) FROM user_roles;
```

## Backup Structure

```
backups/backup-2025-01-05T12-30-00/
├── manifest.json              # Backup metadata
├── README.md                  # Restore instructions
├── restore.sh                 # Bash restore script
├── profiles.json              # User profiles
├── user_roles.json            # Role assignments
├── notification_settings.json # Email/Teams config
├── servers.json               # Server inventory
├── vcenter_hosts.json         # vCenter data
├── jobs.json                  # Job history
├── job_tasks.json             # Task records
└── audit_logs.json            # Audit trail
```

## Manifest File

The `manifest.json` contains:
```json
{
  "timestamp": "2025-01-05T12:30:00.000Z",
  "supabaseUrl": "https://...",
  "tables": [
    {
      "table": "profiles",
      "records": 5,
      "success": true
    }
  ],
  "totalRecords": 150,
  "successfulTables": 8,
  "failedTables": 0
}
```

## Advanced Options

### Automated Backups

Set up a cron job for regular backups:

```bash
# Add to crontab (crontab -e)
# Backup every day at 2 AM
0 2 * * * cd /path/to/project && npm run backup

# Keep only last 7 days of backups
0 3 * * * find /path/to/project/backups -type d -mtime +7 -exec rm -rf {} +
```

### Selective Restore

Restore only specific tables:

```bash
# In restore-database.ts, comment out tables you don't want:
const TABLES = [
  'profiles',
  // 'user_roles',  // Skip this table
  'servers',
  // ...
];
```

### Large Database Optimization

For databases with millions of records:

1. **Use streaming instead of loading all at once:**
```typescript
// In backup script, process in chunks
const pageSize = 1000;
let page = 0;
let hasMore = true;

while (hasMore) {
  const { data } = await supabase
    .from(tableName)
    .select('*')
    .range(page * pageSize, (page + 1) * pageSize - 1);
  
  // Write to file incrementally
  hasMore = data && data.length === pageSize;
  page++;
}
```

2. **Use pg_dump for large datasets:**
```bash
# Much faster for large databases
pg_dump -h source.supabase.co -U postgres -Fc -Z9 postgres > backup.dump
pg_restore -h localhost -U postgres -d postgres backup.dump
```

## Troubleshooting

### "Row violates row-level security policy"

Disable RLS temporarily during restore:
```sql
-- In self-hosted instance
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE servers DISABLE ROW LEVEL SECURITY;
-- ... (for all tables)

-- After restore
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
```

### Foreign Key Violations

Ensure tables are restored in dependency order (already handled by scripts).

If issues persist:
```sql
SET session_replication_role = 'replica'; -- Disable triggers
-- Import data
SET session_replication_role = 'origin';  -- Re-enable triggers
```

### Missing Functions/Triggers

If schema wasn't imported correctly:
```bash
# Re-run all migrations
for f in supabase/migrations/*.sql; do
  docker exec -i supabase-db psql -U postgres -d postgres < "$f"
done
```

### Performance Issues

After large restores, rebuild statistics:
```sql
ANALYZE VERBOSE;
REINDEX DATABASE postgres;
```

## Security Considerations

1. **Backup Files Contain Sensitive Data**
   - Store backups securely
   - Encrypt backup files if needed
   - Don't commit backups to Git (already in .gitignore)

2. **Self-Hosted Security**
   - Change default passwords in `docker/.env`
   - Use SSL/TLS for production
   - Configure firewall rules
   - Set up regular automated backups

3. **Access Control**
   - Review RLS policies after migration
   - Verify role assignments
   - Test authentication flows

## Production Deployment

For production self-hosted setup:

1. **Use strong passwords** in `docker/.env`
2. **Enable SSL** with Let's Encrypt
3. **Set up monitoring** (Prometheus + Grafana)
4. **Configure backups** (automated pg_dump + off-site storage)
5. **Use a reverse proxy** (Nginx) with rate limiting
6. **Set resource limits** in docker-compose.yml
7. **Configure proper logging**

## Support

For issues or questions:
- Check [Supabase Self-Hosting Docs](https://supabase.com/docs/guides/self-hosting)
- Review [Supabase GitHub Issues](https://github.com/supabase/supabase/issues)
- Consult your system administrator

---

**Remember**: Always test your backups by restoring to a test environment before relying on them for production migration!
