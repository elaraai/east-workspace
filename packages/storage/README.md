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
PK: REPO#{repo}
SK: #META
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
PK: REPO#{repo}
SK: PKG#{name}#{version}
Attributes:
  - hash: string           # SHA256 hash of package content
  - createdAt: string      # ISO timestamp
```

### Workspaces

Workspace state stored as BEAST2-encoded binary.

```
PK: REPO#{repo}
SK: WS#{name}
Attributes:
  - state: Binary          # BEAST2-encoded workspace state
  - updatedAt: string      # ISO timestamp
```

### Execution Cache

Task execution results keyed by task hash + inputs hash.

```
PK: REPO#{repo}
SK: EXEC#{taskHash}#{inputsHash}
Attributes:
  - status: Binary         # BEAST2-encoded ExecutionStatus
  - outputHash?: string    # SHA256 hash of output (if success)
  - updatedAt: string      # ISO timestamp
  - completedAt?: string   # ISO timestamp
```

### Dataflow Execution State

Current execution state for a workspace (Step Functions orchestration).

```
PK: REPO#{repo}
SK: EXEC#STATE#{workspace}
Attributes:
  - executionId: string    # Unique execution ID
  - status: string         # 'running' | 'completed' | 'failed'
  - startedAt: string      # ISO timestamp
  - completedAt?: string   # ISO timestamp
  - taskCount: number      # Total tasks in graph
  - completedCount: number # Successfully completed tasks
  - failedCount: number    # Failed tasks
  - skippedCount: number   # Skipped tasks (due to upstream failure)
  - cachedCount: number    # Tasks served from cache
```

### Dataflow Task Status

Per-task status within a dataflow execution.

```
PK: REPO#{repo}
SK: EXEC#TASK#{executionId}#{taskName}
Attributes:
  - status: string         # 'dispatched' | 'running' | 'success' | 'cached' | 'failed' | 'error' | 'skipped' | 'ready'
  - outputHash?: string    # SHA256 hash of output
  - exitCode?: number      # Process exit code
  - error?: string         # Error message
  - duration?: number      # Execution duration (ms)
  - readyAt?: string       # ISO timestamp when task became ready
  - completedAt?: string   # ISO timestamp when task completed
```

### Dataflow Graph

Stored task graph for an execution.

```
PK: REPO#{repo}
SK: EXEC#GRAPH#{executionId}
Attributes:
  - graph: string          # JSON-serialized task graph
```

### Dataflow Events

Event log for dataflow execution (for UI/monitoring).

```
PK: REPO#{repo}
SK: EXEC#EVENT#{executionId}#{seq}
Attributes:
  - eventType: string      # 'start' | 'complete' | 'cached' | 'failed' | 'error' | 'skipped'
  - task: string           # Task name
  - timestamp: string      # ISO timestamp
  - duration?: number      # Task duration (ms)
  - exitCode?: number      # Process exit code
  - message?: string       # Additional message
  - reason?: string        # Failure/skip reason
```

### Locks

Distributed locks with automatic expiry.

```
PK: REPO#{repo}
SK: LOCK#{resource}
Attributes:
  - holder: string         # East-encoded holder info (.lambda (...))
  - operation: string      # Lock operation type
  - acquiredAt: string     # ISO timestamp
  - expiresAt: string      # ISO timestamp
  - ttl: number            # DynamoDB TTL (seconds since epoch)
```

### Log Chunks

Streaming log chunks for near real-time access.

```
PK: REPO#{repo}
SK: LOG#{taskHash}#{inputsHash}#{stream}#{timestamp}#{seq}
Attributes:
  - data: string           # Log chunk content
  - timestamp: number      # Milliseconds since epoch
  - ttl: number            # DynamoDB TTL (7 days)

Where:
  - stream: 'stdout' | 'stderr'
  - timestamp: 15-digit zero-padded ms
  - seq: 6-digit zero-padded sequence number
```

## S3 Object Layout

Content-addressed objects stored in S3:

```
s3://{bucket}/
  {repo}/objects/{hash}    # SHA256-addressed blobs
```

## Access Patterns

| Operation | Key Pattern | Query Type |
|-----------|-------------|------------|
| List repos | SK = #META | Scan + Filter |
| Get repo metadata | PK = REPO#{repo}, SK = #META | GetItem |
| List packages | PK = REPO#{repo}, SK begins_with PKG# | Query |
| Get package | PK = REPO#{repo}, SK = PKG#{name}#{version} | GetItem |
| List workspaces | PK = REPO#{repo}, SK begins_with WS# | Query |
| Get workspace | PK = REPO#{repo}, SK = WS#{name} | GetItem |
| Get execution | PK = REPO#{repo}, SK = EXEC#{taskHash}#{inputsHash} | GetItem |
| List executions | PK = REPO#{repo}, SK begins_with EXEC# | Query |
| Get execution state | PK = REPO#{repo}, SK = EXEC#STATE#{workspace} | GetItem |
| Get task statuses | PK = REPO#{repo}, SK begins_with EXEC#TASK#{executionId}# | Query |
| Get events | PK = REPO#{repo}, SK begins_with EXEC#EVENT#{executionId}# | Query |
| Get lock | PK = REPO#{repo}, SK = LOCK#{resource} | GetItem |
| Read logs | PK = REPO#{repo}, SK begins_with LOG#{taskHash}#{inputsHash}#{stream}# | Query |
| Delete repo | PK = REPO#{repo} | Query + BatchDelete |

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
