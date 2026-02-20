# @elaraai/e3-aws

Unified AWS implementation for the e3 cloud platform. Contains storage backends, AWS service integrations, and Lambda/Fargate handler entry points.

## Structure

```
src/
├── storage/          # S3 + DynamoDB storage implementations
│   ├── s3-dynamo-storage.ts          # Main StorageBackend (S3 objects + DynamoDB refs)
│   ├── s3-object-store.ts            # S3 ObjectStore implementation
│   ├── dynamo-ref-store.ts           # DynamoDB RefStore + DataflowRunStore
│   ├── dynamo-lock-service.ts        # DynamoDB distributed locking
│   ├── dynamo-log-store.ts           # DynamoDB log store
│   ├── dynamo-acl-store.ts           # DynamoDB ACL store
│   ├── dynamo-schedule-store.ts      # DynamoDB schedule store
│   ├── dynamo-task-config-store.ts   # DynamoDB task config store
│   ├── dynamo-compute-result-store.ts # DynamoDB compute result store
│   ├── dynamo-state-store.ts         # DynamoDB execution state store
│   ├── dynamo-s3-repo-store.ts       # DynamoDB + S3 repo store
│   ├── init.ts                       # Singleton initialization helpers
│   └── index.ts                      # Storage exports
│
├── services/         # AWS service implementations
│   ├── sfn-dataflow-orchestrator.ts  # Step Functions DataflowOrchestrator
│   ├── sfn-gc-orchestrator.ts        # Step Functions GcOrchestrator
│   ├── eventbridge-scheduler.ts      # EventBridge SchedulerService
│   ├── cognito-identity.ts           # Cognito IdentityBackend
│   ├── cognito-device-flow.ts        # OAuth 2.0 Device Flow proxy
│   └── cognito-discovery.ts          # OIDC discovery endpoint
│
├── handlers/         # Lambda and Fargate entry points
│   ├── api.ts                        # API Lambda composition root
│   ├── pre-token-generation.ts       # Cognito pre-token Lambda trigger
│   ├── sfn/                          # Step Functions state machine handlers
│   │   ├── get-graph.ts              # Build dependency graph
│   │   ├── get-ready.ts              # Find ready tasks
│   │   ├── dispatch-task.ts          # Dispatch with compute/timeout config
│   │   ├── execute-task.ts           # Lambda task execution
│   │   ├── execute-task-core.ts      # Shared execution logic
│   │   ├── collect-compute-result.ts # Collect Fargate results
│   │   ├── apply-results.ts          # Apply task results
│   │   ├── apply-tree-updates.ts     # Propagate tree changes
│   │   ├── check-completion.ts       # Poll completion status
│   │   ├── mark-skipped.ts           # Mark skipped dependents
│   │   ├── finalize-execution.ts     # Finalize dataflow run
│   │   └── schedule-trigger.ts       # Scheduled execution trigger
│   ├── gc/                           # GC state machine handlers
│   │   ├── gc-mark.ts                # Mark reachable objects
│   │   ├── gc-sweep.ts               # Sweep unreachable catalogue entries
│   │   ├── gc-cleanup.ts             # Cleanup orphaned S3 versions
│   │   ├── gc-scheduler.ts           # Scheduled GC for all repos
│   │   └── set-status.ts             # Repo status transitions
│   └── fargate/                      # Fargate container entry points
│       └── main.ts                   # Fargate task execution
│
└── index.ts          # Package exports
```

## DynamoDB Schema

The DynamoDB table uses a single-table design with PK/SK composite keys. Key patterns:
- `REPO / {repo}` — Repository metadata and status
- `{repo}#REF / {ref}` — Git-like refs (branches, HEAD)
- `{repo}#OBJ / {hash}` — Object catalogue entries
- `ACL#{repo} / {sub}` — Access control entries
- `SCHEDULE#{repo}#{ws} / #META` — Schedule configuration
- `TASKCONFIG#{repo}#{ws} / {type}#{task}` — Task compute/timeout config
- `DEVICE#{code} / #META` — Device flow codes

## Testing

```bash
# Build
npm run build

# Run unit tests (29 tests for SFN handlers)
npm test
```
