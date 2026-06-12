# Overview

## Structure

This is a pnpm workspace (nested inside the outer east-workspace pnpm monorepo) containing the e3 (East Execution Engine) packages.
The directory structure is:

 - packages/e3-types - Shared East/TypeScript type definitions (API wire types, dataset refs, package objects, execution state)
 - packages/e3 - TypeScript SDK for authoring e3 packages (`e3.input`, `e3.task`, `e3.package`, `e3.export`)
 - packages/e3-core - Core library (like libgit2): repository, objects, packages, workspaces, dataflow, executions, storage/execution/transfer backends
 - packages/e3-cli - CLI tool (`e3 repo|package|workspace|list|get|set|run|start|watch|logs|convert|login`)
 - packages/e3-api-client - Stateless HTTP client for remote e3 repositories (BEAST2-serialized)
 - packages/e3-api-server - HTTP server exposing e3-core as a REST API
 - packages/e3-api-tests - Shared API compliance test suites (run against both e3-api-server and e3-cloud)
 - test/integration - End-to-end CLI tests
 - design - Design documentation (see design/e3-mvp.md for overview)

## Purpose

e3 allows users to create and execute end-to-end business solutions, tying together data integrations, simulation, optimization, machine learning and dashboards into holistic dataflow programs.

A single solution may involve NodeJS for integrations, python for machine learning and Julia for native-speed simulations.
The East language provides a structural type system and standardized serialization formats for communications between different runtimes.
An e3 repository holds and manages datasets and East programs, and automatically orchestrates dataflow tasks so the user does not need to worry about "plumbing".

## Concepts

 - **e3 repository** - a git-inspired directory structure with a SHA256 content-addressed object store
 - **package** - an immutable collection of East IR, tasks, datasets and dataflows
 - **workspace** - a package is deployed to a workspace, where input datasets can be mutated and automated dataflow executed (with consistency guarantees)
 - **runner** - a program that e3 can spawn to execute a task
 - **IR** - East's intermediate representation, representing an East program that has passed through East's front-end compiler
 - **dataset** - like git, workspace data is stored in a "tree" with datasets as the leaves - each dataset has a "path" and a fixed East type
 - **task** - a combination of a runner (an East interpretter or JIT compiler) and inputs datasets to be provided (both East IR and input data to the task)
 - **dataflow** - the DAG of tasks and datasets to be executed in a workspace
 - **execution** - a single run of a task, identified by `(taskHash, inputsHash, executionId)` where executionId is a UUIDv7
 - **dataflow run** - a complete execution of a workspace's dataflow, tracking which task executions were used
 - **per-dataset ref** - each dataset has its own atomic `.ref` file (`workspaces/<ws>/data/<path>.ref`) instead of a single root tree hash, enabling concurrent per-dataset writes
 - **version vector** - a `Map<string, string>` tracking which root input content hashes contributed to each dataset, used to detect stale reads in diamond dependencies
 - **reactive execution** - after each task completes, the orchestrator detects root input changes, invalidates affected tasks, and re-executes until a fixpoint is reached
 - **storage backend** - `StorageBackend` interface in e3-core abstracts object/dataset-ref storage (local filesystem today; S3/DynamoDB or EFS in cloud deployments)
 - **task runner** - `TaskRunner` interface in e3-core abstracts task execution; `LocalTaskRunner` spawns local processes, `MockTaskRunner` is used in tests
 - **orchestrator** - `DataflowOrchestrator` (e.g. `LocalOrchestrator`) drives a resumable dataflow execution using a pluggable `ExecutionStateStore` (`InMemoryStateStore`, `FileStateStore`)
 - **transfer backend** - `TransferBackend` abstracts large-object upload/download for remote repos (used by API client/server and package/dataset transfer endpoints)
 - **repo manager** - abstraction for repository lifecycle (list, create, delete, status); see design/repo-manager-abstraction.md

## Commands

Build/test/lint are orchestrated by pnpm at the workspace root, but each lib also has a Makefile:

```bash
# From libs/e3
make build   # build all packages in dependency order
make test    # run all tests
make lint    # run eslint
```

Install deps from the workspace root (`pnpm install` there, not here).

## References

Instructions in STANDARDS.md must be followed at all times.

See USAGE.md for how to use e3 as an end user.
See SKILL.md for the authoring cheat-sheet (matches the `east:e3` skill).
See VIEWER.md for the `e3 view` TUI design.
See design/e3-mvp*.md for the current design spec.
See design/e3-core.md, design/e3-api.md, design/e3-cli.md for per-package design notes.
See design/e3-execution.md and design/e3-execution-history.md for execution and provenance tracking.
See design/e3-reactive-dataflow.md for reactive execution, per-dataset refs, and version vectors.
See design/e3-dataset-status.md for dataset/task status semantics.
See design/e3-watch.md for the `e3 watch` file-watching workflow.
See design/e3-ui.md for first-class UI tasks (Data bindings, `e3.ui()`).
See design/e3-functions.md for named package functions (`e3.function`) and graph-free / one-shot execution.
See design/repo-manager-abstraction.md and design/task-runner-implementation.md for the storage/execution abstractions.

You can find the East language implementation at ../east
