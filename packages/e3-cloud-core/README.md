# @elaraai/e3-cloud-core

Core authorization logic and interfaces for e3 admin.

## Overview

This package provides:

- **Interfaces** - Cloud-agnostic storage interfaces (`AclStore`, `IdentityBackend`, `DataflowOrchestrator`, etc.)
- **Authorization logic** - Functions for access control (`hasAccess`, `canRemoveUser`, `isLastOwner`)
- **Route factories** - Cloud-agnostic Hono route handlers for admin, repo, dataflow, schedule, task-config, and GC endpoints
- **Error classes** - Typed error hierarchy for admin operations
- **Testing utilities** - In-memory implementations for unit tests

## Installation

```bash
npm install @elaraai/e3-cloud-core
```

## Usage

### Authorization Checks

```typescript
import { hasAccess, canRemoveUser } from '@elaraai/e3-cloud-core';

// Check if user has access to a repository
const canRead = await hasAccess(aclStore, 'my-repo', userId, 'member', isAdmin);
const canManage = await hasAccess(aclStore, 'my-repo', userId, 'owner', isAdmin);

// Check if a user can be removed
const result = await canRemoveUser(aclStore, 'my-repo', actorId, targetId, isAdmin);
if (!result.ok) {
  console.error(result.code.type, result.message);
}
```

### Testing with In-Memory Store

```typescript
import { hasAccess } from '@elaraai/e3-cloud-core';
import { InMemoryAclStore } from '@elaraai/e3-cloud-core/testing';
import { variant } from '@elaraai/east';

const store = new InMemoryAclStore();

// Add test users
await store.addUser('repo', {
  userId: 'user-1',
  email: 'owner@example.com',
  name: { value: 'Owner' },
  role: variant('owner', null),
  addedBy: 'system',
  addedAt: new Date().toISOString(),
});

// Run authorization checks
const hasOwnerAccess = await hasAccess(store, 'repo', 'user-1', 'owner', false);
```

## Interfaces

### AclStore

Storage interface for repository access control lists.

```typescript
interface AclStore {
  listUsers(repo: string): Promise<RepoUser[]>;
  addUser(repo: string, user: RepoUser): Promise<RepoUser>;
  removeUser(repo: string, userId: string): Promise<void>;
  getRole(repo: string, userId: string): Promise<RepoRole | null>;
  listReposForUser(userId: string): Promise<string[]>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

Implementations:
- `InMemoryAclStore` (testing) - In this package
- `DynamoDbAclStore` (e3-aws) - DynamoDB with GSI for user lookups

### IdentityBackend

Backend for identity extraction and user lookup.

```typescript
interface IdentityBackend {
  getIdentity(requestContext: unknown): Identity | null;
  lookupUserByEmail(email: string): Promise<{ sub: string; email: string; name?: string } | null>;
}
```

Implementations:
- `MockIdentityBackend` (testing) - In this package
- `CognitoIdentityBackend` (e3-aws-api) - Extracts from API Gateway authorizer, looks up users in Cognito

### TaskConfigStore

Storage interface for per-task compute and timeout configuration.

```typescript
interface TaskConfigStore {
  getCompute(repo: string, workspace: string, taskName: string): Promise<ComputeSize | null>;
  putCompute(repo: string, workspace: string, taskName: string, size: ComputeSize): Promise<void>;
  putComputeBatch(repo: string, workspace: string, configs: Record<string, ComputeSize>): Promise<void>;
  deleteCompute(repo: string, workspace: string, taskName: string): Promise<void>;
  deleteComputeBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;
  listCompute(repo: string, workspace: string): Promise<Record<string, ComputeSize>>;
  getTimeout(repo: string, workspace: string, taskName: string): Promise<TaskTimeout | null>;
  putTimeout(repo: string, workspace: string, taskName: string, timeout: TaskTimeout): Promise<void>;
  putTimeoutBatch(repo: string, workspace: string, configs: Record<string, TaskTimeout>): Promise<void>;
  deleteTimeout(repo: string, workspace: string, taskName: string): Promise<void>;
  deleteTimeoutBatch(repo: string, workspace: string, taskNames: string[]): Promise<void>;
  listTimeout(repo: string, workspace: string): Promise<Record<string, TaskTimeout>>;
  deleteAllForWorkspace(repo: string, workspace: string): Promise<void>;
  deleteAllForRepo(repo: string): Promise<void>;
}
```

Implementations:
- `DynamoTaskConfigStore` (e3-aws-storage) - DynamoDB-backed

### DataflowOrchestrator

Cloud-agnostic interface for starting dataflow executions.

```typescript
interface DataflowOrchestrator {
  startExecution(params: {
    repo: string;
    workspace: string;
    executionId: number;
    force: boolean;
    forceTasks: string[];
    filter?: string;
    runId: string;
    triggeredBy?: { type: string; value: unknown };
  }): Promise<string>;
}
```

Implementations:
- `InMemoryDataflowOrchestrator` (testing) - In this package
- `SfnDataflowOrchestrator` (e3-aws-storage) - AWS Step Functions

## Route Factories

Cloud-agnostic Hono route factories are available from the `@elaraai/e3-cloud-core/routes` export path. Each factory accepts abstract interfaces (e.g., `IdentityBackend`, `AclStore`) via dependency injection.

```typescript
import {
  createAuthzMiddleware,
  createAdminRoutes,
  createRepoRoutes,
  createDataflowRoutes,
  createScheduleRoutes,
  createScheduleListRoute,
  createTaskConfigRoutes,
  createGcRoutes,
} from '@elaraai/e3-cloud-core/routes';
```

| Factory | Description |
|---------|-------------|
| `createAuthzMiddleware` | Authorization middleware for `/api/repos/*` routes |
| `createAdminRoutes` | User management and admin endpoints |
| `createRepoRoutes` | Repository lifecycle (create, delete, list) |
| `createDataflowRoutes` | Dataflow execution (start, cancel, status) |
| `createScheduleRoutes` | Workspace schedule CRUD |
| `createScheduleListRoute` | List schedules for a repo |
| `createTaskConfigRoutes` | Per-task compute and timeout configuration |
| `createGcRoutes` | Garbage collection (start, status) |

### GcOrchestrator

Cloud-agnostic interface for orchestrating garbage collection executions.

```typescript
interface GcOrchestrator {
  startGc(params: { repo: string; gcId: string; startTime: number }): Promise<string>;
  getGcStatus(executionId: string): Promise<GcStatus>;
}
```

Implementations:
- `InMemoryGcOrchestrator` (testing) - In this package
- `SfnGcOrchestrator` (e3-aws-api) - AWS Step Functions

## License

BSL-1.1 - See LICENSE.md for details.
