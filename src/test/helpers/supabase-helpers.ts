import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

let testSupabaseClient: SupabaseClient<Database> | null = null;
let testUserId: string | null = null;
let testUserEmail: string = '';
let testUserPassword: string = '';

/**
 * Initialize test Supabase client with admin privileges
 */
export const initTestSupabase = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not configured for tests');
  }

  testSupabaseClient = createClient<Database>(supabaseUrl, supabaseKey);
  return testSupabaseClient;
};

/**
 * Create a test user with specified role
 */
export const createTestUser = async (role: 'admin' | 'operator' | 'viewer' = 'admin') => {
  if (!testSupabaseClient) initTestSupabase();

  // Generate unique test credentials
  const timestamp = Date.now();
  testUserEmail = `test-user-${timestamp}@example.com`;
  testUserPassword = `TestPass123!${timestamp}`;

  // Sign up the test user
  const { data: authData, error: signUpError } = await testSupabaseClient!.auth.signUp({
    email: testUserEmail,
    password: testUserPassword,
    options: {
      data: {
        full_name: `Test User ${timestamp}`,
      },
    },
  });

  if (signUpError || !authData.user) {
    throw new Error(`Failed to create test user: ${signUpError?.message}`);
  }

  testUserId = authData.user.id;

  // Update user role if not default
  if (role !== 'viewer') {
    const { error: roleError } = await testSupabaseClient!
      .from('user_roles')
      .update({ role })
      .eq('user_id', testUserId);

    if (roleError) {
      throw new Error(`Failed to set user role: ${roleError.message}`);
    }
  }

  return {
    userId: testUserId,
    email: testUserEmail,
    password: testUserPassword,
  };
};

/**
 * Sign in as test user
 */
export const signInTestUser = async () => {
  if (!testSupabaseClient || !testUserEmail || !testUserPassword) {
    throw new Error('Test user not created. Call createTestUser first.');
  }

  const { data, error } = await testSupabaseClient.auth.signInWithPassword({
    email: testUserEmail,
    password: testUserPassword,
  });

  if (error) {
    throw new Error(`Failed to sign in test user: ${error.message}`);
  }

  return data;
};

/**
 * Clean up test user and related data
 */
export const cleanupTestUser = async () => {
  if (!testSupabaseClient || !testUserId) return;

  try {
    // Delete test data created by the user
    await testSupabaseClient.from('jobs').delete().eq('created_by', testUserId);
    await testSupabaseClient.from('servers').delete().eq('id', testUserId); // Clean test servers
    
    // Sign out
    await testSupabaseClient.auth.signOut();
    
    // Note: User deletion requires service role key, so we skip it in tests
    // In production, you'd want to use a service role client for cleanup
  } catch (error) {
    console.error('Cleanup error:', error);
  }

  testUserId = null;
  testUserEmail = '';
  testUserPassword = '';
};

/**
 * Get the test Supabase client
 */
export const getTestSupabase = () => {
  if (!testSupabaseClient) {
    initTestSupabase();
  }
  return testSupabaseClient!;
};

/**
 * Get current test user ID
 */
export const getTestUserId = () => testUserId;
