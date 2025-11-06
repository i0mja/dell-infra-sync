import { expect, afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Setup environment variables for tests
beforeAll(() => {
  // Mock environment variables if needed
  if (!import.meta.env.VITE_SUPABASE_URL) {
    import.meta.env.VITE_SUPABASE_URL = 'http://localhost:8000';
  }
  if (!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'test-key';
  }
});

afterAll(() => {
  // Cleanup after all tests
});
