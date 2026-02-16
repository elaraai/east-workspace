# @elaraai/e3-admin-client

HTTP client library for e3 admin API.

## Installation

```bash
npm install @elaraai/e3-admin-client
```

## Usage

```typescript
import { whoami, repoUsers, addUser, removeUser, unwrap } from '@elaraai/e3-admin-client';
import { variant } from '@elaraai/east';

const options = { token: 'my-access-token' };

// Get current user
const me = unwrap(await whoami('https://dev.e3.elaraai.com', options));
console.log(`Logged in as ${me.sub}, admin: ${me.isAdmin}`);

// List users on a repo
const users = unwrap(await repoUsers('https://dev.e3.elaraai.com', 'my-repo', options));

// Add a user with member role
const newUser = unwrap(await addUser(
  'https://dev.e3.elaraai.com',
  'my-repo',
  { email: 'bob@example.com', role: variant('member', null) },
  options
));

// Remove a user
unwrap(await removeUser('https://dev.e3.elaraai.com', 'my-repo', 'user-id', options));
```

## API

### `whoami(url, options): Promise<Response<WhoamiResponse>>`

Get current user info.

### `repoUsers(url, repo, options): Promise<Response<RepoUser[]>>`

List users with access to a repository.

### `addUser(url, repo, request, options): Promise<Response<RepoUser>>`

Add a user to a repository.

### `removeUser(url, repo, userId, options): Promise<Response<null>>`

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

### `unwrap<T>(response: Response<T>): T`

Unwrap a response, throwing on error.

## Error Handling

All API functions return a `Response<T>` type that is either a success or an error:

```typescript
type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: AdminError };
```

Use `unwrap()` to extract the value, or handle errors explicitly:

```typescript
const response = await whoami(url, options);
if (response.type === 'error') {
  console.error('Error:', response.value.code, response.value.message);
} else {
  console.log('User:', response.value.sub);
}
```

## License

BSL-1.1 - See LICENSE.md
