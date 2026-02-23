# Chain Dataflow Performance Results

Benchmarks for serial-chain dataflows (A -> B -> C -> ...) measuring Step Functions orchestration overhead per task.

Each task is trivial (adds 1 to an integer) so execution time is negligible — these numbers reflect pure orchestration cost.

**Environment:** dev (ap-southeast-2), 2026-02-18

## Serverless (Lambda)

### Summary

| Chain | Total | Per-task loop avg | GetGraph | Finalize |
|-------|-------|-------------------|----------|----------|
| 3 tasks | 5.9s | 1,073ms | 384ms | 597ms |
| 5 tasks | 8.2s | 1,221ms | 390ms | 212ms |
| 10 tasks | 15.4s | 1,310ms | 699ms | 234ms |

All runs were warm (Lambdas already initialized from a prior run).

### Chain 3 — Serverless (warm)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 |
|------|--------|--------|--------|--------|
| GetReadyState | 132ms | 95ms | 175ms | 124ms |
| DispatchTasksMap | 1,091ms | 1,053ms | 1,068ms | - |
| ApplyResultsState | 152ms | 182ms | 118ms | - |
| ApplyTreeUpdatesState | 219ms | 195ms | 210ms | - |
| **Iteration total** | **1,594ms** | **1,525ms** | **1,571ms** | **124ms** |

GetGraph: 384ms | Finalize: 597ms | **Total: 5,855ms**

### Chain 5 — Serverless (warm)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|------|--------|--------|--------|--------|--------|--------|
| GetReadyState | 88ms | 116ms | 148ms | 164ms | 97ms | 98ms |
| DispatchTasksMap | 1,024ms | 986ms | 970ms | 1,069ms | 1,071ms | - |
| ApplyResultsState | 136ms | 128ms | 202ms | 195ms | 167ms | - |
| ApplyTreeUpdatesState | 188ms | 161ms | 183ms | 161ms | 188ms | - |
| **Iteration total** | **1,436ms** | **1,391ms** | **1,503ms** | **1,589ms** | **1,523ms** | **98ms** |

GetGraph: 390ms | Finalize: 212ms | **Total: 8,188ms**

### Chain 10 — Serverless (warm)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 | Iter 6 | Iter 7 | Iter 8 | Iter 9 | Iter 10 |
|------|--------|--------|--------|--------|--------|--------|--------|--------|--------|--------|---------|
| GetReadyState | 108ms | 251ms | 121ms | 99ms | 101ms | 81ms | 91ms | 100ms | 96ms | 106ms | 86ms |
| DispatchTasksMap | 839ms | 1,070ms | 967ms | 984ms | 1,051ms | 1,098ms | 936ms | 1,008ms | 1,010ms | 974ms | - |
| ApplyResultsState | 178ms | 157ms | 113ms | 157ms | 119ms | 114ms | 127ms | 149ms | 148ms | 152ms | - |
| ApplyTreeUpdatesState | 225ms | 217ms | 175ms | 239ms | 166ms | 166ms | 176ms | 167ms | 166ms | 159ms | - |
| **Iteration total** | **1,350ms** | **1,695ms** | **1,376ms** | **1,479ms** | **1,437ms** | **1,459ms** | **1,330ms** | **1,424ms** | **1,420ms** | **1,391ms** | **86ms** |

GetGraph: 699ms | Finalize: 234ms | **Total: 15,422ms**

### Cold vs Warm (Chain 5)

| Metric | Cold | Warm | Delta |
|--------|------|------|-------|
| Total wall time | 18.1s | 9.9s | -45% |
| Iteration 0 | 8,087ms | 2,277ms | -72% |
| GetGraph | 1,732ms | 572ms | -67% |
| Finalize | 1,813ms | 719ms | -60% |
| Per-task loop avg | 1,278ms | 1,258ms | ~same |

## Fargate Medium — WAIT_FOR_TASK_TOKEN (current)

Uses `WAIT_FOR_TASK_TOKEN` callback pattern: the container calls `SendTaskSuccess`/`SendTaskFailure` after writing results to DynamoDB, unblocking Step Functions before container deprovisioning completes.

### Summary

| Chain | Total | Per-task loop avg | GetGraph | Finalize |
|-------|-------|-------------------|----------|----------|
| 3 tasks | 11.3min (676s) | 148,246ms (~2.5min) | 1,639ms | 1,784ms |
| 5 tasks | 17.8min (1,067s) | 168,060ms (~2.8min) | 483ms | 205ms |

All Fargate tasks are cold (no warm container reuse — each task provisions a new container).

### Chain 3 — Fargate Medium (WAIT_FOR_TASK_TOKEN)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 |
|------|--------|--------|--------|--------|
| GetReadyState | 151ms | 146ms | 178ms | 225ms |
| DispatchTasksMap | 227,161ms | 222,188ms | 220,810ms | - |
| ApplyResultsState | 146ms | 307ms | 257ms | - |
| ApplyTreeUpdatesState | 502ms | 343ms | 283ms | - |
| **Iteration total** | **227,960ms** | **222,984ms** | **221,528ms** | **225ms** |

GetGraph: 1,639ms | Finalize: 1,784ms | **Total: 676,179ms (11.3min)**

### Chain 5 — Fargate Medium (WAIT_FOR_TASK_TOKEN)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|------|--------|--------|--------|--------|--------|--------|
| GetReadyState | 114ms | 105ms | 152ms | 88ms | 142ms | 147ms |
| DispatchTasksMap | 225,221ms | 220,033ms | 178,231ms | 223,512ms | 216,412ms | - |
| ApplyResultsState | 175ms | 196ms | 137ms | 104ms | 187ms | - |
| ApplyTreeUpdatesState | 261ms | 257ms | 199ms | 171ms | 227ms | - |
| **Iteration total** | **225,771ms** | **220,591ms** | **178,719ms** | **223,875ms** | **216,968ms** | **147ms** |

GetGraph: 483ms | Finalize: 205ms | **Total: 1,066,808ms (17.8min)**

### Fargate time breakdown per task

The DispatchTasksMap step for Fargate includes the ECS task lifecycle up to callback:

| Phase | Duration | Notes |
|-------|----------|-------|
| dispatch-task Lambda | ~200ms | Cache check, input resolution |
| ECS RunTask API call | ~1s | Start task provisioning |
| Fargate provisioning | ~150-220s | Image pull (SOCI), ENI attach, container start |
| Task execution | <1s | Trivial task (add 1) |
| DynamoDB write + SendTaskSuccess | ~50ms | Callback unblocks Step Functions |
| collect-compute-result Lambda | ~200ms | Read result from DynamoDB |
| **Total per task** | **~155-225s (~2.5-3.7min)** | |

The `WAIT_FOR_TASK_TOKEN` callback pattern eliminates the ~27s ECS deprovisioning wait that was present with `RUN_JOB` (.sync). The container calls `SendTaskSuccess` immediately after writing results, and Step Functions continues before ENI teardown.

## Fargate Medium — RUN_JOB (previous baseline)

Previous results using `RUN_JOB` (.sync) pattern where Step Functions waits for the full ECS task lifecycle including deprovisioning.

### Summary

| Chain | Total | Per-task loop avg | GetGraph | Finalize |
|-------|-------|-------------------|----------|----------|
| 3 tasks | 12.5min (748s) | 164,291ms (~2.7min) | 1,701ms | 1,813ms |
| 5 tasks | 20.7min (1,242s) | 198,384ms (~3.3min) | 1,717ms | 1,910ms |

### Chain 3 — Fargate Medium (RUN_JOB)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 |
|------|--------|--------|--------|--------|
| GetReadyState | 1,412ms | 1,471ms | 376ms | 383ms |
| DispatchTasksMap | 247,411ms | 237,812ms | 249,309ms | - |
| ApplyResultsState | 1,307ms | 1,349ms | 273ms | - |
| ApplyTreeUpdatesState | 1,560ms | 1,557ms | 344ms | - |
| **Iteration total** | **251,690ms** | **242,189ms** | **250,302ms** | **383ms** |

GetGraph: 1,701ms | Finalize: 1,813ms | **Total: 748,141ms (12.5min)**

### Chain 5 — Fargate Medium (RUN_JOB)

| Step | Iter 0 | Iter 1 | Iter 2 | Iter 3 | Iter 4 | Iter 5 |
|------|--------|--------|--------|--------|--------|--------|
| GetReadyState | 154ms | 210ms | 207ms | 211ms | 192ms | 179ms |
| DispatchTasksMap | 245,940ms | 248,398ms | 243,900ms | 250,668ms | 245,780ms | - |
| ApplyResultsState | 275ms | 232ms | 224ms | 250ms | 218ms | - |
| ApplyTreeUpdatesState | 382ms | 347ms | 301ms | 313ms | 290ms | - |
| **Iteration total** | **246,751ms** | **249,187ms** | **244,632ms** | **251,442ms** | **246,480ms** | **179ms** |

GetGraph: 1,717ms | Finalize: 1,910ms | **Total: 1,242,355ms (20.7min)**

## RUN_JOB vs WAIT_FOR_TASK_TOKEN Comparison

| Metric | RUN_JOB | WAIT_FOR_TASK_TOKEN | Improvement |
|--------|---------|---------------------|-------------|
| Chain-3 total | 748s (12.5min) | 676s (11.3min) | -10% (-72s) |
| Chain-5 total | 1,242s (20.7min) | 1,067s (17.8min) | -14% (-175s) |
| Chain-3 per-task DispatchMap avg | 244,844ms | 223,386ms | -21.5s/task |
| Chain-5 per-task DispatchMap avg | 246,937ms | 212,682ms | -34.3s/task |

The savings come from eliminating the ~27s ECS deprovisioning wait per task. Actual savings vary due to provisioning time variance between runs.

## Serverless vs Fargate Comparison

| Metric | Serverless | Fargate Medium (callback) | Ratio |
|--------|-----------|---------------------------|-------|
| Per-task loop (warm) | 1.3s | 222s | 171x |
| Chain-3 total | 5.9s | 676s | 115x |
| Chain-5 total | 8.2s | 1,067s | 130x |
| Orchestration overhead | ~300ms | ~300ms | same |
| Execution overhead | ~1,000ms | ~221,000ms | 221x |

The orchestration steps (GetReady, ApplyResults, ApplyTreeUpdates, Finalize) are the same speed. The entire difference is in DispatchTasksMap, which is dominated by Fargate cold start provisioning (~150-220s).

## Analysis

### Per-task loop cost breakdown (warm averages)

| Step | Duration | Share |
|------|----------|-------|
| DispatchTasksMap (dispatch + execute) | ~1,000ms | 73% |
| ApplyTreeUpdatesState | ~180ms | 13% |
| ApplyResultsState | ~150ms | 11% |
| GetReadyState | ~110ms | 8% |
| CheckReadyTasks, AfterMapLoop | ~0ms | 0% |
| **Total per-task loop** | **~1,300ms** | |

### Scaling model

```
total ~ 0.5s (GetGraph) + 1.3s x N (loop iterations) + 0.3s (Finalize)
```

| Chain | Predicted | Actual | Error |
|-------|-----------|--------|-------|
| 3 | 4.7s | 5.9s | +25% |
| 5 | 7.3s | 8.2s | +12% |
| 10 | 13.8s | 15.4s | +12% |

The ~12-25% gap comes from the final empty GetReady + IsAllComplete iteration and per-iteration variance.

### Bottleneck

`DispatchTasksMap` at ~1s accounts for 73% of per-task overhead. This includes:
- Step Functions Map state setup
- Lambda invoke for dispatch-task
- Lambda invoke for execute-task (or cache check)
- Map state result collection

The actual task execution (adding 1 to an integer) is <1ms — the entire 1s is Lambda invoke + Step Functions orchestration overhead.

## Future Work: ECS Workers

The current Fargate task model launches a fresh container per task, paying ~150s cold start each time. An ECS worker model would keep containers warm between tasks:

- **ECS Service per compute size** (desiredCount: 0) with SQS queue for job dispatch
- **Scale-to-zero:** Lambda-driven scaling (set desiredCount to 1 on first message), worker self-terminates after idle timeout
- **Warm start performance:** 892ms total vs 150s cold start (228x speedup, tested in warm worker experiment 2026-02-18)
- **Step Functions integration:** Same WAIT_FOR_TASK_TOKEN pattern — worker picks job from SQS, executes, calls SendTaskSuccess
- **Fixed costs:** ~$0.40/month in CloudWatch alarms; compute rates identical to Fargate tasks
- **Complexity tradeoff:** Requires building scaling logic and failure handling (currently handled by AWS for Fargate tasks)
