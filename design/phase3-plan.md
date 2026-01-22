# Phase 3: DynamoDB Schema Migration - EXEC, TASK, EVENT

**Status: COMPLETED**

## Overview

Phase 3 migrates dataflow execution state from the legacy `REPO#{repo}` partition to dedicated partitions per workspace and execution. This introduces **execution history** (preserving past executions) and changes the execution ID format from UUIDs to autoincrement numbers.

## Current Schema (Legacy)

All execution data lives under `PK: REPO#{repo}`:

| Item | Current Key Pattern | Purpose |
|------|---------------------|---------|
| Execution State | `SK: EXEC#STATE#{workspace}` | Current execution status (overwritten each run) |
| Task Graph | `SK: EXEC#GRAPH#{executionId}` | Stored task dependency graph |
| Task Status | `SK: EXEC#TASK#{executionId}#{taskName}` | Per-task completion status |
| Events | `SK: EXEC#EVENT#{executionId}#{seq}` | Execution event log |

**Problems:**
- All writes go to same partition (hot partition risk)
- No execution history (state overwritten each run)
- Graph stored as separate item (extra lookup)
- 10GB partition limit risk with many executions

## New Schema

### 1. EXEC (Dataflow Executions with History)

```
PK: EXEC/{repo}/{workspace}
SK: 0 (Number)     → Counter item: { nextId: N }
SK: 1, 2, 3...     → Execution records (Number type for natural ordering)

Execution attributes:
  - executionId: number        # Same as SK (for convenience)
  - status: string             # 'running' | 'completed' | 'failed'
  - startedAt: string          # ISO timestamp
  - completedAt?: string       # ISO timestamp
  - taskCount: number
  - completedCount: number
  - failedCount: number
  - skippedCount: number
  - cachedCount: number
  - eventSeq: number           # Counter for next event sequence
  - graph: string              # JSON-serialized task graph (was separate item)
```

**Key changes:**
- **History preserved**: Each execution gets a unique numeric ID
- **Graph as attribute**: No separate EXEC#GRAPH item
- **Counter at SK=0**: Atomic ID generation via UpdateItem ADD
- **Number-type SK**: Natural ordering without zero-padding

### 2. TASK (Task Status per Execution)

```
PK: TASK/{repo}/{executionId}
SK: {taskName}

Attributes:
  - status: string           # 'dispatched' | 'running' | 'success' | 'cached' | 'failed' | 'error' | 'skipped' | 'ready'
  - outputHash?: string
  - exitCode?: number
  - error?: string
  - duration?: number
  - readyAt?: string
  - completedAt?: string
```

**Key changes:**
- **Per-execution partition**: Each execution's task statuses isolated
- **History preserved**: Task statuses not overwritten between runs
- **executionId in PK**: Must be the numeric ID from EXEC

### 3. EVENT (Dataflow Events per Execution)

```
PK: EVENT/{repo}/{executionId}
SK: {seq} (6-digit zero-padded string, e.g., "000001")

Attributes:
  - eventType: string        # 'start' | 'complete' | 'cached' | 'failed' | 'error' | 'skipped'
  - task: string
  - timestamp: string        # ISO timestamp
  - duration?: number
  - exitCode?: number
  - message?: string
  - reason?: string
```

**Key changes:**
- **Per-execution partition**: Write isolation
- **Sequence from execution item**: eventSeq counter in EXEC item

## Access Patterns

| Operation | Key Pattern | Query Type |
|-----------|-------------|------------|
| Get current execution | `PK: EXEC/{repo}/{ws}`, SK > 0, Limit=1, ScanIndexForward=false | Query |
| Get execution by ID | `PK: EXEC/{repo}/{ws}`, SK = {id} | GetItem |
| List executions | `PK: EXEC/{repo}/{ws}`, SK > 0 | Query |
| Create execution | Increment SK=0.nextId + Put SK={newId} | Transaction |
| Update execution counters | `PK: EXEC/{repo}/{ws}`, SK = {id} | UpdateItem |
| Get all task statuses | `PK: TASK/{repo}/{execId}` | Query |
| Get task status | `PK: TASK/{repo}/{execId}`, SK = {taskName} | GetItem |
| Update task status | `PK: TASK/{repo}/{execId}`, SK = {taskName} | PutItem |
| Add event | `PK: EVENT/{repo}/{execId}`, SK = {seq} | PutItem |
| List events | `PK: EVENT/{repo}/{execId}` | Query |

## Implementation Plan

### Step 1: Add New Helper Methods (`dynamo-ref-store.ts`)

```typescript
// Get or create execution counter, returning next ID
async getNextExecutionId(repo: string, workspace: string): Promise<number>

// Create new execution (returns full execution record)
async createExecution(repo: string, workspace: string, graph: string, taskCount: number): Promise<DataflowExecution>

// Get execution by workspace (current = latest)
async getExecution(repo: string, workspace: string, executionId?: number): Promise<DataflowExecution | null>

// Update execution (status, counters, completedAt)
async updateExecution(repo: string, workspace: string, executionId: number, updates: Partial<DataflowExecution>): Promise<void>

// List executions for workspace (newest first)
async listExecutions(repo: string, workspace: string, limit?: number): Promise<DataflowExecution[]>
```

### Step 2: Migrate Execution Methods

| Old Method | New Method | Changes |
|------------|------------|---------|
| `getExecutionState(repo, ws)` | `getExecution(repo, ws)` | Returns latest execution, different return type |
| `getExecutionGraph(repo, execId)` | `getExecution(repo, ws, execId)` | Graph is attribute of execution |
| `getExecutionTasks(repo, execId)` | `getExecutionTasks(repo, execId)` | New PK pattern |
| `getExecutionEvents(repo, execId)` | `getExecutionEvents(repo, execId)` | New PK pattern |

**Note:** Execution state write methods are in the Lambda handlers (Step Functions), not DynamoRefStore.

### Step 3: Update Lambda Handlers (`packages/runner/src/handlers/`)

Each handler needs to be updated for the new patterns:

| Handler | Changes Required |
|---------|------------------|
| `get-graph.ts` | Create execution via `createExecution()`, store graph as attribute |
| `get-ready.ts` | Read task statuses from `TASK/{repo}/{execId}` |
| `dispatch-task.ts` | Write task status to `TASK/{repo}/{execId}` |
| `write-result.ts` | Update task status, add event |
| `check-completion.ts` | Read/update execution state |
| `finalize-execution.ts` | Update execution status to completed/failed |
| `mark-skipped.ts` | Update task statuses |

**Key consideration:** Handlers currently receive `executionId` as a UUID string. Need to:
1. Change Step Functions to pass numeric execution ID
2. Or convert UUID to number in handlers (breaking change)

### Step 4: Update API Handlers (`packages/api/src/index.ts`)

Update routes that read execution data:
- `GET /repos/{repo}/workspaces/{ws}/status` - execution state
- `GET /repos/{repo}/workspaces/{ws}/execution` - execution details
- `GET /repos/{repo}/workspaces/{ws}/events` - execution events

### Step 5: Update GC Mark Phase (`gc-mark.ts`)

Update `collectRoots()` to scan new partitions:
- Scan `EXEC/{repo}/` for execution items with outputHash in graph
- Scan `TASK/{repo}/` for task items with outputHash
- Keep scanning legacy `REPO#{repo}` with `EXEC#*` prefix during transition

### Step 6: Update deleteRepoBatch

Add scan phases for new partitions:
- Scan `EXEC/{repo}/` prefix
- Scan `TASK/{repo}/` prefix
- Scan `EVENT/{repo}/` prefix

### Step 7: Update Documentation

- `packages/storage/README.md` - Schema documentation
- `design/cloud-devplan.md` - Mark Phase 3 complete

## Migration Strategy

Since this is pre-MVP and existing data can be trashed:

1. **Direct cutover** (no dual-write needed)
2. Delete existing repos or accept they'll have broken execution history
3. New executions use new schema immediately

## Files to Modify

| File | Scope of Changes |
|------|------------------|
| `packages/storage/src/dynamo-ref-store.ts` | New execution methods, migrate task/event queries |
| `packages/runner/src/handlers/get-graph.ts` | Create execution with graph attribute |
| `packages/runner/src/handlers/get-ready.ts` | Query tasks from TASK partition |
| `packages/runner/src/handlers/dispatch-task.ts` | Write to TASK partition |
| `packages/runner/src/handlers/write-result.ts` | Update TASK, add EVENT |
| `packages/runner/src/handlers/check-completion.ts` | Read/update EXEC partition |
| `packages/runner/src/handlers/finalize-execution.ts` | Update EXEC status |
| `packages/runner/src/handlers/mark-skipped.ts` | Update TASK statuses |
| `packages/api/src/index.ts` | Update execution-related API routes |
| `packages/api/src/repo-lifecycle/gc-mark.ts` | Scan new partitions |
| `packages/storage/README.md` | Schema documentation |
| `design/cloud-devplan.md` | Mark Phase 3 complete |

## Open Questions

1. **Execution ID format**: Keep UUID strings for backwards compatibility with Step Functions state, or migrate to numbers?
   - Recommend: Keep UUID in Step Functions, store numeric ID separately for DynamoDB key

2. **Graph storage**: Store as JSON string attribute or use DynamoDB document format?
   - Recommend: JSON string (simpler, consistent with current approach)

3. **Event sequence generation**: Use atomic counter in EXEC item or timestamp-based?
   - Recommend: Atomic counter (eventSeq) for strict ordering

4. **Cleanup of legacy items**: Delete during migration or let them age out?
   - Recommend: Delete repos and recreate for clean state (pre-MVP)

## Estimated Scope

- **DynamoRefStore**: ~200 lines changed/added
- **Lambda handlers**: ~50-100 lines each (7 handlers)
- **API handlers**: ~50 lines
- **GC/Delete**: ~50 lines
- **Documentation**: ~100 lines

Total: ~800-1000 lines of changes
