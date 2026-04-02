# e3-aws Repository Authorization

Repository-level authorization for e3-aws using AWS services.

---

## Overview

This document specifies repository-level authorization for e3-aws. The core e3 repository has no authorization - any authenticated user can access any repository. e3-aws adds per-repository access control using Cognito for identity and DynamoDB for ACL storage.

### Scope

| Aspect | Location |
|--------|----------|
| Types | `e3-cloud-types` package |
| Interfaces | `e3-cloud-core` package |
| Storage | DynamoDB |
| Admin detection | Cognito groups |
| User lookup | Cognito ListUsers |

### Authentication vs Authorization

```
Authentication (Cognito)          Authorization (this design)
────────────────────────          ──────────────────────────
JWT signature validation          Per-repo access control
Token expiry checking             Owner/member roles
Identity extraction (sub)         Server admin permissions
Cognito groups (admin)            DynamoDB ACL storage
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Location | e3-aws only | Keep e3 simple; authz storage is cloud-specific |
| Packages | 4 packages (mirrors e3 structure) | Consistent, modular, allows future cloud providers |
| Licensing | BSL 1.1 | Consistent with e3, allows npm distribution |
| Identity key | `sub` (Cognito subject) | Immutable; email for display only |
| Roles | owner / member | Simple; owner can manage ACL |
| Server admins | Cognito groups | No bootstrapping issue; IdP manages admins |
| ACL storage | DynamoDB | Cloud-native; deleted with repo |

---

## Package Structure

The authorization admin tooling is organized into four packages, mirroring the e3 package structure:

```
e3-aws/packages/
├── e3-cloud-types/       # @elaraai/e3-cloud-types
│   ├── package.json      # BSL 1.1 license
│   └── src/
│       └── types.ts      # RepoRole, RepoUser, AuthzConfig, etc.
│
├── e3-cloud-core/        # @elaraai/e3-cloud-core
│   ├── package.json      # BSL 1.1 license
│   └── src/
│       ├── index.ts
│       ├── acl-store.ts  # AclStore interface
│       └── authz.ts      # hasAccess(), canRemoveUser(), isLastOwner()
│
├── e3-cloud-client/      # @elaraai/e3-cloud-client
│   ├── package.json      # BSL 1.1 license
│   └── src/
│       ├── index.ts
│       └── users.ts      # repoUsers(), addUser(), removeUser(), whoami()
│
└── e3-cloud-cli/         # @elaraai/e3-cloud-cli
    ├── package.json      # BSL 1.1 license
    └── src/
        ├── index.ts
        └── cli.ts        # e3-cloud commands (whoami, user list/add/remove)
```

### Package Dependencies

```
e3-cloud-types (no deps)
       ↑
e3-cloud-core (types)
       ↑
e3-cloud-client (core, types)
       ↑
e3-cloud-cli (client, core, types)
```

---

## Types (e3-cloud-types)

### RepoRole

```typescript
/**
 * Role a user can have on a repository.
 * - owner: Full access + manage ACL + delete repo
 * - member: Read/write data, deploy, execute dataflow
 */
export type RepoRole = 'owner' | 'member';

export const RepoRoleValues = ['owner', 'member'] as const;

export function isRepoRole(value: unknown): value is RepoRole {
  return typeof value === 'string' && RepoRoleValues.includes(value as RepoRole);
}
```

### RepoUser

```typescript
/**
 * A user entry in a repository's ACL.
 */
export interface RepoUser {
  /** User's Cognito subject ID (immutable, primary key) */
  userId: string;

  /** User's email address (for display, fetched from Cognito) */
  email: string;

  /** User's display name (optional, from Cognito) */
  name?: string;

  /** User's role on this repository */
  role: RepoRole;

  /** userId of the user who added this entry */
  addedBy: string;

  /** ISO 8601 timestamp when user was added */
  addedAt: string;
}
```

### Request/Response Types

```typescript
/**
 * Request body for adding a user to a repository.
 */
export interface AddUserRequest {
  /** Email of user to add (must have logged in at least once) */
  email: string;

  /** Role to assign */
  role: RepoRole;
}

/**
 * Response from /api/whoami endpoint.
 */
export interface WhoamiResponse {
  /** Cognito subject ID */
  sub: string;

  /** Email address (if available) */
  email?: string;

  /** Display name (if available) */
  name?: string;

  /** Whether user is a server admin */
  isAdmin: boolean;
}

/**
 * Error response for authorization failures.
 */
export interface AuthzError {
  error: 'unauthorized' | 'forbidden' | 'last_owner' | 'user_not_found';
  message: string;
}
```

### Configuration

```typescript
/**
 * Authorization configuration.
 */
export interface AuthzConfig {
  /** Cognito group name for server admins */
  adminGroup: string;  // default: 'e3-clouds'
}

export const DefaultAuthzConfig: AuthzConfig = {
  adminGroup: 'e3-clouds',
};
```

---

## Interfaces (e3-cloud-core)

The `@elaraai/e3-cloud-core` package provides cloud-agnostic interfaces and authorization logic. It depends on `@elaraai/e3-cloud-types` for East type definitions.

### Package Structure

```
packages/e3-cloud-core/
├── package.json
├── tsconfig.json
├── LICENSE.md
├── README.md
└── src/
    ├── index.ts           # Public exports
    ├── interfaces.ts      # AclStore, WhoamiBackend, Identity interfaces
    ├── authz.ts           # hasAccess, canRemoveUser, isLastOwner
    ├── errors.ts          # AdminCoreError hierarchy, errorCodeToStatus
    └── testing/
        └── in-memory.ts   # InMemoryAclStore, MockWhoamiBackend for tests
```

### Exports

Main entry point (`@elaraai/e3-cloud-core`):
- Interfaces: `AclStore`, `Identity`, `WhoamiBackend`
- Authorization: `hasAccess`, `isLastOwner`, `canRemoveUser`, `AuthzResult`
- Errors: `AdminCoreError`, `UserNotFoundError`, `RepoNotFoundError`, `errorCodeToStatus`
- Re-exports from types: `RepoRole`, `RepoUser`, `AddUserRequest`, `WhoamiResponse`, `AuthzErrorCode`, `AuthzError`

Testing entry point (`@elaraai/e3-cloud-core/testing`):
- `InMemoryAclStore` - In-memory implementation for unit tests
- `MockWhoamiBackend` - Configurable identity backend for tests

### AclStore Interface

```typescript
import type { RepoUser, RepoRole } from '@elaraai/e3-cloud-types';

/**
 * Storage interface for repository access control lists.
 *
 * Implementations:
 * - DynamoDbAclStore (e3-aws) - DynamoDB with GSI for user lookups
 * - InMemoryAclStore (testing) - In-memory Map for unit tests
 */
export interface AclStore {
  /** List all users with access to a repository */
  listUsers(repo: string): Promise<RepoUser[]>;

  /** Add a user to a repository's ACL */
  addUser(repo: string, user: RepoUser): Promise<RepoUser>;

  /** Remove a user from a repository's ACL */
  removeUser(repo: string, userId: string): Promise<void>;

  /** Get a user's role on a repository (null if no access) */
  getRole(repo: string, userId: string): Promise<RepoRole | null>;

  /** List all repositories a user has access to */
  listReposForUser(userId: string): Promise<string[]>;

  /** Delete all ACL entries for a repository (used during repo deletion) */
  deleteAllForRepo(repo: string): Promise<void>;
}
```

### Identity and WhoamiBackend Interfaces

```typescript
/**
 * Identity information extracted from authentication.
 */
export interface Identity {
  /** User's unique identifier (Cognito sub, etc.) */
  sub: string;
  /** User's email address (optional) */
  email?: string;
  /** User's display name (optional) */
  name?: string;
  /** Whether user is a server admin */
  isAdmin: boolean;
}

/**
 * Backend for retrieving identity information.
 *
 * Implementations:
 * - CognitoWhoamiBackend (e3-aws) - Extracts from API Gateway authorizer
 * - MockWhoamiBackend (testing) - Returns configured identity
 */
export interface WhoamiBackend {
  /** Get identity from request context */
  getIdentity(requestContext: unknown): Identity | null;
}
```

### Authorization Functions

```typescript
import type { AuthzErrorCode } from '@elaraai/e3-cloud-types';
import { variant } from '@elaraai/east';

/** Result of an authorization check */
export type AuthzResult =
  | { ok: true }
  | { ok: false; code: AuthzErrorCode; message: string };

/**
 * Check if a user has the required access level to a repository.
 * Admins always have access. Owners have access to everything.
 * Members have access if requiredRole is 'member'.
 */
export async function hasAccess(
  store: AclStore,
  repo: string,
  userId: string,
  requiredRole: 'owner' | 'member',
  isAdmin: boolean
): Promise<boolean> {
  // Admins bypass ACL checks
  if (isAdmin) return true;

  const role = await store.getRole(repo, userId);
  if (role === null) return false;

  // Owners have full access
  if (role.type === 'owner') return true;

  // Members only have access if member-level is sufficient
  return requiredRole === 'member';
}

/**
 * Check if a user is the only owner of a repository.
 */
export async function isLastOwner(
  store: AclStore,
  repo: string,
  userId: string
): Promise<boolean> {
  const users = await store.listUsers(repo);
  const owners = users.filter(u => u.role.type === 'owner');
  return owners.length === 1 && owners[0].userId === userId;
}

/**
 * Check if an actor can remove a user from a repository.
 * Returns AuthzResult with ok:true or specific error code.
 */
export async function canRemoveUser(
  store: AclStore,
  repo: string,
  actorId: string,
  targetId: string,
  isAdmin: boolean
): Promise<AuthzResult> {
  // Check actor has owner permission
  if (!await hasAccess(store, repo, actorId, 'owner', isAdmin)) {
    return {
      ok: false,
      code: variant('forbidden', null),
      message: 'Only repository owners can remove users',
    };
  }

  // Prevent removing the last owner
  if (await isLastOwner(store, repo, targetId)) {
    return {
      ok: false,
      code: variant('last_owner', null),
      message: 'Cannot remove the last owner of a repository',
    };
  }

  return { ok: true };
}
```

### Error Classes

```typescript
import type { AuthzErrorCode } from '@elaraai/e3-cloud-types';

export class AdminCoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UserNotFoundError extends AdminCoreError {
  constructor(public readonly email: string) {
    super(`User not found: ${email}`);
  }
}

export class RepoNotFoundError extends AdminCoreError {
  constructor(public readonly repo: string) {
    super(`Repository not found: ${repo}`);
  }
}

/** Map AuthzErrorCode to HTTP status code */
export function errorCodeToStatus(code: AuthzErrorCode): number {
  switch (code.type) {
    case 'unauthorized': return 401;
    case 'forbidden': return 403;
    case 'last_owner': return 400;
    case 'user_not_found': return 404;
  }
}
```

### Testing Utilities

```typescript
// Import from '@elaraai/e3-cloud-core/testing'
import { InMemoryAclStore, MockWhoamiBackend } from '@elaraai/e3-cloud-core/testing';
import { variant } from '@elaraai/east';

// In-memory store for unit tests
const store = new InMemoryAclStore();

await store.addUser('repo', {
  userId: 'user-1',
  email: 'alice@example.com',
  name: { value: 'Alice' },
  role: variant('owner', null),
  addedBy: 'system',
  addedAt: new Date().toISOString(),
});

// Mock identity backend
const whoami = new MockWhoamiBackend();
whoami.setIdentity({ sub: 'user-1', email: 'alice@example.com', isAdmin: false });
```

---

## DynamoDB Schema

### Table Structure

ACL data uses the existing e3-aws single-table design, adding new partition key patterns:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ACL Entries                                                                  │
├────────────────┬──────────────┬──────────────────────────────────────────────┤
│ PK             │ SK           │ Attributes                                   │
├────────────────┼──────────────┼──────────────────────────────────────────────┤
│ ACL#{repo}     │ USER#{userId}│ email, name?, role, addedBy, addedAt         │
├────────────────┴──────────────┴──────────────────────────────────────────────┤
│                                                                              │
│ GSI1 (for listReposForUser query)                                            │
├────────────────┬──────────────┬──────────────────────────────────────────────┤
│ GSI1PK         │ GSI1SK       │ (projected: all)                             │
├────────────────┼──────────────┼──────────────────────────────────────────────┤
│ USERACL#{userId}│ REPO#{repo}  │ role                                         │
└────────────────┴──────────────┴──────────────────────────────────────────────┘
```

### Key Patterns

| Operation | PK | SK | Index |
|-----------|----|----|-------|
| List users for repo | `ACL#{repo}` | begins_with `USER#` | Main |
| Get user role | `ACL#{repo}` | `USER#{userId}` | Main |
| Add user | `ACL#{repo}` | `USER#{userId}` | Main + GSI1 |
| Remove user | `ACL#{repo}` | `USER#{userId}` | Main + GSI1 |
| List repos for user | `USERACL#{userId}` | begins_with `REPO#` | GSI1 |
| Delete all for repo | `ACL#{repo}` | begins_with `USER#` | Main + GSI1 (batch) |

### Item Structure

```typescript
interface AclItem {
  PK: `ACL#${string}`;           // ACL#{repo}
  SK: `USER#${string}`;          // USER#{userId}
  GSI1PK: `USERACL#${string}`;   // USERACL#{userId}
  GSI1SK: `REPO#${string}`;      // REPO#{repo}
  email: string;
  name?: string;
  role: RepoRole;
  addedBy: string;
  addedAt: string;
}
```

### Example Items

```json
{
  "PK": "ACL#my-repo",
  "SK": "USER#abc123-def456",
  "GSI1PK": "USERACL#abc123-def456",
  "GSI1SK": "REPO#my-repo",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "role": "owner",
  "addedBy": "abc123-def456",
  "addedAt": "2025-01-29T10:00:00Z"
}
```

---

## DynamoAclStore Implementation

Located in `packages/e3-aws-storage/src/acl-store.ts`:

```typescript
import { DynamoDBDocumentClient, QueryCommand, PutCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { AclStore, RepoUser, RepoRole } from '@elaraai/e3-cloud-core';

export class DynamoAclStore implements AclStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string
  ) {}

  async listUsers(repo: string): Promise<RepoUser[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `ACL#${repo}`,
        ':skPrefix': 'USER#',
      },
    }));

    return (result.Items ?? []).map(item => ({
      userId: item.SK.replace('USER#', ''),
      email: item.email,
      name: item.name,
      role: item.role as RepoRole,
      addedBy: item.addedBy,
      addedAt: item.addedAt,
    }));
  }

  async addUser(repo: string, user: RepoUser): Promise<RepoUser> {
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: `ACL#${repo}`,
        SK: `USER#${user.userId}`,
        GSI1PK: `USERACL#${user.userId}`,
        GSI1SK: `REPO#${repo}`,
        email: user.email,
        ...(user.name && { name: user.name }),
        role: user.role,
        addedBy: user.addedBy,
        addedAt: user.addedAt,
      },
    }));
    return user;
  }

  async removeUser(repo: string, userId: string): Promise<void> {
    await this.client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: {
        PK: `ACL#${repo}`,
        SK: `USER#${userId}`,
      },
    }));
  }

  async getRole(repo: string, userId: string): Promise<RepoRole | null> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `ACL#${repo}`,
        ':sk': `USER#${userId}`,
      },
    }));

    if (!result.Items?.length) return null;
    return result.Items[0].role as RepoRole;
  }

  async listReposForUser(userId: string): Promise<string[]> {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `USERACL#${userId}`,
        ':skPrefix': 'REPO#',
      },
    }));

    return (result.Items ?? []).map(item => item.GSI1SK.replace('REPO#', ''));
  }

  async deleteAllForRepo(repo: string): Promise<void> {
    // Query all ACL items for this repo
    const items = await this.listUsers(repo);

    if (items.length === 0) return;

    // Batch delete (max 25 items per batch)
    const batches = [];
    for (let i = 0; i < items.length; i += 25) {
      batches.push(items.slice(i, i + 25));
    }

    for (const batch of batches) {
      await this.client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: batch.map(user => ({
            DeleteRequest: {
              Key: {
                PK: `ACL#${repo}`,
                SK: `USER#${user.userId}`,
              },
            },
          })),
        },
      }));
    }
  }
}
```

---

## API Endpoints

### Repo User Management

| Method | Path | Description | Required Role |
|--------|------|-------------|---------------|
| GET | `/repos/:repo/users` | List repo users | member |
| POST | `/repos/:repo/users` | Add user | owner |
| DELETE | `/repos/:repo/users/:userId` | Remove user | owner |

### User Info

| Method | Path | Description | Required Role |
|--------|------|-------------|---------------|
| GET | `/api/whoami` | Get current user info | authenticated |

### Admin Endpoints

Server admins (Cognito `e3-clouds` group) have additional capabilities:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/repos` | List all repos (bypasses ACL) |
| GET | `/admin/repos/:repo/users` | View any repo's users |
| POST | `/admin/repos/:repo/users` | Add user to any repo |
| DELETE | `/admin/repos/:repo` | Force-delete any repo |

### Endpoint Implementations

**GET /repos/:repo/users**

```typescript
async function handleListUsers(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const repo = event.pathParameters?.repo;
  const { sub, isAdmin } = extractIdentity(event);

  // Check access (member level required)
  if (!await hasAccess(aclStore, repo, sub, 'member', isAdmin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'forbidden' }) };
  }

  const users = await aclStore.listUsers(repo);
  return { statusCode: 200, body: JSON.stringify(users) };
}
```

**POST /repos/:repo/users**

```typescript
async function handleAddUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const repo = event.pathParameters?.repo;
  const { sub, isAdmin } = extractIdentity(event);
  const body: AddUserRequest = JSON.parse(event.body ?? '{}');

  // Check access (owner level required)
  if (!await hasAccess(aclStore, repo, sub, 'owner', isAdmin)) {
    return { statusCode: 403, body: JSON.stringify({ error: 'forbidden' }) };
  }

  // Look up user by email in Cognito
  const targetUser = await lookupUserByEmail(body.email);
  if (!targetUser) {
    return { statusCode: 404, body: JSON.stringify({
      error: 'user_not_found',
      message: 'User must log in at least once before being added'
    }) };
  }

  const repoUser: RepoUser = {
    userId: targetUser.sub,
    email: targetUser.email,
    name: targetUser.name,
    role: body.role,
    addedBy: sub,
    addedAt: new Date().toISOString(),
  };

  await aclStore.addUser(repo, repoUser);
  return { statusCode: 200, body: JSON.stringify(repoUser) };
}
```

**DELETE /repos/:repo/users/:userId**

```typescript
async function handleRemoveUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const repo = event.pathParameters?.repo;
  const targetId = event.pathParameters?.userId;
  const { sub, isAdmin } = extractIdentity(event);

  // Check permission (includes last-owner check)
  const result = await canRemoveUser(aclStore, repo, sub, targetId, isAdmin);
  if (!result.ok) {
    const status = result.error.error === 'last_owner' ? 400 : 403;
    return { statusCode: status, body: JSON.stringify(result.error) };
  }

  await aclStore.removeUser(repo, targetId);
  return { statusCode: 200, body: 'null' };
}
```

---

## Authorization Middleware

Lambda handlers integrate authorization checks:

```typescript
import { APIGatewayProxyEvent } from 'aws-lambda';

interface Identity {
  sub: string;
  email?: string;
  groups: string[];
  isAdmin: boolean;
}

/**
 * Extract identity from JWT claims (set by API Gateway authorizer).
 */
export function extractIdentity(event: APIGatewayProxyEvent, config: AuthzConfig = DefaultAuthzConfig): Identity {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};

  // Parse groups from cognito:groups claim
  let groups: string[] = [];
  const groupsClaim = claims['cognito:groups'];
  if (typeof groupsClaim === 'string') {
    groups = groupsClaim.split(',').map(g => g.trim());
  } else if (Array.isArray(groupsClaim)) {
    groups = groupsClaim;
  }

  return {
    sub: claims.sub as string,
    email: claims.email as string | undefined,
    groups,
    isAdmin: groups.includes(config.adminGroup),
  };
}

/**
 * Create middleware that checks repo access before handler execution.
 */
export function withRepoAuth(
  requiredRole: RepoRole,
  handler: (event: APIGatewayProxyEvent, identity: Identity) => Promise<APIGatewayProxyResult>
) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const identity = extractIdentity(event);
    const repo = event.pathParameters?.repo;

    if (!repo) {
      return { statusCode: 400, body: JSON.stringify({ error: 'missing_repo' }) };
    }

    if (!await hasAccess(aclStore, repo, identity.sub, requiredRole, identity.isAdmin)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'forbidden' }) };
    }

    return handler(event, identity);
  };
}
```

---

## Cognito Integration

### Admin Detection

Admins are detected by Cognito group membership:

```typescript
function isAdmin(event: APIGatewayProxyEvent, adminGroup: string = 'e3-clouds'): boolean {
  const groups = event.requestContext.authorizer?.jwt?.claims?.['cognito:groups'] ?? [];
  return Array.isArray(groups) ? groups.includes(adminGroup) : groups === adminGroup;
}
```

**Setup in Cognito:**
1. Create group `e3-clouds` in Cognito User Pool
2. Add admin users to this group
3. Access tokens automatically include `cognito:groups` claim

### User Profile Lookup

When adding users by email, look up their `sub` from Cognito:

```typescript
import { CognitoIdentityProviderClient, AdminGetUserCommand, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

interface CognitoUser {
  sub: string;
  email: string;
  name?: string;
}

/**
 * Look up a user by email in Cognito.
 * Returns null if user not found or has never logged in.
 */
async function lookupUserByEmail(email: string): Promise<CognitoUser | null> {
  const client = new CognitoIdentityProviderClient({});

  // Use ListUsers with email filter
  const result = await client.send(new ListUsersCommand({
    UserPoolId: process.env.USER_POOL_ID,
    Filter: `email = "${email}"`,
    Limit: 1,
  }));

  const user = result.Users?.[0];
  if (!user) return null;

  const attrs = Object.fromEntries(
    user.Attributes?.map(a => [a.Name, a.Value]) ?? []
  );

  return {
    sub: attrs.sub,
    email: attrs.email,
    name: attrs.name,
  };
}
```

### Profile Denormalization

User email/name are stored in ACL entries at add time:
- Avoids Cognito lookup on every list operation
- Profile updates propagate on next add/update (acceptable staleness)

---

## Permission Matrix

| Endpoint | Anonymous | Authenticated | Member | Owner | Admin |
|----------|-----------|---------------|--------|-------|-------|
| GET /repos | - | own repos | - | - | all |
| POST /repos | - | create | - | - | create |
| DELETE /repos/:repo | - | - | - | delete | delete |
| GET /repos/:repo/... | - | - | read | read | read |
| POST /repos/:repo/... | - | - | write | write | write |
| GET /repos/:repo/users | - | - | list | list | list |
| POST /repos/:repo/users | - | - | - | add | add |
| DELETE /repos/:repo/users/:id | - | - | - | remove | remove |
| GET /api/whoami | - | info | - | - | - |
| GET /admin/repos | - | - | - | - | list all |

---

## Repo Create Auto-Add

When a repository is created, the creator is automatically added as owner:

```typescript
async function handleCreateRepo(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const repo = event.pathParameters?.repo;
  const identity = extractIdentity(event);

  // Create the repository...
  await storage.createRepo(repo);

  // Auto-add creator as owner
  await aclStore.addUser(repo, {
    userId: identity.sub,
    email: identity.email ?? 'unknown',
    role: 'owner',
    addedBy: identity.sub,
    addedAt: new Date().toISOString(),
  });

  return { statusCode: 201, body: JSON.stringify({ name: repo }) };
}
```

---

## Repo Delete Cleanup

When a repository is deleted, all ACL entries must be cleaned up. This is integrated into the existing delete-repo state machine:

```typescript
// In delete-repo Lambda handler
async function cleanupAcl(repo: string): Promise<void> {
  await aclStore.deleteAllForRepo(repo);
}
```

**State Machine Update:**

```
DeleteRepo State Machine
────────────────────────
START → CleanupACL → DeleteObjects → DeleteRefs → DeleteRepoItem → END
             │
             └── Calls aclStore.deleteAllForRepo(repo)
```

---

## Client Library (e3-cloud-client)

HTTP client for ACL operations, following e3-api-client patterns:

```typescript
import type { RepoUser, AddUserRequest, WhoamiResponse } from '@elaraai/e3-cloud-types';
import { variant } from '@elaraai/east';

/**
 * Request options for API calls.
 */
export interface RequestOptions {
  /** Bearer token for authentication */
  token: string | null;
}

/**
 * API response wrapper - success or typed error.
 */
export type Response<T> =
  | { type: 'success'; value: T }
  | { type: 'error'; value: AdminError };

/**
 * Typed admin API error.
 */
export class AdminError extends Error {
  constructor(
    public readonly code: AuthzErrorCode,
    public readonly details: string
  ) {
    super(`Admin error: ${code.type} - ${details}`);
  }
}

/**
 * Unwrap a response, throwing on error.
 */
export function unwrap<T>(response: Response<T>): T {
  if (response.type === 'error') throw response.value;
  return response.value;
}

/**
 * Get current user info.
 */
export async function whoami(
  url: string,
  options: RequestOptions
): Promise<Response<WhoamiResponse>>;

/**
 * List users with access to a repository.
 */
export async function repoUsers(
  url: string,
  repo: string,
  options: RequestOptions
): Promise<Response<RepoUser[]>>;

/**
 * Add a user to a repository.
 */
export async function addUser(
  url: string,
  repo: string,
  request: AddUserRequest,
  options: RequestOptions
): Promise<Response<RepoUser>>;

/**
 * Remove a user from a repository.
 */
export async function removeUser(
  url: string,
  repo: string,
  userId: string,
  options: RequestOptions
): Promise<Response<null>>;
```

**Usage:**

```typescript
import { whoami, repoUsers, addUser, unwrap } from '@elaraai/e3-cloud-client';
import { variant } from '@elaraai/east';

const options = { token: accessToken };

// Get current user
const me = unwrap(await whoami('https://e3.example.com', options));

// Add a user with member role
const user = unwrap(await addUser(
  'https://e3.example.com',
  'my-repo',
  { email: 'bob@example.com', role: variant('member', null) },
  options
));
```

---

## CLI Commands (e3-cloud-cli)

The commands follow the structure of the `e3` CLI using noun-verb patterns and the same repo location format.

```
e3-cloud whoami [server]
  Show current user identity and admin status.
  Uses stored credentials if server omitted.

e3-cloud user list <server>/repos/<repo>
  List users with access to a repository.

e3-cloud user add <server>/repos/<repo> <email> [--role owner|member]
  Add a user to a repository. Default role is 'member'.

e3-cloud user remove <server>/repos/<repo> <email>
  Remove a user from a repository.
```

Note that the `e3-cloud` CLI will consume tokens generated by the `e3` CLI when logging in, stored at `~/.e3/credentials.json` (and refresh the access token as necessary).

**Example Usage:**

```bash
# Check current identity (uses stored credentials)
$ e3-cloud whoami
sub: abc123-def456
email: alice@example.com
name: Alice Smith
admin: true

# Or specify server explicitly
$ e3-cloud whoami https://e3.example.com

# List users on a repo
$ e3-cloud user list https://e3.example.com/repos/my-repo
USER ID          EMAIL                  ROLE    ADDED
abc123-def456    alice@example.com      owner   2025-01-29T10:00:00Z
xyz789-uvw012    bob@example.com        member  2025-01-30T14:30:00Z

# Add a user
$ e3-cloud user add https://e3.example.com/repos/my-repo charlie@example.com --role member
Added charlie@example.com as member

# Remove a user
$ e3-cloud user remove https://e3.example.com/repos/my-repo charlie@example.com
Removed charlie@example.com
```

---

## Implementation Plan

### Phase 1: Types and Core (Week 1)

**Tasks:**
- [ ] Create `packages/e3-cloud-types/` package structure
- [ ] Implement `RepoRole`, `RepoUser`, `AddUserRequest`, `WhoamiResponse` types
- [ ] Create `packages/e3-cloud-core/` package structure
- [ ] Implement `AclStore` interface
- [ ] Implement `hasAccess()`, `canRemoveUser()`, `isLastOwner()` functions
- [ ] Unit tests for authorization logic

**Deliverables:**
- `@elaraai/e3-cloud-types` package
- `@elaraai/e3-cloud-core` package
- Unit test coverage for authz functions

### Phase 2: DynamoDB and API (Week 2)

**Tasks:**
- [ ] Implement `DynamoAclStore` in `packages/e3-aws-storage/src/acl-store.ts`
- [ ] Add ACL key patterns to DynamoDB table (no migration needed, new patterns)
- [ ] Implement `extractIdentity()` middleware
- [ ] Add `GET /repos/:repo/users` endpoint
- [ ] Add `POST /repos/:repo/users` endpoint (with Cognito lookup)
- [ ] Add `DELETE /repos/:repo/users/:userId` endpoint
- [ ] Add `GET /api/whoami` endpoint
- [ ] Update `POST /repos` to auto-add creator as owner
- [ ] Update delete-repo state machine to cleanup ACL

**Deliverables:**
- DynamoAclStore implementation
- User management API endpoints
- ACL cleanup in repo lifecycle

### Phase 3: Client and CLI (Week 3)

**Tasks:**
- [ ] Create `packages/e3-cloud-client/` package structure
- [ ] Implement `whoami()`, `repoUsers()`, `addUser()`, `removeUser()` functions
- [ ] Create `packages/e3-cloud-cli/` package structure
- [ ] Implement CLI commands (`whoami`, `user list`, `user add`, `user remove`)
- [ ] Integration tests for client library
- [ ] E2E tests for CLI commands

**Deliverables:**
- `@elaraai/e3-cloud-client` package
- `@elaraai/e3-cloud-cli` package
- Integration test coverage

### Phase 4: Integration (Week 4)

**Tasks:**
- [ ] Add authorization middleware to all repo endpoints
- [ ] Update `GET /repos` to filter by user access (using GSI1)
- [ ] Add admin endpoints (`GET /admin/repos`, etc.)
- [ ] CDK updates for any new Lambda permissions
- [ ] End-to-end testing with real Cognito users

**Deliverables:**
- Full authorization enforcement
- Admin capabilities
- Production-ready deployment

---

## Testing

### Unit Tests (e3-cloud-core)

```typescript
describe('hasAccess', () => {
  it('returns true for admins regardless of ACL', async () => {
    const store = new MockAclStore([]);
    expect(await hasAccess(store, 'repo', 'user', 'owner', true)).toBe(true);
  });

  it('returns true for owners when owner role required', async () => {
    const store = new MockAclStore([{ userId: 'user', role: 'owner' }]);
    expect(await hasAccess(store, 'repo', 'user', 'owner', false)).toBe(true);
  });

  it('returns false for members when owner role required', async () => {
    const store = new MockAclStore([{ userId: 'user', role: 'member' }]);
    expect(await hasAccess(store, 'repo', 'user', 'owner', false)).toBe(false);
  });

  it('returns true for members when member role required', async () => {
    const store = new MockAclStore([{ userId: 'user', role: 'member' }]);
    expect(await hasAccess(store, 'repo', 'user', 'member', false)).toBe(true);
  });

  it('returns false for users with no access', async () => {
    const store = new MockAclStore([]);
    expect(await hasAccess(store, 'repo', 'user', 'member', false)).toBe(false);
  });
});

describe('canRemoveUser', () => {
  it('allows owner to remove member', async () => {
    const store = new MockAclStore([
      { userId: 'owner', role: 'owner' },
      { userId: 'member', role: 'member' },
    ]);
    const result = await canRemoveUser(store, 'repo', 'owner', 'member', false);
    expect(result.ok).toBe(true);
  });

  it('prevents removing last owner', async () => {
    const store = new MockAclStore([{ userId: 'owner', role: 'owner' }]);
    const result = await canRemoveUser(store, 'repo', 'owner', 'owner', false);
    expect(result.ok).toBe(false);
    expect((result as any).error.error).toBe('last_owner');
  });

  it('allows removing one owner when multiple exist', async () => {
    const store = new MockAclStore([
      { userId: 'owner1', role: 'owner' },
      { userId: 'owner2', role: 'owner' },
    ]);
    const result = await canRemoveUser(store, 'repo', 'owner1', 'owner2', false);
    expect(result.ok).toBe(true);
  });
});
```

### Integration Tests (e3-aws)

```typescript
describe('Authorization API', () => {
  it('returns 401 for unauthenticated requests', async () => {
    const response = await fetch(`${baseUrl}/repos/test-repo/users`);
    expect(response.status).toBe(401);
  });

  it('returns 403 for authenticated user without access', async () => {
    const response = await fetch(`${baseUrl}/repos/other-repo/users`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(response.status).toBe(403);
  });

  it('allows member to list users', async () => {
    // Add user as member first
    await addUserToRepo('test-repo', userId, 'member');

    const response = await fetch(`${baseUrl}/repos/test-repo/users`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(response.status).toBe(200);
  });

  it('allows owner to add users', async () => {
    const response = await fetch(`${baseUrl}/repos/test-repo/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'newuser@example.com', role: 'member' }),
    });
    expect(response.status).toBe(200);
  });

  it('prevents member from adding users', async () => {
    const response = await fetch(`${baseUrl}/repos/test-repo/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${memberToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'other@example.com', role: 'member' }),
    });
    expect(response.status).toBe(403);
  });

  it('allows admin to access any repo', async () => {
    const response = await fetch(`${baseUrl}/repos/any-repo/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(response.status).toBe(200);
  });

  it('prevents removing last owner', async () => {
    const response = await fetch(`${baseUrl}/repos/test-repo/users/${onlyOwnerId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('last_owner');
  });
});
```

### E2E Tests (e3-cloud-cli)

```bash
#!/bin/bash
# e2e-authz.sh

set -e

SERVER="https://e3-test.example.com"
REPO="e2e-test-repo-$(date +%s)"

# Test whoami
e3-cloud whoami "$SERVER"

# Create repo (should auto-add as owner)
e3 repo create "$SERVER/repos/$REPO"

# List users (should see self as owner)
e3-cloud user list "$SERVER/repos/$REPO" | grep -q "owner"

# Add a member
e3-cloud user add "$SERVER/repos/$REPO" "testuser@example.com" --role member

# Verify member added
e3-cloud user list "$SERVER/repos/$REPO" | grep -q "testuser@example.com"

# Remove member
e3-cloud user remove "$SERVER/repos/$REPO" "testuser@example.com"

# Verify member removed
! e3-cloud user list "$SERVER/repos/$REPO" | grep -q "testuser@example.com"

# Cleanup
e3 repo remove "$SERVER/repos/$REPO"

echo "E2E tests passed!"
```

---

## Security Considerations

1. **Use `sub` as key, not email**
   - Emails can change in Cognito
   - `sub` is immutable and IdP-assigned
   - Email stored for display only

2. **Last owner protection**
   - Cannot remove user if they are the only owner
   - Enforced at API level before deletion
   - Transfer ownership first, then remove

3. **ACL cleanup on repo delete**
   - Batch delete all ACL items when repo is deleted
   - Integrated into delete-repo state machine
   - Prevents orphaned ACL entries

4. **Short access token expiry**
   - Cognito access tokens expire in 15 minutes (configurable)
   - Limits exposure window for compromised tokens
   - Refresh tokens for long sessions

5. **Admin audit trail (future)**
   - Admin actions should be logged for audit
   - Consider CloudWatch Logs with structured events
   - Deferred to enterprise feature

6. **Input validation**
   - Validate email format before Cognito lookup
   - Validate role is 'owner' or 'member'
   - Sanitize repo names (already done)

---

## Open Questions

### 1. User Discovery

**Question:** Require users to have logged in before adding, or support pending invites?

**Recommendation:** Require login first (simpler).
- Users must log in once to be discoverable
- Avoids complexity of pending invite system
- Clear error message when user not found

**Alternative (future):** Pending invites
- Store invite by email in DynamoDB
- Resolve to `sub` on first login
- More complex, requires invite cleanup

### 2. Role Granularity

**Question:** Add `viewer` role for read-only access?

**Recommendation:** Defer; start with owner/member.
- Member already covers read access
- Adding viewer later is backward-compatible
- Simpler permission matrix for MVP

### 3. Group-Based Access

**Question:** Support adding Cognito groups to repos (team access)?

**Recommendation:** Defer to future.
- Individual users sufficient for MVP
- Group expansion adds complexity
- Can be added without breaking changes

---

## Appendix: CDK Changes

### Lambda IAM Permissions

Add DynamoDB permissions for ACL operations:

```typescript
// In Lambda construct
const aclPolicy = new iam.PolicyStatement({
  actions: [
    'dynamodb:Query',
    'dynamodb:PutItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
  ],
  resources: [
    table.tableArn,
    `${table.tableArn}/index/GSI1`,
  ],
  conditions: {
    'ForAllValues:StringLike': {
      'dynamodb:LeadingKeys': ['ACL#*', 'USERACL#*'],
    },
  },
});
```

### Cognito User Lookup

Add Cognito permissions for user lookup:

```typescript
const cognitoPolicy = new iam.PolicyStatement({
  actions: ['cognito-idp:ListUsers'],
  resources: [userPool.userPoolArn],
});
```
