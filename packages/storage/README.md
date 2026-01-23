# @elaraai/e3-storage

S3 + DynamoDB StorageBackend implementation for e3 cloud deployments.

## Overview

This package provides the cloud storage backend for e3, implementing the `StorageBackend` interface from `@elaraai/e3-core`:

- **Objects**: S3 (content-addressed blobs)
- **Refs**: DynamoDB (packages, workspaces, executions)
- **Locks**: DynamoDB (with TTL for automatic cleanup)
- **Logs**: DynamoDB (chunked for real-time streaming)

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

### Dataflow Executions (Phase 3)

Execution records with auto-increment numeric IDs. Each workspace gets its own partition, with SK="0" as the counter. Execution records use zero-padded string SKs (e.g., "0000000001") for proper alphanumeric sorting.

```
PK: EXEC/{repo}/{workspace}
SK: "0" (counter) | {zero-padded id} (execution record)

Counter record (SK: "0"):
  - nextId: number         # Next execution ID to allocate

Execution record (SK: "0000000001", "0000000002", ...):
  - id: number             # Numeric execution ID
  - repo: string           # Repository name
  - workspace: string      # Workspace name
  - status: string         # 'starting' | 'running' | 'completed' | 'failed'
  - startedAt: string      # ISO timestamp
  - completedAt?: string   # ISO timestamp
  - taskCount?: number     # Total tasks in graph (set when execution starts)
  - completedCount: number # Successfully completed tasks
  - failedCount: number    # Failed tasks
  - skippedCount: number   # Skipped tasks (due to upstream failure)
  - cachedCount: number    # Tasks served from cache
  - eventSeq: number       # Counter for event sequence numbers
  - graph?: string         # JSON-serialized task graph (set when execution starts)
```

### Dataflow Tasks (Phase 3)

Per-task status within a dataflow execution. Each execution gets its own partition.

```
PK: TASK/{repo}/{executionId}
SK: {taskName}
Attributes:
  - status: string         # 'dispatched' | 'running' | 'success' | 'cached' | 'failed' | 'error' | 'skipped' | 'ready'
  - outputHash?: string    # SHA256 hash of output
  - outputPath?: string    # Path where output is written
  - taskHash?: string      # Hash of the task definition
  - inputHashes?: string[] # Hashes of task inputs
  - exitCode?: number      # Process exit code
  - error?: string         # Error message
  - reason?: string        # Reason for skipped tasks
  - duration?: number      # Execution duration (ms)
  - heartbeat?: number     # Unix timestamp of last heartbeat
  - readyAt?: string       # ISO timestamp when task became ready
  - completedAt?: string   # ISO timestamp when task completed
  - failedAt?: string      # ISO timestamp when task failed
  - skippedAt?: string     # ISO timestamp when task was skipped
```

### Dataflow Events (Phase 3)

Event log for dataflow execution (for UI/monitoring). Each execution gets its own partition.

```
PK: EVENT/{repo}/{executionId}
SK: {seq} (zero-padded 6 digits)
Attributes:
  - eventType: string      # 'start' | 'complete' | 'cached' | 'failed' | 'error' | 'skipped'
  - task: string           # Task name
  - timestamp: string      # ISO timestamp
  - duration?: number      # Task duration (ms)
  - exitCode?: number      # Process exit code
  - message?: string       # Additional message
  - reason?: string        # Failure/skip reason
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
| Create execution (Phase 3) | PK = EXEC/{repo}/{workspace}, SK = "0" | UpdateItem (atomic increment) |
| Get execution (Phase 3) | PK = EXEC/{repo}/{workspace}, SK = {padded-id} | GetItem |
| List executions (Phase 3) | PK = EXEC/{repo}/{workspace}, SK > "0" | Query (descending) |
| Get task statuses (Phase 3) | PK = TASK/{repo}/{executionId} | Query |
| Get events (Phase 3) | PK = EVENT/{repo}/{executionId} | Query |
| Get lock | PK = LOCK/{repo}, SK = {resource} | GetItem |
| Read logs | PK = LOG/{repo}/{taskHash}/{inputsHash}, SK begins_with {stream}/ | Query |
| Get object catalogue entry | PK = OBJ/{repo}, SK = {hash} | GetItem |
| List objects (catalogue) | PK = OBJ/{repo} | Query |
| Delete repo | PKG/{repo}, WS/{repo}, LOCK/{repo}, REPO#{repo}, OBJ/{repo} (Query) + CACHE/{repo}/, LOG/{repo}/, EXEC/{repo}/, TASK/{repo}/, EVENT/{repo}/ (Scan) | Query + Scan + BatchDelete |

## Files

```
packages/storage/src/
├── s3-dynamo-storage.ts    # Main StorageBackend implementation
├── s3-object-store.ts      # S3-backed ObjectStore
├── dynamo-ref-store.ts     # DynamoDB-backed RefStore + repo management
├── dynamo-lock-service.ts  # DynamoDB-backed LockService
├── dynamo-log-store.ts     # DynamoDB-backed LogStore
└── index.ts                # Exports
```
