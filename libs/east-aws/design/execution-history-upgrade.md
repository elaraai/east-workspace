# Execution History Upgrade for e3-aws

> **Status: Implemented.** The changes described in this document have been implemented. See `packages/e3-aws-storage/README.md` for the current DynamoDB schema.
>
> **Implementation notes:**
> - RUNNING/ prefix optimization was skipped — Step Functions orchestration tracks running state separately.
> - S3 log consolidation was deferred — DynamoDB log TTL increased from 7 to 30 days as a stopgap.
> - The "current schema" described below was the design target. The prior schema used `PK: CACHE/{repo}/{taskHash}, SK: {inputsHash}`.

This document describes how to implement the execution history design from e3-core in the AWS backend (e3-aws).

## Overview

The e3-core execution history design introduces:
- UUIDv7-based execution instance tracking: `(taskHash, inputsHash, executionId)`
- Append-only execution history
- Dataflow run tracking with `runId`
- Updated workspace state with `currentRunId`

This document outlines how to implement these changes in the DynamoDB/S3 storage backend.

## DynamoDB Schema Changes

### Execution Records

**Current schema:**
```
PK: EXECUTION/{repo}/{taskHash}/{inputsHash}
SK: STATUS
```

**New schema:**
```
PK: EXECUTION/{repo}/{taskHash}/{inputsHash}
SK: {executionId}                              # UUIDv7 (sortable)
```

The new schema stores each execution as a separate DynamoDB item. Since UUIDv7 is lexicographically sortable by timestamp, querying with `ScanIndexForward=false` returns the latest execution first.

### Execution Attributes

Each execution item contains:
```json
{
  "PK": "EXECUTION/{repo}/{taskHash}/{inputsHash}",
  "SK": "{executionId}",
  "status": "running|success|failed|error",
  "inputHashes": ["hash1", "hash2", ...],
  "startedAt": "2024-01-15T10:30:42Z",
  "completedAt": "2024-01-15T10:31:15Z",     // Optional
  "outputHash": "abc123...",                  // Success only
  "exitCode": 1,                              // Failed only
  "errorMessage": "...",                      // Error only
  "pid": 12345,                               // Running only
  "pidStartTime": 1705312242000,              // Running only
  "bootId": "abc-def-123",                    // Running only
  "importedFrom": {                           // Optional (on import)
    "sourceRepo": "user@host:/path",
    "importedAt": "2024-01-15T11:00:00Z"
  }
}
```

### Transient vs Completed Executions

To optimize for running executions (which are polled frequently), use a separate prefix:

```
# Running executions (transient, DynamoDB only)
PK: RUNNING/{repo}/{taskHash}/{inputsHash}
SK: {executionId}

# Completed executions (permanent, DynamoDB + S3 logs)
PK: EXECUTION/{repo}/{taskHash}/{inputsHash}
SK: {executionId}
```

On completion, move from `RUNNING/` to `EXECUTION/` prefix.

### Dataflow Run Records

```
PK: DATAFLOW/{repo}/{workspace}
SK: {runId}                                    # UUIDv7
```

Attributes:
```json
{
  "PK": "DATAFLOW/{repo}/{workspace}",
  "SK": "{runId}",
  "workspaceName": "prod",
  "packageRef": "forecast-model@1.0.0",
  "startedAt": "2024-01-15T10:30:42Z",
  "completedAt": "2024-01-15T10:31:15Z",
  "status": "running|completed|failed|cancelled",
  "failedTask": "train",                       // Failed only
  "failedError": "...",                        // Failed only
  "inputSnapshot": "abc123...",
  "outputSnapshot": "def456...",
  "taskExecutions": {                          // Map<taskName, record>
    "preprocess": { "executionId": "018f...", "cached": true },
    "train": { "executionId": "018f...", "cached": false }
  },
  "summary": {
    "total": 3,
    "completed": 3,
    "cached": 2,
    "failed": 0,
    "skipped": 0
  }
}
```

### Workspace State

Update workspace state item to include `currentRunId`:

```
PK: WORKSPACE/{repo}
SK: {workspaceName}
```

Add attribute:
```json
{
  "currentRunId": "018f3b4c-9a2d-7def-8abc-123456789012"  // Optional
}
```

## S3 Log Storage

### Log Path Structure

**Current:**
```
s3://{bucket}/{repo}/logs/{taskHash}/{inputsHash}/stdout.txt
s3://{bucket}/{repo}/logs/{taskHash}/{inputsHash}/stderr.txt
```

**New:**
```
s3://{bucket}/{repo}/logs/{taskHash}/{inputsHash}/{executionId}/stdout.txt
s3://{bucket}/{repo}/logs/{taskHash}/{inputsHash}/{executionId}/stderr.txt
```

### Log Consolidation on Completion

During execution, logs may be written in chunks to DynamoDB for real-time streaming:

```
PK: LOG_CHUNK/{repo}/{taskHash}/{inputsHash}/{executionId}
SK: {stream}#{chunkIndex}                      # stdout#0, stdout#1, stderr#0
```

On execution completion:
1. Read all log chunks from DynamoDB
2. Concatenate and write to S3 as single object
3. Delete DynamoDB log chunks (TTL or explicit delete)

This optimizes for:
- Real-time log streaming during execution (DynamoDB)
- Efficient long-term storage and retrieval (S3)

### Log Streaming API

For running executions, stream from DynamoDB chunks.
For completed executions, read from S3.

```typescript
async function getExecutionLogs(
  repo: string,
  taskHash: string,
  inputsHash: string,
  executionId: string,
  stream: 'stdout' | 'stderr',
  options?: { offset?: number; limit?: number }
): Promise<LogChunk> {
  // Check if execution is running
  const execution = await getExecution(repo, taskHash, inputsHash, executionId);

  if (execution?.status === 'running') {
    // Stream from DynamoDB chunks
    return readLogChunks(repo, taskHash, inputsHash, executionId, stream, options);
  } else {
    // Read from S3
    return readS3Log(repo, taskHash, inputsHash, executionId, stream, options);
  }
}
```

## API Implementation

### RefStore Interface Methods

```typescript
interface AwsRefStore {
  // Execution methods (updated)
  executionGet(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<ExecutionStatus | null>;
  executionWrite(repo: string, taskHash: string, inputsHash: string, executionId: string, status: ExecutionStatus): Promise<void>;
  executionListIds(repo: string, taskHash: string, inputsHash: string): Promise<string[]>;
  executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null>;
  executionGetLatestOutput(repo: string, taskHash: string, inputsHash: string): Promise<string | null>;

  // Dataflow run methods (new)
  dataflowRunGet(repo: string, workspace: string, runId: string): Promise<DataflowRun | null>;
  dataflowRunWrite(repo: string, workspace: string, run: DataflowRun): Promise<void>;
  dataflowRunList(repo: string, workspace: string): Promise<string[]>;
  dataflowRunGetLatest(repo: string, workspace: string): Promise<DataflowRun | null>;
  dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void>;
}
```

### LogStore Interface Methods

```typescript
interface AwsLogStore {
  logAppend(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr', data: string): Promise<void>;
  logRead(repo: string, taskHash: string, inputsHash: string, executionId: string, stream: 'stdout' | 'stderr', options?: LogReadOptions): Promise<LogChunk>;
  logConsolidate(repo: string, taskHash: string, inputsHash: string, executionId: string): Promise<void>;
}
```

## Query Patterns

### Get Latest Execution

```typescript
// DynamoDB Query
const result = await dynamodb.query({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': `EXECUTION/${repo}/${taskHash}/${inputsHash}`
  },
  ScanIndexForward: false,  // Descending order
  Limit: 1
});
```

### Get Latest Successful Output

```typescript
// Query with filter for success status
async function getLatestSuccessfulOutput(
  repo: string,
  taskHash: string,
  inputsHash: string
): Promise<string | null> {
  const pk = `EXECUTION/${repo}/${taskHash}/${inputsHash}`;

  // Query in reverse order, filter for success
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const result = await dynamodb.query({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      FilterExpression: '#status = :success',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':pk': pk,
        ':success': 'success'
      },
      ScanIndexForward: false,
      Limit: 10,  // Batch size
      ExclusiveStartKey: lastEvaluatedKey
    });

    if (result.Items && result.Items.length > 0) {
      return result.Items[0].outputHash;
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return null;
}
```

### List Dataflow Runs

```typescript
const result = await dynamodb.query({
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': `DATAFLOW/${repo}/${workspace}`
  },
  ScanIndexForward: false,  // Latest first
  Limit: 50
});
```

### Delete Dataflow Run

```typescript
await dynamodb.delete({
  TableName: TABLE_NAME,
  Key: {
    PK: `DATAFLOW/${repo}/${workspace}`,
    SK: runId
  }
});
```

## Dataflow Run Cleanup

### Cleanup Behavior

Dataflow runs are mutable records with a lifecycle (unlike immutable objects). e3-core cleans up old runs at the start of each new run to prevent accumulation.

**Key behavior:** When a new dataflow run starts (while holding the workspace lock), all previous runs are deleted. This ensures at most one run file exists per workspace at any time.

```typescript
// In dataflowExecuteWithLock(), after building dependency graph:
const allRunIds = await storage.refs.dataflowRunList(repo, ws);
for (const oldRunId of allRunIds) {
  await storage.refs.dataflowRunDelete(repo, ws, oldRunId);
}
```

### Why Cleanup on Start

- We hold the workspace lock at start, guaranteeing no concurrent runs
- Previous run might be stale (crashed process left "running" status)
- Simpler than tracking completion states

### AWS Implementation Notes

For DynamoDB, implement `dataflowRunDelete` as a simple `DeleteItem`:

```typescript
async dataflowRunDelete(repo: string, workspace: string, runId: string): Promise<void> {
  await dynamodb.delete({
    TableName: TABLE_NAME,
    Key: {
      PK: `DATAFLOW/${repo}/${workspace}`,
      SK: runId
    }
  });
  // Idempotent - no error if item doesn't exist
}
```

The cleanup loop in `dataflowExecuteWithLock` handles deletion automatically. No additional infrastructure (TTL, scheduled cleanup) is needed.

## Migration Strategy

### No Data Migration Required

The new schema is additive:
- Existing executions continue to work (they don't have executionId)
- New executions use the new schema
- Legacy code paths can coexist temporarily

### Rollout Approach

1. **Phase 1: Deploy new schema support**
   - Update DynamoDB table with new index patterns
   - Deploy new API handlers that support both schemas
   - New executions write to new schema

2. **Phase 2: Migrate legacy reads**
   - Update read paths to check new schema first, fall back to old
   - Monitor for any legacy access patterns

3. **Phase 3: Clean up (optional)**
   - Remove old execution records (they're no longer used)
   - Remove legacy code paths

### Backward Compatibility

During migration, handle both old and new executions:

```typescript
async function executionGetLatest(
  repo: string,
  taskHash: string,
  inputsHash: string
): Promise<ExecutionStatus | null> {
  // Try new schema first
  const newResult = await queryNewSchema(repo, taskHash, inputsHash);
  if (newResult) return newResult;

  // Fall back to old schema
  return queryOldSchema(repo, taskHash, inputsHash);
}
```

## Garbage Collection

### Execution Retention

Executions are retained while referenced by any `DataflowRun`. The GC process:

1. List all `DataflowRun` records
2. Collect all referenced `executionId` values
3. Scan executions, delete those not referenced

### Log Cleanup

Logs follow execution lifecycle:
- Consolidated S3 logs deleted with execution
- DynamoDB log chunks have TTL (24h after completion)

### Cost Optimization

For high-volume workspaces, consider:
- TTL on old `DataflowRun` records (configurable retention)
- Archival tier for old execution logs in S3

## Testing

### Unit Tests

1. `executionGet` returns correct execution by ID
2. `executionGetLatest` returns most recent execution
3. `executionGetLatestOutput` skips failures
4. `dataflowRunWrite`/`dataflowRunGet` round-trip
5. `dataflowRunDelete` removes run and is idempotent
6. Log consolidation merges chunks correctly

### Integration Tests

1. Full dataflow execution creates run record
2. Second dataflow execution cleans up previous run (only one run exists)
3. Workspace export includes executions from current run
4. Import preserves execution IDs and provenance
5. Cache lookup uses latest successful execution

## Monitoring

### Metrics to Track

- `execution_count` by status (running, success, failed, error)
- `dataflow_run_count` by status
- `log_consolidation_duration_ms`
- `cache_hit_rate` (cached vs executed tasks)

### Alerts

- High failure rate on executions
- Log consolidation failures
- DynamoDB throttling on execution queries
