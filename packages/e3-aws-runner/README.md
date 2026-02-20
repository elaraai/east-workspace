# @elaraai/e3-aws-runner

Task execution handlers for the e3 dataflow state machine (Step Functions). Supports both Lambda (serverless) and ECS Fargate (sized compute) execution paths.

## Handlers

| Handler | Description |
|---------|-------------|
| `get-graph` | Resolves task dependency graph from deployed workspace |
| `get-ready` | Finds tasks ready to execute (all inputs available) |
| `dispatch-task` | Checks cache, reads compute/timeout config, dispatches task |
| `execute-task` | Lambda entry point for serverless task execution |
| `execute-task-compute-entry` | Fargate entry point for sized compute execution |
| `execute-task-core` | Shared task execution logic (used by both entry points) |
| `collect-compute-result` | Reads Fargate task results from DynamoDB |
| `apply-results` | Applies task execution results to workspace state |
| `apply-tree-updates` | Propagates dependency tree state changes |
| `check-completion` | Checks if all tasks in the dataflow are complete |
| `mark-skipped` | Marks downstream tasks as skipped after upstream failure |
| `finalize-execution` | Finalizes dataflow run (success or failure) |
| `schedule-trigger` | Handles scheduled execution triggers from EventBridge |

## Execution Paths

**Serverless (Lambda):** Default path. Task runs inside the Lambda container with a 15-minute timeout.

**Sized Compute (Fargate):** For tasks configured with a compute size (small/medium/large/xlarge). The state machine routes through `ChooseExecutor` → `EcsRunTask` → `CollectComputeResult`. The Fargate container uses the same Docker image with a different entry point (`execute-task-compute-entry`), writes its result to DynamoDB, and the `collect-compute-result` Lambda reads it back for the state machine.

## Structure

```
src/
├── index.ts                          # Handler exports
└── handlers/
    ├── get-graph.ts                  # Resolve task dependency graph
    ├── get-ready.ts                  # Find tasks ready to execute
    ├── dispatch-task.ts              # Check cache, dispatch task
    ├── execute-task.ts               # Lambda entry point
    ├── execute-task-core.ts          # Shared execution logic
    ├── execute-task-compute-entry.ts # Fargate entry point
    ├── collect-compute-result.ts     # Read Fargate results from DynamoDB
    ├── apply-results.ts              # Apply task results to workspace
    ├── apply-tree-updates.ts         # Propagate tree state changes
    ├── check-completion.ts           # Check if dataflow is complete
    ├── mark-skipped.ts               # Mark tasks with unavailable inputs
    ├── finalize-execution.ts         # Finalize dataflow run
    ├── schedule-trigger.ts           # EventBridge scheduled trigger
    └── test-helpers.ts               # Shared test utilities
```

## License

BSL-1.1 - See LICENSE.md
