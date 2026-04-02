# Package Structure Proposals

Generated 2026-02-20 from audit of e3-cloud AWS packages.

## Current State Problems

1. GC handlers (gc-mark, gc-sweep, gc-cleanup, gc-scheduler, set-status) are in e3-aws-api but are Step Functions handlers, not API routes
2. SfnDataflowOrchestrator exists in both e3-aws-storage and e3-aws-api (re-export + real impl)
3. e3-aws-runner mixes Lambda handlers AND Fargate entrypoint code
4. e3-aws-api is a "junk drawer" — API handlers, auth, AND orchestration

## Proposal 1: By Deployment Artifact (8 packages)

Organize by what gets deployed as a single unit.

- `e3-aws-auth/` — Cognito auth routes only
- `e3-aws-api-routes/` — Composition root mounting e3-cloud-core routes
- `e3-aws-sfn-handlers/` — All Step Functions Lambda handlers (dataflow + GC)
- `e3-aws-fargate-runner/` — Fargate container entrypoint only
- `e3-aws-storage/` — Unchanged
- `e3-cloud-core/` — Unchanged
- `e3-cloud-types/` — Unchanged

Pros: Clear deployment boundaries, minimal cold start. Cons: SFN package is large, shared logic between Lambda/Fargate needs care.

## Proposal 2: By Responsibility Domain (10 packages)

Group by business capability.

- `e3-aws-dataflow/` — Orchestrator + all dataflow handlers
- `e3-aws-gc/` — Orchestrator + all GC handlers
- `e3-aws-auth/` — Cognito + auth middleware
- `e3-aws-scheduling/` — EventBridge Scheduler
- `e3-aws-api/` — Only composition root
- `e3-aws-compute/` — Shared execute-task-core + Fargate entrypoint
- `e3-aws-storage/` — Unchanged

Pros: Natural ownership boundaries, independent release cycles. Cons: Cross-domain dependencies, more packages to maintain.

## Proposal 3: By Deployment Stage (9 packages)

Separate Lambda (cold-start sensitive) from Fargate (long-running).

- `e3-aws-lambda/` — All Lambda handlers (API + SFN + GC)
- `e3-aws-fargate/` — Fargate-only code
- `e3-aws-compute-shared/` — Shared between Lambda and Fargate
- `e3-aws-storage/` — Unchanged

Pros: Explicit cold-start awareness. Cons: Doesn't fully solve junk drawer problem.

## Proposal 4: Layered (Recommended) (11 packages)

Dependency-directed layers: interfaces -> implementations -> composition roots.

### Layer 1 — Abstractions (cloud-agnostic)
- `e3-cloud-types/` — Request/response types
- `e3-cloud-core/` — Interfaces + route factories

### Layer 2 — Implementations (AWS-specific, no composition)
- `e3-aws-storage/` — S3+DynamoDB stores
- `e3-aws-orchestrators/` — SfnDataflowOrchestrator, SfnGcOrchestrator
- `e3-aws-services/` — Cognito auth, EventBridge scheduler
- `e3-aws-handlers-sfn/` — All Step Functions handlers (dataflow/ + gc/ subdirs)
- `e3-aws-handlers-fargate/` — Fargate container entrypoint

### Layer 3 — Composition Roots
- `e3-aws-api/` — Only Hono app assembly, mounts all routes

### Shared (all clouds)
- `e3-cloud-client/`, `e3-cloud-tests/`, `e3-cloud-cli/`

Pros: Clearest "where does my code go?", best Azure/GCP readiness, single composition root, no junk drawers. Cons: More packages (11), requires discipline.

## Comparison

| Aspect | 1: Artifact | 2: Domain | 3: Stage | 4: Layered |
|--------|-------------|-----------|----------|------------|
| Clarity | 4/5 | 4/5 | 3/5 | 5/5 |
| Azure/GCP Ready | 3/5 | 4/5 | 3/5 | 5/5 |
| Cold Start | 4/5 | 3/5 | 4/5 | 4/5 |
| Package Count | 8 | 10 | 9 | 11 |
| Scalability | Medium | High | High | High |

## Migration Path (for Proposal 4)

1. Extract orchestrators -> `e3-aws-orchestrators/`
2. Extract services (Cognito, EventBridge) -> `e3-aws-services/`
3. Move GC handlers -> `e3-aws-handlers-sfn/src/gc/`
4. Move Fargate entrypoint -> `e3-aws-handlers-fargate/src/main.ts`
5. Simplify e3-aws-api to composition root only
