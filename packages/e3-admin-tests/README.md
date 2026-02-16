# @elaraai/e3-admin-tests

Portable integration tests for the e3 admin authorization API.

## Overview

This package provides test suites that verify the e3 authorization API contract. The tests are designed to be portable across different cloud providers (AWS, Azure, GCP) by parameterizing identity provider details.

## Usage

```typescript
import { describe, beforeEach, afterEach } from 'node:test';
import {
  createAdminTestContext,
  allAdminTests,
  type AdminTestContext,
  type AdminTestConfig,
} from '@elaraai/e3-admin-tests';

describe('Admin API Compliance', () => {
  let context: AdminTestContext;

  beforeEach(async () => {
    context = await createAdminTestContext({
      baseUrl: 'https://dev.e3.elaraai.com',
      getToken: async (userId) => {
        // Return access token for the test user
        return getTokenFromYourIdentityProvider(userId);
      },
      getTestUser: async (userId) => {
        // Return user identity info
        return { sub: '...', email: '...' };
      },
    });
  });

  afterEach(async () => {
    await context?.cleanup();
  });

  // Register all test suites
  allAdminTests(() => context);
});
```

## Test Users

The tests require 4 test users to be configured:

| User ID | Description |
|---------|-------------|
| `owner` | Regular user who owns test repositories |
| `member` | Regular user added as a member to repos |
| `outsider` | Regular user with no repository access |
| `admin` | Server admin with elevated privileges |

## Test Suites

### whoamiTests

Tests for `GET /api/whoami`:
- Returns user info for authenticated request
- Admin user has isAdmin=true
- Returns 401 for unauthenticated request

### repoUsersTests

Tests for repository user management:
- `GET /repos/{repo}/users` - List users
- `POST /repos/{repo}/users` - Add user
- `DELETE /repos/{repo}/users/{userId}` - Remove user

### authorizationTests

Cross-cutting permission tests:
- Outsider cannot access repo endpoints
- Member can read but not modify users
- Owner can perform all operations
- Admin bypasses ACL checks (except last owner removal)

### scheduleTests

Tests for workspace schedule management:
- `GET /repos/{repo}/workspaces/{ws}/schedule` - Get schedule
- `PUT /repos/{repo}/workspaces/{ws}/schedule` - Create/update schedule
- `DELETE /repos/{repo}/workspaces/{ws}/schedule` - Delete schedule
- `GET /repos/{repo}/schedules` - List schedules

### taskConfigTests

Tests for per-task compute and timeout configuration:
- `GET /repos/{repo}/workspaces/{ws}/task-configs` - Unified config view
- `GET/PUT/POST/DELETE .../task-configs/compute` - Compute size CRUD + batch
- `GET/PUT/POST/DELETE .../task-configs/timeout` - Timeout CRUD + batch
- Default values (serverless→15min, sized→1440min)
- Timeout validation (5–43200 minutes)
- Authorization (outsider forbidden, member allowed)

## API

### `createAdminTestContext(config: AdminTestConfig): Promise<AdminTestContext>`

Create a test context for running tests.

### `allAdminTests(getContext: () => AdminTestContext): void`

Register all test suites with the Node.js test runner.

### Individual Suites

- `whoamiTests(getContext)` - Whoami endpoint tests
- `repoUsersTests(getContext)` - User management tests
- `authorizationTests(getContext)` - Permission tests
- `scheduleTests(getContext)` - Schedule management tests
- `taskConfigTests(getContext)` - Task config tests

## Types

```typescript
type TestUserId = 'owner' | 'member' | 'outsider' | 'admin';

interface TestUser {
  sub: string;
  email: string;
}

interface AdminTestConfig {
  baseUrl: string;
  getToken: (userId: TestUserId) => Promise<string>;
  getTestUser: (userId: TestUserId) => Promise<TestUser>;
  cleanup?: boolean;
}

interface AdminTestContext {
  config: AdminTestConfig;
  repoName: string;
  opts: (userId?: TestUserId) => Promise<RequestOptions>;
  getTestUser: (userId: TestUserId) => Promise<TestUser>;
  cleanup: () => Promise<void>;
}
```
