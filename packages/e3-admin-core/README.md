# @elaraai/e3-admin-core

Core authorization logic and interfaces for e3 admin.

## Overview

This package provides:

- **Interfaces** - Cloud-agnostic storage interfaces (`AclStore`, `WhoamiBackend`)
- **Authorization logic** - Functions for access control (`hasAccess`, `canRemoveUser`, `isLastOwner`)
- **Error classes** - Typed error hierarchy for admin operations
- **Testing utilities** - In-memory implementations for unit tests

## Installation

```bash
npm install @elaraai/e3-admin-core
```

## Usage

### Authorization Checks

```typescript
import { hasAccess, canRemoveUser } from '@elaraai/e3-admin-core';

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
import { hasAccess } from '@elaraai/e3-admin-core';
import { InMemoryAclStore } from '@elaraai/e3-admin-core/testing';
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

### WhoamiBackend

Backend for retrieving identity information from requests.

```typescript
interface WhoamiBackend {
  getIdentity(requestContext: unknown): Identity | null;
}
```

## License

BSL-1.1 - See LICENSE.md for details.
