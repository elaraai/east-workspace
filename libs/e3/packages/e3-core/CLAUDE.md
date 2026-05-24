# e3-core

Programmatic API for e3 repository operations: repository, objects,
packages, workspaces, dataflow, executions. Plus the pluggable storage,
execution, and transfer backend interfaces.

This is the "libgit2" of e3 — everything `e3-cli` and `e3-api-server`
do is implemented here.

## Key abstractions

- `StorageBackend` — abstracts object/dataset-ref storage (local FS
  today; S3/DynamoDB or EFS in cloud deployments).
- `TaskRunner` — abstracts task execution. `LocalTaskRunner` spawns
  local processes; `MockTaskRunner` is used in tests.
- `DataflowOrchestrator` (e.g. `LocalOrchestrator`) — drives a
  resumable dataflow execution using a pluggable `ExecutionStateStore`
  (`InMemoryStateStore`, `FileStateStore`).
- `TransferBackend` — abstracts large-object upload/download for remote
  repos.

## See also

- [`../../CLAUDE.md`](../../CLAUDE.md) — e3 lib-level overview with the
  full concept glossary.
- [`../../design/e3-core.md`](../../design/e3-core.md) — core design
  spec.
- [`../../design/e3-execution.md`](../../design/e3-execution.md) +
  [`e3-execution-history.md`](../../design/e3-execution-history.md) —
  execution and provenance tracking.
- [`../../design/e3-reactive-dataflow.md`](../../design/e3-reactive-dataflow.md)
  — reactive execution, per-dataset refs, version vectors.
- [`../../design/repo-manager-abstraction.md`](../../design/repo-manager-abstraction.md)
  + [`task-runner-implementation.md`](../../design/task-runner-implementation.md)
  — storage/execution abstractions.
