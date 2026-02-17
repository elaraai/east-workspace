# @elaraai/e3-admin-client

HTTP client library for e3 admin API.

## Installation

```bash
npm install @elaraai/e3-admin-client
```

## Usage

```typescript
import { whoami, repoUsers, addUser, removeUser, ApiError } from '@elaraai/e3-admin-client';
import { variant } from '@elaraai/east';

const options = { token: 'my-access-token' };

// Get current user
const me = await whoami('https://dev.e3.elaraai.com', options);
console.log(`Logged in as ${me.sub}, admin: ${me.isAdmin}`);

// List users on a repo
const users = await repoUsers('https://dev.e3.elaraai.com', 'my-repo', options);

// Add a user with member role
const newUser = await addUser(
  'https://dev.e3.elaraai.com',
  'my-repo',
  { email: 'bob@example.com', role: variant('member', null) },
  options
);

// Remove a user
await removeUser('https://dev.e3.elaraai.com', 'my-repo', 'user-id', options);
```

## API

### `whoami(url, options): Promise<WhoamiResponse>`

Get current user info.

### `repoUsers(url, repo, options): Promise<RepoUser[]>`

List users with access to a repository.

### `addUser(url, repo, request, options): Promise<RepoUser>`

Add a user to a repository.

### `removeUser(url, repo, userId, options): Promise<void>`

Remove a user from a repository.

### `listCompute(url, repo, workspace, options): Promise<ComputeConfigMap>`

List all compute configs for a workspace.

### `getCompute(url, repo, workspace, taskName, options): Promise<ComputeSize>`

Get the compute size for a task.

### `setCompute(url, repo, workspace, taskName, size, options): Promise<ComputeSize>`

Set the compute size for a task.

### `setComputeBatch(url, repo, workspace, configs, options): Promise<ComputeConfigMap>`

Batch set compute configs for a workspace.

### `removeCompute(url, repo, workspace, taskName, options): Promise<void>`

Remove the compute config for a task.

### `listTimeout(url, repo, workspace, options): Promise<TimeoutConfigMap>`

List all timeout configs for a workspace.

### `getTimeout(url, repo, workspace, taskName, options): Promise<TaskTimeout>`

Get the timeout for a task. Returns the effective default (15m for serverless, 1440m for sized) if not explicitly set.

### `setTimeout(url, repo, workspace, taskName, timeout, options): Promise<TaskTimeout>`

Set the timeout for a task.

### `setTimeoutBatch(url, repo, workspace, configs, options): Promise<TimeoutConfigMap>`

Batch set timeout configs for a workspace.

### `removeTimeout(url, repo, workspace, taskName, options): Promise<void>`

Remove the timeout config for a task.

### `listTaskConfigs(url, repo, workspace, options): Promise<TaskConfigs>`

List all task configs (compute + timeout) for a workspace.

## Error Handling

All API functions throw on failure. Two error types are re-exported from `@elaraai/e3-api-client`:

- **`ApiError`** — Application-level errors (e.g., `forbidden`, `not_found`, `user_not_found`)
- **`AuthError`** — 401 Unauthorized (token expired or invalid)

```typescript
import { whoami, ApiError, AuthError } from '@elaraai/e3-admin-client';

try {
  const me = await whoami(url, options);
  console.log('User:', me.sub);
} catch (error) {
  if (error instanceof AuthError) {
    console.error('Not authenticated');
  } else if (error instanceof ApiError) {
    console.error('Error:', error.code, error.message);
  }
}
```

## License

BSL-1.1 - See LICENSE.md
