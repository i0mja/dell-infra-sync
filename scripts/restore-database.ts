/**
 * Database Restore Script
 * 
 * Imports data from backup files into a self-hosted Supabase instance
 * 
 * Usage: npm run restore -- --backup-dir ./backups/backup-2025-01-05
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const backupDirArg = args.find(arg => arg.startsWith('--backup-dir='));
const backupDir = backupDirArg?.split('=')[1];

if (!backupDir || !fs.existsSync(backupDir)) {
  console.error('❌ Please provide a valid backup directory');
  console.error('Usage: npm run restore -- --backup-dir=./backups/backup-2025-01-05');
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in environment variables');
  console.error('Make sure to update .env with your self-hosted instance details');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface RestoreResult {
  table: string;
  records: number;
  success: boolean;
  error?: string;
}

async function loadManifest() {
  const manifestPath = path.join(backupDir, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Backup manifest not found');
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

async function restoreTable(tableName: string): Promise<RestoreResult> {
  try {
    console.log(`📥 Restoring ${tableName}...`);
    
    const filePath = path.join(backupDir, `${tableName}.json`);
    
    if (!fs.existsSync(filePath)) {
      return {
        table: tableName,
        records: 0,
        success: false,
        error: 'Backup file not found',
      };
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    if (!Array.isArray(data) || data.length === 0) {
      console.log(`   ⚠️  No data to restore`);
      return {
        table: tableName,
        records: 0,
        success: true,
      };
    }

    // Insert data in batches to avoid timeout
    const batchSize = 100;
    let totalInserted = 0;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      const { error } = await supabase
        .from(tableName)
        .insert(batch);

      if (error) {
        throw new Error(error.message);
      }

      totalInserted += batch.length;
      console.log(`   📊 Inserted ${totalInserted}/${data.length} records`);
    }

    console.log(`   ✅ Restored ${totalInserted} records`);
    
    return {
      table: tableName,
      records: totalInserted,
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

async function confirmRestore(): Promise<boolean> {
  console.log('⚠️  WARNING: This will INSERT data into your database');
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Backup: ${backupDir}`);
  console.log('');
  
  // In a real implementation, you'd want to use readline for interactive confirmation
  // For now, we'll just return true
  return true;
}

async function main() {
  console.log('🔄 Starting database restore...\n');

  try {
    // Load manifest
    const manifest = await loadManifest();
    console.log(`📦 Backup created: ${manifest.timestamp}`);
    console.log(`📊 Total records: ${manifest.totalRecords}`);
    console.log(`📋 Tables: ${manifest.tables.length}\n`);

    // Confirm restore
    const confirmed = await confirmRestore();
    if (!confirmed) {
      console.log('❌ Restore cancelled');
      process.exit(0);
    }

    console.log('');

    // Restore tables in order
    const results: RestoreResult[] = [];
    
    for (const tableInfo of manifest.tables) {
      if (!tableInfo.success) {
        console.log(`⚠️  Skipping ${tableInfo.table} (was not backed up successfully)`);
        continue;
      }

      const result = await restoreTable(tableInfo.table);
      results.push(result);
    }

    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Restore Summary');
    console.log('='.repeat(50));
    console.log(`Total tables: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    console.log(`Total records: ${results.reduce((sum, r) => sum + r.records, 0)}`);
    console.log('='.repeat(50));

    if (results.some(r => !r.success)) {
      console.log('\n⚠️  Some tables failed to restore:');
      results
        .filter(r => !r.success)
        .forEach(r => console.log(`   - ${r.table}: ${r.error}`));
    }

    console.log('\n✅ Restore completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Verify the data in your database');
    console.log('2. Check that RLS policies are working correctly');
    console.log('3. Test your application thoroughly');
    console.log('4. Recreate user accounts (auth.users not included in backup)');

  } catch (error: any) {
    console.error('\n❌ Restore failed:', error.message);
    process.exit(1);
  }
}

main();
