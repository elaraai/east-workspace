# @elaraai/e3-aws-storage

S3 + DynamoDB StorageBackend implementation for e3 cloud deployments.

## Overview

This package provides the cloud storage backend for e3, implementing the `StorageBackend` interface from `@elaraai/e3-core`:

- **Objects**: S3 (content-addressed blobs)
- **Refs**: DynamoDB (packages, workspaces, execution cache)
- **Locks**: DynamoDB (with TTL for automatic cleanup)
- **Logs**: DynamoDB (chunked for real-time streaming)
- **Repos**: DynamoDB + S3 (repository lifecycle and GC)
- **Executions**: DynamoDB + S3 (`ExecutionStateStore` with BEAST2-encoded state)

## DynamoDB Single-Table Schema

All data is stored in a single DynamoDB table using composite keys (`PK`, `SK`).

```
Table: e3-{deploymentId}-data
Primary Key: PK (String), SK (String)
```

### Repository Metadata

Stores lifecycle state for each repository.

```
PK: REPO
SK: {repo}
Attributes:
  - name: string           # Repository name
  - status: string         # 'creating' | 'active' | 'gc' | 'deleting'
  - createdAt: string      # ISO timestamp
  - statusChangedAt: string # ISO timestamp
  - executionArn?: string  # Step Function ARN (during GC/delete)
```

### Packages

Package references mapping name+version to content hash.

```
PK: PKG/{repo}
SK: {name}/{version}
Attributes:
  - hash: string           # SHA256 hash of package content
  - createdAt: string      # ISO timestamp
```

### Workspaces

Workspace state stored as BEAST2-encoded binary.

```
PK: WS/{repo}
SK: {name}
Attributes:
  - state: Binary          # BEAST2-encoded workspace state
  - updatedAt: string      # ISO timestamp
```

### Execution Cache

Task execution results keyed by task hash + inputs hash. Each task hash gets its own partition for write distribution.

```
PK: CACHE/{repo}/{taskHash}
SK: {inputsHash}
Attributes:
  - status: Binary         # BEAST2-encoded ExecutionStatus
  - outputHash?: string    # SHA256 hash of output (if success)
  - updatedAt: string      # ISO timestamp
  - completedAt?: string   # ISO timestamp
```

### Execution State (ExecutionStateStore interface)

Full execution state using BEAST2 encoding. Stores the complete `DataflowExecutionState` from `@elaraai/e3-types`, implementing the `ExecutionStateStore` interface from `@elaraai/e3-core`.

This is the primary schema for dataflow execution state. The state includes:
- Execution identity (id, repo, workspace)
- Configuration (concurrency, force, filter)
- Task states (Map of task name to TaskState)
- Counters (executed, cached, failed, skipped)
- Events (inline array of ExecutionEvent variants)
- Graph (inline or externalized via graphHash)

```
PK: STATE/{repo}/{workspace}
SK: {executionId} (zero-padded 10 digits) | "_counter" (for ID generation)

Counter record (SK: "_counter"):
  - nextId: number         # Next execution ID to allocate

State record:
  - state: Binary          # BEAST2-encoded DataflowExecutionState
  - version: number        # Optimistic concurrency version
  - updatedAt: string      # ISO timestamp
```

**Graph Externalization:** For graphs exceeding 350KB, the graph is stored separately in S3 and referenced via the `graphHash` field within the BEAST2-encoded state. The graph is automatically loaded when reading state.

### Externalized Graphs (S3)

Large graphs are stored separately in S3 to avoid DynamoDB's 400KB limit.

```
Key: graphs/{repo}/{graphHash}.beast2
Content: BEAST2-encoded DataflowGraph
```

### Object Catalogue

Tracks current S3 version and metadata for content-addressed objects. Small objects (≤4KB) are stored inline to avoid S3 overhead.

```
PK: OBJ/{repo}
SK: {hash}
Attributes:
  - currentVersion?: string    # S3 version ID (null for inline objects)
  - lastReferencedAt: string   # ISO timestamp of last write
  - size: number               # Object size in bytes
  - inline?: Binary            # Object data (only for size ≤ 4KB)
```

**Invariants:**
1. Catalogue entry exists → Object is readable via `currentVersion` or `inline`
2. S3 version matches `currentVersion` → Never deleted by GC cleanup
3. S3 version age < 24h → Never deleted by GC cleanup (MIN_AGE protection)

### Access Control Lists (ACL)

Repository-level access control. Uses GSI1 for efficient user-to-repos lookups.

```
PK: ACL#{repo}
SK: USER#{userId}
GSI1PK: USERACL#{userId}
GSI1SK: REPO#{repo}
Attributes:
  - userId: string        # User's Cognito subject ID
  - email: string         # User's email address
  - name?: string         # User's display name (optional)
  - role: string          # 'owner' | 'member'
  - addedBy: string       # userId who added this user
  - addedAt: string       # ISO timestamp
```

### Locks

Distributed locks with automatic expiry.

```
PK: LOCK/{repo}
SK: {resource}
Attributes:
  - holder: string         # East-encoded holder info (.lambda (...))
  - operation: string      # Lock operation type
  - acquiredAt: string     # ISO timestamp
  - expiresAt: string      # ISO timestamp
  - ttl: number            # DynamoDB TTL (seconds since epoch)
```

### Log Chunks

Streaming log chunks for near real-time access. Each task execution gets its own partition for write distribution.

```
PK: LOG/{repo}/{taskHash}/{inputsHash}
SK: {stream}/{chunk}
Attributes:
  - data: string           # Log chunk content
  - timestamp: number      # Milliseconds since epoch
  - ttl: number            # DynamoDB TTL (7 days)

Where:
  - stream: 'stdout' | 'stderr'
  - chunk: 6-digit zero-padded contiguous index (000000, 000001, ...)
```

## S3 Object Layout

Content-addressed objects stored in S3 with versioning enabled for concurrent-safe GC:

```
s3://{bucket}/
  {repo}/objects/{hash}    # SHA256-addressed blobs (versioned)
  gc-temp/{gcId}/          # Temporary files during GC (reachable set)
```

**Note:** S3 versioning is enabled to support concurrent-safe garbage collection. The GC cleanup phase handles version deletion based on the object catalogue - do NOT configure S3 lifecycle rules for noncurrent version expiration.

## Access Patterns

| Operation | Key Pattern | Query Type |
|-----------|-------------|------------|
| List repos | PK = REPO | Query |
| Get repo metadata | PK = REPO, SK = {repo} | GetItem |
| List packages | PK = PKG/{repo} | Query |
| Get package | PK = PKG/{repo}, SK = {name}/{version} | GetItem |
| List workspaces | PK = WS/{repo} | Query |
| Get workspace | PK = WS/{repo}, SK = {name} | GetItem |
| Get execution cache | PK = CACHE/{repo}/{taskHash}, SK = {inputsHash} | GetItem |
| List cache entries (repo) | PK begins_with CACHE/{repo}/ | Scan (filter) |
| List cache entries (task) | PK = CACHE/{repo}/{taskHash} | Query |
| Get execution state | PK = STATE/{repo}/{workspace}, SK = {execId} | GetItem |
| Get latest execution state | PK = STATE/{repo}/{workspace} | Query (desc) |
| Generate execution ID | PK = STATE/{repo}/{workspace}, SK = "_counter" | UpdateItem (atomic) |
| Get lock | PK = LOCK/{repo}, SK = {resource} | GetItem |
| Read logs | PK = LOG/{repo}/{taskHash}/{inputsHash}, SK begins_with {stream}/ | Query |
| Get object catalogue entry | PK = OBJ/{repo}, SK = {hash} | GetItem |
| List objects (catalogue) | PK = OBJ/{repo} | Query |
| Delete repo | PKG/{repo}, WS/{repo}, LOCK/{repo}, REPO#{repo}, OBJ/{repo}, STATE/{repo}/ (Query) + CACHE/{repo}/, LOG/{repo}/ (Scan) | Query + Scan + BatchDelete |
| List repo ACL | PK = ACL#{repo} | Query |
| Get user role | PK = ACL#{repo}, SK = USER#{userId} | GetItem |
| Add/update ACL entry | PK = ACL#{repo}, SK = USER#{userId} | PutItem |
| Remove ACL entry | PK = ACL#{repo}, SK = USER#{userId} | DeleteItem |
| List repos for user | GSI1PK = USERACL#{userId} | Query (GSI1) |
| Delete repo ACL | PK = ACL#{repo} | Query + BatchDelete |

## Files

```
packages/e3-aws-storage/src/
├── s3-dynamo-storage.ts      # Main StorageBackend implementation
├── s3-object-store.ts        # S3-backed ObjectStore
├── dynamo-ref-store.ts       # DynamoDB-backed RefStore + repo management
├── dynamo-s3-repo-store.ts   # DynamoDB + S3-backed RepoStore (lifecycle & GC)
├── dynamo-lock-service.ts    # DynamoDB-backed LockService
├── dynamo-log-store.ts       # DynamoDB-backed LogStore
├── dynamo-state-store.ts     # DynamoDB + S3-backed ExecutionStateStore
├── dynamo-acl-store.ts       # DynamoDB-backed AclStore (repository access control)
└── index.ts                  # Exports
```

## RepoStore Interface

The `DynamoS3RepoStore` class implements the `RepoStore` interface from `@elaraai/e3-core`, providing repository lifecycle management:

### Methods

| Method | Description |
|--------|-------------|
| `list()` | List all repository names (excludes non-active repos) |
| `exists(repo)` | Check if a repository exists |
| `getMetadata(repo)` | Get repository status and timestamps |
| `create(repo)` | Create a new repository (atomic) |
| `setStatus(repo, status, expected?)` | Atomic status transition with optional CAS |
| `remove(repo)` | Remove repository metadata (final cleanup step) |
| `deleteRefsBatch(repo, cursor?)` | Delete DynamoDB refs in batches |
| `deleteObjectsBatch(repo, cursor?)` | Delete S3 objects in batches |
| `gcMark(repo)` | GC mark phase - collect roots and trace reachable objects |
| `gcSweep(repo, ref, opts?)` | GC sweep phase - delete unreachable objects in batches |
| `gcCleanup(repo, ref)` | GC cleanup - delete orphaned S3 versions and temp files |

### AWS-Specific Extensions

For Lambda handlers that need to track Step Functions executions:

| Method | Description |
|--------|-------------|
| `setStatusWithExecutionArn(repo, status, expected, arn?)` | Set status with execution ARN |
| `getCloudMetadata(repo)` | Get metadata including execution ARN |

### Error Types

The interface uses standard e3-core error types:

- `RepoAlreadyExistsError` - Thrown when creating a repo that already exists
- `RepoNotFoundError` - Thrown when repo doesn't exist
- `RepoStatusConflictError` - Thrown when CAS check fails (expected status doesn't match)
