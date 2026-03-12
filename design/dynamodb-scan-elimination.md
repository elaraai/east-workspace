# DynamoDB Scan Elimination — Phase 1: Task Execution Hot Path

## Summary

Our DynamoDB usage has a critical performance and cost problem: workspace status polling triggers **65 full table scans per second** per open browser tab. As the table grows (currently 9,572 items / 117MB in dev), this scales linearly with total table size regardless of how much data the caller actually needs.

This document covers **Phase 1** — eliminating the critical hot-path scan by introducing `TASK_EXEC` (live execution record) and `TASK_LOG` (immutable history). Phase 2 (cold-path scans for repo deletion, GC, task config and user settings cleanup) will be addressed separately.

## Outcome

| Metric | Before | After |
|--------|--------|-------|
| Workspace status poll | 65 full table scans + 65 queries / second | 65 single-partition queries / second |
| `ScanCommand` on hot path | 1 per task per poll | **0** |

---

## Problem

The UI polls `GET /api/repos/:repo/workspaces/:ws/status` every 1 second. For each task in the workspace, `checkInProgress()` in e3-core calls:

```
executionListForTask(repo, taskHash)     →  ScanCommand (full table)
for each inputsHash:
    executionGetLatest(repo, taskHash, inputsHash)  →  QueryCommand (efficient)
```

The scan exists because execution records use a 4-segment PK:

```
PK: EXECUTION/{repo}/{taskHash}/{inputsHash}    SK: {executionId}
```

Each unique `inputsHash` creates a separate DynamoDB partition. To discover which `inputsHash` values exist for a `taskHash`, the code must scan the entire table filtering by `begins_with(PK, 'EXECUTION/{repo}/{taskHash}/')`.

For a workspace with 65 tasks, this is **65 full table scans per second** per open browser tab.

### What is `taskHash`?

`taskHash` is the SHA-256 of the serialized `TaskObject` — the compiled task definition including its code and metadata. It is computed by `e3-core` via `computeHash(encodeTask(task))`. It is the same concept for Lambda and Fargate compute.

`inputsHash` is the SHA-256 of the task's input hashes joined by null bytes: `SHA256(inputHashes.join('\0'))`. Together, `(taskHash, inputsHash)` uniquely identifies the execution cache key — same task code with same inputs should produce the same output.

---

## Solution: `TASK_EXEC` + `TASK_LOG`

Introduce a new partition that serves as the **live mutable execution record** per (taskHash, inputsHash) pair. The existing `EXECUTION/` partitions are replaced by `TASK_LOG/` — immutable history written only when an execution reaches a terminal state.

```
Live record (hot path — mutable during execution lifetime):
    PK: TASK_EXEC/{repo}/{taskHash}    SK: {inputsHash}
    Attrs: executionId, status (BEAST2), outputHash, startedAt, updatedAt

History (cold path — immutable, written once at completion):
    PK: TASK_LOG/{repo}/{taskHash}/{inputsHash}    SK: {executionId}
    Attrs: status (BEAST2), updatedAt
```

The key insight is that `TASK_EXEC` is the **master record** for the current/latest execution. It is created when an execution starts and mutated in place as it progresses. The `TASK_LOG` history row is only written once, at terminal state (success or failure), as an immutable snapshot for audit and GC.

### Lifecycle

```
1. Start execution:
     Put TASK_EXEC/{repo}/{taskHash} SK={inputsHash}
     → { executionId, status: running, startedAt }
     (single PutItem — no history write yet)

2. Execution completes or fails:
     TransactWriteItems([
       Update TASK_EXEC → { status: success/failed, outputHash, updatedAt }
       Put TASK_LOG/{repo}/{taskHash}/{inputsHash} SK={executionId}
         → immutable snapshot of final status
     ])

3. New execution starts for same (taskHash, inputsHash):
     TransactWriteItems([
       Put TASK_LOG/{repo}/{taskHash}/{inputsHash} SK={oldExecutionId}
         → archive previous TASK_EXEC state (if not already archived)
       Put TASK_EXEC/{repo}/{taskHash} SK={inputsHash}
         → overwrite with new executionId, status: running
     ])
```

This means:
- **During execution**: only `TASK_EXEC` is written (1 write per status change, not 2)
- **History is always immutable**: only written at terminal state, never updated
- **`TASK_EXEC` always means "current"**: no ambiguity about which row is latest, no descending Query + Limit 1 needed
- **Fewer writes overall**: the common path (start → complete) is 1 PutItem + 1 TransactWriteItems(2), vs 2 PutItems previously

### Edge Case: Crashed Executions

If an execution crashes (Lambda timeout, Fargate OOM) without writing a terminal status, the `TASK_EXEC` row remains in `running` state with a stale `executionId`. This is already handled:

- `checkInProgress()` in e3-core verifies liveness (process alive check / Step Functions state)
- The next execution for that (taskHash, inputsHash) overwrites the stale row, optionally archiving the crashed execution to history

---

## Read Path Changes

### `executionListForTask()`: Scan → Query

Changes from `ScanCommand` (full table) to `QueryCommand` (single partition):

```typescript
async executionListForTask(repo: string, taskHash: string): Promise<string[]> {
  const items = await this.queryByPk(`TASK_EXEC/${repo}/${taskHash}`);
  return items.map((item) => item.SK as string);
}
```

### `executionGetLatest()`: Query → GetItem

Changes from descending Query on history partition to `GetItem` on the live record:

```typescript
async executionGetLatest(repo: string, taskHash: string, inputsHash: string): Promise<ExecutionStatus | null> {
  const item = await this.getItemByKey(`TASK_EXEC/${repo}/${taskHash}`, inputsHash);
  if (!item?.status) return null;
  return decodeExecutionStatus(item.status as Uint8Array);
}
```

### `checkInProgress()`: N+1 → Single Query

The current N+1 pattern (1 scan + N queries) collapses into a **single Query**:

```
Query PK=TASK_EXEC/{repo}/{taskHash}
→ Returns all inputsHash entries with latest status inline
→ Filter for status.type === 'running' in application code
```

The status is already on the `TASK_EXEC` row — no need to fan out.

### `executionList()`: Dead Code

`dynamo-ref-store.ts:220-257` — no callers exist in the cloud codebase. Implement as stub or remove. Only used by e3-cli `logs` command and local e3-api-server, neither of which run in Lambda.

---

## Why This Design?

**Why not collapse the PK hierarchy?**

An alternative would merge everything into `PK: EXECUTION/{repo}/{taskHash}`, `SK: {inputsHash}#{executionId}`. We rejected this because:

1. **Partition size** — All executions for a task land in one partition. Under reactive dataflow with concurrent re-executions, this becomes a write hotspot.
2. **Read amplification** — Discovering distinct `inputsHash` values requires reading through the full partition and deduplicating.
3. **Separation of concerns** — The live record answers "what's happening now?" (small, hot, frequently read). The history answers "what happened before?" (large, cold, rarely read).

**Why not a GSI?**

- GSI reads are eventually consistent — unacceptable for e3's MVCC-like correctness requirements
- GSI writes consume separate throughput, adding hidden cost
- Self-managed indexes via TransactWriteItems give us identical consistency guarantees

---

## Schema Summary

### New Partitions

| PK | SK | Attrs | Purpose |
|----|----|-------|---------|
| `TASK_EXEC/{repo}/{taskHash}` | `{inputsHash}` | executionId, status, outputHash, startedAt, updatedAt | Live execution record (mutable) |
| `TASK_LOG/{repo}/{taskHash}/{inputsHash}` | `{executionId}` | status, updatedAt | Immutable execution history |

### Replaced Partitions

| Old PK | Replacement |
|--------|-------------|
| `EXECUTION/{repo}/{taskHash}/{inputsHash}` | `TASK_LOG/{repo}/{taskHash}/{inputsHash}` (same structure, renamed) |

### Write Path

| Operation | Before | After |
|-----------|--------|-------|
| Execution start | PutItem (EXECUTION) | PutItem (TASK_EXEC) |
| Execution complete | PutItem (EXECUTION) | TransactWriteItems: Update TASK_EXEC + Put TASK_LOG |

Write amplification is roughly neutral — the common lifecycle (start → complete) goes from 2 PutItems to 1 PutItem + 1 TransactWriteItems(2).

---

## Migration

Since `TASK_EXEC` only stores the *current* execution state, and the hot path (`checkInProgress`) only cares about `running` status, no backfill is needed. New executions populate `TASK_EXEC` naturally.

For the transition period:
1. Deploy new code that writes `TASK_EXEC` + `TASK_LOG` (new names)
2. Read path checks `TASK_EXEC` first (new), falls back to scanning `EXECUTION/` (old) if needed
3. Once all active executions have cycled through, remove the fallback scan code
4. Old `EXECUTION/` data can be cleaned up via a one-time script or left for natural GC

In dev/twe/kpmg we can delete existing execution data and skip the fallback, making this a clean cutover.

---

## GC Impact

The `TASK_EXEC` partition also benefits GC. Currently `gcScanExecutionRoots()` does a full table scan on `EXECUTION/{repo}/` and decodes every BEAST2 record to extract `outputHash`. With `TASK_EXEC`, GC can read `outputHash` directly from the live record without BEAST2 decoding.

Full GC scan elimination requires Phase 2 (`REPO_INDEX` for partition discovery), but Phase 1 provides the data structure that Phase 2 will query.

---

## Implementation Steps

1. ~~Add `TASK_EXEC/{repo}/{taskHash}` partition — update `executionWrite()` to write the live record~~ ✓
2. ~~Update `executionWrite()` to archive to `TASK_LOG` via TransactWriteItems at terminal state~~ ✓
3. ~~Rewrite `executionListForTask()` as `QueryCommand` on `TASK_EXEC`~~ ✓
4. ~~Rewrite `executionGetLatest()` as `GetItem` on `TASK_EXEC`~~ ✓
5. Optimise `checkInProgress()` in e3-core to fetch all statuses in single query (eliminate N+1) — deferred
6. `executionList()` left as scan — required by `RefStore` interface in e3-core, only used by CLI/local
7. ~~Update `gcScanExecutionRoots()` to scan `TASK_EXEC/` + `TASK_LOG/` (still a scan until Phase 2)~~ ✓
8. ~~Deploy to dev, verify with integration tests~~ ✓ (231/231 pass, 2026-03-12)
9. ~~Remove old `EXECUTION/` data in dev~~ ✓ (full wipe of dev DynamoDB + S3, 2026-03-12)

### Implementation Notes

- **Clean cutover**: Dev data was fully wiped (43,567 DynamoDB items + all S3 versions). No legacy `EXECUTION/` rows remain, so no fallback reads were needed.
- **Terminal-only writes**: `executionWrite()` is only called from `apply-results.ts` at task success/failure. The design doc's lifecycle step 1 (write running status to TASK_EXEC) was not implemented — TASK_EXEC only holds terminal states. This simplifies concurrent write handling (last-write-wins is safe).
- **`executionList()` kept**: Required by `RefStore` interface in `../e3/packages/e3-core`. Still uses `ScanCommand` on `TASK_EXEC/{repo}/` prefix, but has no callers in cloud Lambda code (only e3-cli `logs` command).
- **Prod rollout**: KPMG and TWE will need either data wipe or fallback reads before deploying.

---

## Phase 2: Scan-Free Repo Deletion & GC via Root Tracing (Complete)

Phase 2 eliminates all remaining cold-path scans by **tracing repo data from known roots** using only Query/GetItem operations.

### Derivation Chain

All repo data is reachable from two queryable roots: `WS/{repo}` and `PKG/{repo}`.

```
WS/{repo} → workspace names
├── DATAFLOW/{repo}/{ws}
├── EXEC/{repo}/{ws} → executionIds
│   ├── TASK/{repo}/{execId} → taskHash (stored on row)
│   │   ├── TASK_EXEC/{repo}/{taskHash} → inputsHashes
│   │   │   └── TASK_LOG/{repo}/{taskHash}/{inputsHash} → execIds
│   │   │       └── LOG/{repo}/{taskHash}/{inputsHash}/{execId}
│   │   └── CACHE/{repo}/{taskHash}
│   └── EVENT/{repo}/{execId}
├── STATE/{repo}/{ws}
├── USERSETTINGS/{repo}/{ws}
├── TASKCONFIG/{repo}/{ws}
└── COMPUTE_RESULT/{repo}/{ws}

Root partitions (direct query): PKG/, WS/, OBJ/, LOCK/, SCHEDULE/, DREF/, REPO#
```

### Changes Made

1. **`deleteRepoBatch()`** — Rewritten from 2-phase (query + scan) to 3-phase trace:
   - **Collect**: Trace from `WS/{repo}` → workspaces → executions → tasks → taskHashes → TASK_EXEC → TASK_LOG. Builds flat list of all derived partition PKs.
   - **Delete derived**: Query+BatchDelete each discovered partition (including USERSETTINGS and TASKCONFIG).
   - **Delete roots**: Delete root partitions last (PKG, WS, LOCK, OBJ, SCHEDULE, DREF, REPO#).

2. **`gcScanExecutionRoots()`** — Replaced `scanByPkPrefix()` calls with same trace approach. Queries WS → EXEC → TASK (collecting taskHashes), then queries CACHE, TASK_EXEC, and TASK_LOG per taskHash.

3. **`DynamoUserSettingsStore.deleteAllForRepo()`** — Replaced scan with `WS/{repo}` query → iterate `deleteAllForWorkspace()`.

4. **`DynamoTaskConfigStore.deleteAllForRepo()`** — Same pattern as user settings.

5. **Removed** `scanByPkPrefix()` from `DynamoS3RepoStore` (no longer used).

### Remaining Scan

`executionList()` in `DynamoRefStore` still uses `ScanCommand` — required by `RefStore` interface in e3-core, only used by CLI `logs` command (never called in Lambda).

### Known Issue: Repo Deletion / Execution Race Condition

Repo deletion and dataflow execution have no mutual exclusion:

- **Repo deletion** sets status to `deleting` but does NOT check for running executions or acquire workspace locks.
- **Dataflow start** acquires a workspace lock but does NOT check repo status.

This means an in-flight execution could write new TASK_EXEC/TASK_LOG items after the collect phase completes, leaving orphaned items. This is a **pre-existing issue** (the old scan-based approach had the same race — a scan could miss concurrently-written items).

**Proposed fix:** Require zero workspaces before repo deletion.

1. CAS repo status `active` → `deleting` (atomic)
2. Check `WS/{repo}` — if any workspaces exist, CAS `deleting` → `active` and reject with error
3. Make `workspaceWrite` check repo status is `active` via `TransactWriteItems` + ConditionCheck on `REPO SK={repo}` (DynamoDB-specific, no e3-core interface change)

This eliminates the race: once status is `deleting`, no new workspaces can be created. And since deletion requires zero workspaces, there are no in-flight executions to race with. Users must explicitly delete all workspaces before deleting a repo.
