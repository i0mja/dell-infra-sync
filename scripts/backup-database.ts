/**
 * Database Backup Script
 * 
 * Exports all data from the current Supabase database to JSON files
 * for easy migration to a self-hosted instance.
 * 
 * Usage: npm run backup
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Tables to backup in order (respecting foreign key dependencies)
const TABLES = [
  'profiles',
  'user_roles',
  'notification_settings',
  'servers',
  'vcenter_hosts',
  'jobs',
  'job_tasks',
  'audit_logs',
];

interface BackupResult {
  table: string;
  records: number;
  success: boolean;
  error?: string;
}

async function createBackupDirectory(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupDir = path.join(process.cwd(), 'backups', `backup-${timestamp}`);
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  return backupDir;
}

async function exportTable(tableName: string): Promise<BackupResult> {
  try {
    console.log(`📦 Exporting ${tableName}...`);
    
    const { data, error } = await supabase
      .from(tableName)
      .select('*');

    if (error) {
      return {
        table: tableName,
        records: 0,
        success: false,
        error: error.message,
      };
    }

    return {
      table: tableName,
      records: data?.length || 0,
      success: true,
    };
  } catch (error: any) {
    return {
      table: tableName,
      records: 0,
      success: false,
      error: error.message,
    };
  }
}

async function saveBackupManifest(
  backupDir: string,
  results: BackupResult[]
): Promise<void> {
  const manifest = {
    timestamp: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    tables: results,
    totalRecords: results.reduce((sum, r) => sum + r.records, 0),
    successfulTables: results.filter(r => r.success).length,
    failedTables: results.filter(r => !r.success).length,
  };

  const manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function exportAllTables(backupDir: string): Promise<BackupResult[]> {
  const results: BackupResult[] = [];

  for (const tableName of TABLES) {
    const result = await exportTable(tableName);
    results.push(result);

    if (result.success) {
      // Fetch and save the data
      const { data } = await supabase.from(tableName).select('*');
      const filePath = path.join(backupDir, `${tableName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`   ✅ Exported ${result.records} records`);
    } else {
      console.log(`   ❌ Failed: ${result.error}`);
    }
  }

  return results;
}

async function createRestoreScript(backupDir: string): Promise<void> {
  const scriptContent = `#!/bin/bash
# Database Restore Script
# 
# This script imports the backup data into your self-hosted Supabase instance
# 
# Usage: ./restore.sh

set -e

echo "🔄 Starting database restore..."
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ psql not found. Please install PostgreSQL client tools."
    exit 1
fi

# Database connection details
read -p "Enter PostgreSQL host (default: localhost): " DB_HOST
DB_HOST=\${DB_HOST:-localhost}

read -p "Enter PostgreSQL port (default: 5432): " DB_PORT
DB_PORT=\${DB_PORT:-5432}

read -p "Enter database name (default: postgres): " DB_NAME
DB_NAME=\${DB_NAME:-postgres}

read -p "Enter database user (default: postgres): " DB_USER
DB_USER=\${DB_USER:-postgres}

read -sp "Enter database password: " DB_PASSWORD
echo ""

export PGPASSWORD=\$DB_PASSWORD

# Import data for each table
${TABLES.map(table => `
echo "📥 Importing ${table}..."
cat ${table}.json | jq -c '.[]' | while read -r line; do
    echo "INSERT INTO public.${table} SELECT * FROM json_populate_record(NULL::public.${table}, '\$line');" | \\
        psql -h "\$DB_HOST" -p "\$DB_PORT" -U "\$DB_USER" -d "\$DB_NAME"
done`).join('\n')}

echo ""
echo "✅ Database restore completed successfully!"
echo ""
echo "Next steps:"
echo "1. Verify the data in your self-hosted instance"
echo "2. Update your application's .env file with the new connection details"
echo "3. Test the application thoroughly"
`;

  const scriptPath = path.join(backupDir, 'restore.sh');
  fs.writeFileSync(scriptPath, scriptContent);
  fs.chmodSync(scriptPath, 0o755);
}

async function createReadme(backupDir: string): Promise<void> {
  const readmeContent = `# Database Backup

Created: ${new Date().toISOString()}
Source: ${SUPABASE_URL}

## Files in this backup

- **manifest.json**: Backup metadata and statistics
- **[table].json**: Data files for each table
- **restore.sh**: Bash script to restore data
- **README.md**: This file

## Tables backed up

${TABLES.map(table => `- ${table}`).join('\n')}

## Restoring to Self-Hosted Supabase

### Option 1: Using Docker (Recommended)

1. **Start your self-hosted Supabase instance:**
   \`\`\`bash
   cd supabase/docker
   docker compose up -d
   \`\`\`

2. **Import the schema:**
   \`\`\`bash
   # First, apply all migrations from your project
   docker exec -i supabase-db psql -U postgres < ../../supabase/migrations/*.sql
   \`\`\`

3. **Import the data:**
   \`\`\`bash
   # Use the restore script
   ./restore.sh
   
   # Or import manually for each table:
   cat profiles.json | docker exec -i supabase-db \\
     psql -U postgres -d postgres -c \\
     "COPY profiles FROM STDIN WITH (FORMAT json)"
   \`\`\`

### Option 2: Using psql Directly

1. **Connect to your database:**
   \`\`\`bash
   psql -h localhost -p 5432 -U postgres -d postgres
   \`\`\`

2. **For each table, insert the data:**
   \`\`\`sql
   -- Example for profiles table
   INSERT INTO profiles 
   SELECT * FROM json_populate_recordset(NULL::profiles, 
     pg_read_file('/path/to/profiles.json')::json
   );
   \`\`\`

### Option 3: Using Supabase CLI

1. **Link to your self-hosted instance:**
   \`\`\`bash
   supabase link --project-ref your-project-ref
   \`\`\`

2. **Apply migrations:**
   \`\`\`bash
   supabase db push
   \`\`\`

3. **Import data using the Supabase API:**
   \`\`\`bash
   # Use a script to POST the JSON data to your API
   npm run restore
   \`\`\`

## Important Notes

- **Order matters**: Tables are exported in dependency order
- **Auth users**: User accounts from \`auth.users\` are NOT included in this backup
  - You'll need to recreate user accounts or migrate them separately
  - User passwords are hashed and stored in the auth schema
- **Sequences**: After restore, reset sequences:
  \`\`\`sql
  SELECT setval(pg_get_serial_sequence('table_name', 'id'), 
    COALESCE((SELECT MAX(id) FROM table_name), 1));
  \`\`\`

## Schema Export

To export the complete schema including functions and policies:

\`\`\`bash
# Export full schema
docker exec supabase-db pg_dump -U postgres \\
  --schema-only \\
  --no-owner \\
  --no-privileges \\
  postgres > schema.sql

# Or use Supabase CLI
supabase db dump -f schema.sql
\`\`\`

## Verification

After restoring, verify the data:

\`\`\`sql
-- Check record counts
SELECT 'profiles' as table, COUNT(*) FROM profiles
UNION ALL
SELECT 'servers', COUNT(*) FROM servers
UNION ALL
SELECT 'jobs', COUNT(*) FROM jobs;
\`\`\`

## Troubleshooting

### Foreign Key Violations
If you encounter foreign key errors, disable checks temporarily:
\`\`\`sql
SET session_replication_role = 'replica';
-- Import data
SET session_replication_role = 'origin';
\`\`\`

### Permission Issues
Ensure the database user has sufficient privileges:
\`\`\`sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
\`\`\`

### Large Datasets
For large datasets, consider using pg_dump/pg_restore instead:
\`\`\`bash
pg_dump -h source-host -U postgres -Fc postgres > backup.dump
pg_restore -h target-host -U postgres -d postgres backup.dump
\`\`\`
`;

  const readmePath = path.join(backupDir, 'README.md');
  fs.writeFileSync(readmePath, readmeContent);
}

async function main() {
  console.log('🚀 Starting database backup...\n');

  try {
    // Create backup directory
    const backupDir = await createBackupDirectory();
    console.log(`📁 Backup directory: ${backupDir}\n`);

    // Export all tables
    const results = await exportAllTables(backupDir);

    // Save manifest
    await saveBackupManifest(backupDir, results);

    // Create restore script
    await createRestoreScript(backupDir);

    // Create README
    await createReadme(backupDir);

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Backup Summary');
    console.log('='.repeat(50));
    console.log(`Total tables: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    console.log(`Total records: ${results.reduce((sum, r) => sum + r.records, 0)}`);
    console.log('='.repeat(50));

    if (results.some(r => !r.success)) {
      console.log('\n⚠️  Some tables failed to export:');
      results
        .filter(r => !r.success)
        .forEach(r => console.log(`   - ${r.table}: ${r.error}`));
    }

    console.log(`\n✅ Backup completed successfully!`);
    console.log(`📁 Files saved to: ${backupDir}`);
    console.log(`\n📖 See README.md in the backup directory for restore instructions`);

  } catch (error: any) {
    console.error('\n❌ Backup failed:', error.message);
    process.exit(1);
  }
}

main();
