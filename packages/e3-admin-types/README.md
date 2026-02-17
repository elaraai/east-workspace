# @elaraai/e3-admin-types

Shared East type definitions for e3-aws authorization.

## Installation

This package is part of the e3-aws monorepo and is not published to npm.

```bash
npm install
```

## Usage

```typescript
import {
  // East type values (for serialization, type checking)
  RepoRoleType,
  RepoUserType,
  AddUserRequestType,
  WhoamiResponseType,
  AuthzErrorType,
  AuthzErrorCodeType,
  ComputeSizeType,
  TaskTimeoutType,
  ComputeConfigMapType,
  TimeoutConfigMapType,
  TaskConfigsType,

  // TypeScript types (derived via ValueTypeOf)
  type RepoRole,
  type RepoUser,
  type AddUserRequest,
  type WhoamiResponse,
  type AuthzError,
  type AuthzErrorCode,
  type ComputeSize,
  type TaskTimeout,
  type ComputeConfigMap,
  type TimeoutConfigMap,
  type TaskConfigs,

  // Runtime utilities
  parseRepoRole,
} from '@elaraai/e3-admin-types';

import { variant, some } from '@elaraai/east';

// Parse a role from user input (throws if invalid)
const role = parseRepoRole(userInput);

// Create a RepoUser
const user: RepoUser = {
  userId: 'abc123-def456',
  email: 'alice@example.com',
  name: some('Alice Smith'),
  role: variant('owner', null),
  addedBy: 'abc123-def456',
  addedAt: '2025-01-29T10:00:00Z',
};
```

## Types

### RepoRoleType / RepoRole

Role a user can have on a repository (variant type):
- `.owner` - Full access + manage ACL + delete repo
- `.member` - Read/write data, deploy, execute dataflow

### RepoUserType / RepoUser

A user entry in a repository's ACL:
- `userId` - Cognito subject ID (immutable, primary key)
- `email` - User's email address (for display)
- `name` - Optional display name (OptionType)
- `role` - User's role on the repository (RepoRoleType)
- `addedBy` - userId of who added this entry
- `addedAt` - ISO 8601 timestamp

### AddUserRequestType / AddUserRequest

Request body for adding a user to a repository.

### WhoamiResponseType / WhoamiResponse

Response from `/api/whoami` endpoint.

### AuthzErrorType / AuthzError

Error response for authorization failures.

### ScheduleType / Schedule

A workspace schedule for recurring dataflow execution:
- `repo` - Repository name
- `workspace` - Workspace name
- `cronExpression` - Unix 5-field cron expression
- `timezone` - IANA timezone string
- `forceTasks` - Task names to force (skip cache)
- `enabled` - Whether schedule is active
- `description` - Optional human-readable description (OptionType)
- `createdBy` - userId who created the schedule
- `createdAt` / `updatedAt` - ISO 8601 timestamps
- `schedulerName` - EventBridge Scheduler name

### ScheduleRequestType / ScheduleRequest

Request body for creating or updating a schedule.

### TriggeredByType / TriggeredBy

How a dataflow run was initiated (variant type):
- `.schedule` - `{ schedulerExecutionId, scheduledTime }`
- `.user` - `{ userId, email }`

### ComputeSizeType / ComputeSize

Compute tier for task execution (variant type):
- `.small` - Fargate 2 vCPU / 8 GB
- `.medium` - Fargate 4 vCPU / 16 GB
- `.large` - Fargate 8 vCPU / 32 GB
- `.xlarge` - Fargate 16 vCPU / 64 GB

### TaskTimeoutType / TaskTimeout

Custom timeout configuration for a task:
- `minutes` - Timeout in minutes (5–43200)

### ComputeConfigMapType / ComputeConfigMap

Dictionary of task name → ComputeSize.

### TimeoutConfigMapType / TimeoutConfigMap

Dictionary of task name → TaskTimeout.

### TaskConfigsType / TaskConfigs

Combined task configuration struct:
- `compute` - ComputeConfigMap
- `timeout` - TimeoutConfigMap

## Peer Dependencies

- `@elaraai/east` - East type system

## License

Business Source License 1.1 - see [LICENSE.md](./LICENSE.md)
