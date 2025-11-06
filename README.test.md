# Integration Tests

This project includes comprehensive integration tests that validate end-to-end functionality including job creation, server management, and database operations.

## Test Structure

```
src/test/
├── setup.ts                    # Test environment setup
├── helpers/
│   ├── test-utils.tsx         # React testing utilities with providers
│   ├── supabase-helpers.ts    # Supabase test client and user management
│   └── test-factories.ts      # Factory functions for test data
└── integration/
    ├── jobs.test.ts           # Job creation and lifecycle tests
    ├── servers.test.ts        # Server CRUD and management tests
    └── database.test.ts       # Database operations and RLS tests
```

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run tests with coverage
```bash
npm run test:coverage
```

### Run tests with UI
```bash
npm run test:ui
```

### Run specific test file
```bash
npm test jobs.test.ts
```

## Test Coverage

### Job Integration Tests (`jobs.test.ts`)
- ✅ Job creation (firmware updates, configuration backups, BIOS settings)
- ✅ Job status transitions (pending → running → completed/failed)
- ✅ Job task creation and association
- ✅ Multi-server job scopes
- ✅ Job querying and filtering by status/type
- ✅ Full server update parent/child job relationships
- ✅ Error handling and failure scenarios

### Server Management Tests (`servers.test.ts`)
- ✅ Server CRUD operations (Create, Read, Update, Delete)
- ✅ Connection status management
- ✅ Server queries and filtering
- ✅ Hostname and IP address search
- ✅ Firmware and BIOS version tracking
- ✅ vCenter host linking
- ✅ Last seen timestamp updates

### Database Operations Tests (`database.test.ts`)
- ✅ Row Level Security (RLS) policy enforcement
- ✅ Admin permissions validation
- ✅ Database function execution (`has_role`, `get_user_role`)
- ✅ Audit log creation and viewing
- ✅ User profile management
- ✅ Referential integrity and foreign keys
- ✅ Concurrent update handling
- ✅ Transaction consistency

## Test Helpers

### Supabase Test Helpers

```typescript
import {
  initTestSupabase,
  createTestUser,
  signInTestUser,
  cleanupTestUser,
  getTestSupabase,
} from '../helpers/supabase-helpers';

// Initialize test client
initTestSupabase();

// Create test user with role
await createTestUser('admin'); // or 'operator', 'viewer'

// Sign in
await signInTestUser();

// Get client
const supabase = getTestSupabase();

// Cleanup
await cleanupTestUser();
```

### Test Factories

```typescript
import {
  createTestServer,
  createTestJob,
  createTestJobTask,
  generateRandomIP,
  generateServiceTag,
} from '../helpers/test-factories';

// Create test data
const server = createTestServer({
  hostname: 'my-test-server',
  ip_address: generateRandomIP(),
});

const job = createTestJob(userId, {
  job_type: 'firmware_update',
});
```

## Configuration

Test configuration is defined in `vitest.config.ts`:

```typescript
{
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
}
```

## Environment Variables

Tests use the same environment variables as the application:
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Supabase anon/public key

For local testing with Supabase, ensure your `.env` file is configured correctly.

## Best Practices

1. **Isolation**: Each test is isolated with proper setup/teardown
2. **Cleanup**: Test users and data are cleaned up after tests
3. **Authentication**: Tests authenticate as admin users by default
4. **Factories**: Use factory functions for consistent test data
5. **Assertions**: Use descriptive assertions with clear error messages
6. **Parallelization**: Tests can run in parallel safely

## Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## Troubleshooting

### Tests failing with authentication errors
- Ensure Supabase is running (local) or credentials are correct (cloud)
- Check that auto-confirm email is enabled in Supabase Auth settings
- Verify test user creation is successful

### Tests timing out
- Increase test timeout in vitest.config.ts
- Check network connectivity to Supabase
- Verify Docker containers are running (local Supabase)

### RLS policy errors
- Ensure test user has correct role (admin/operator)
- Check RLS policies in database match test expectations
- Verify `has_role` function exists and works correctly

## Adding New Tests

1. Create test file in appropriate directory
2. Import test helpers and factories
3. Set up beforeAll/afterAll hooks for authentication
4. Write descriptive test cases
5. Ensure proper cleanup

Example:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestUser, signInTestUser, cleanupTestUser } from '../helpers/supabase-helpers';

describe('My Feature Tests', () => {
  beforeAll(async () => {
    await createTestUser('admin');
    await signInTestUser();
  });

  afterAll(async () => {
    await cleanupTestUser();
  });

  it('should do something', async () => {
    // Test implementation
    expect(true).toBe(true);
  });
});
```

## Package Scripts

Add these to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage"
  }
}
```
