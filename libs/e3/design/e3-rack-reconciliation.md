# Rack delegation: reconciliation of epic #863

Status: implementation reconciliation for the working branch. The
[design of record](e3-rack-delegation.md) describes the resulting implementation;
this review records the corrections to the original issue text. Hardware and
intermittent-agent acceptance are not claimed.

Reviewed on 2026-10-09 against east-workspace `0f28b515e` (1.0.85) and
[e3-cloud `43d9ac9d9`](https://github.com/elaraai/e3-cloud/tree/43d9ac9d9a423b69450320f6a802a8191ffefd53).
The implementation targets that current cloud protocol, as requested, rather
than the historical protocol described by #863–#873. All ten child bodies
were read; none had comments at the time of review.

The PR review also integrates east-workspace `0327d2419` (1.0.86), the
intervening release-only main commit. The new package follows that existing
release; cloud's pinned protocol remains unchanged. Enrollment requests the
session's current e3 release explicitly through `--e3-version`, and older
agents whose bundled release cannot boot it are excluded from delegation.

The topology and scope stand: one machine-local hub, direct rack-to-machine
traffic over a private network, repository access in sessions, opt-in task
routing, local planning, and local fallback for infrastructure failures.
Custom environments, local function delegation, reconnect after hub restart,
TLS, and embedded UI server integration remain deferred.

## Changes required in each child

| Issue | Required correction |
| --- | --- |
| [#864](https://github.com/elaraai/east-workspace/issues/864): execution hook | Preserve `LocalTaskRunner(repo, budget?, settings?)`. Add the hook without replacing the budget argument. Route both `taskExecute` and `taskExecuteUnit`, plus the standalone split-task driver's units. Carry a unit's `merge` and `own`, not just input hashes. The current engine replaces the old `executeTemplate` design. Pass `taskName` to plain tasks and units. `ExecutionIds` is already exported; the atomic helpers still need exports. |
| [#865](https://github.com/elaraai/east-workspace/issues/865): package and foundations | Port current wire definitions, including heartbeat `cacheBytes`, storage `outputs`/`commits`, response `targets`/`committed`, and their object-size, commit and write-target types. Port `RackLeaseEvent` v2 and `RackLeaseResult`, not removed `TaskExecutionEvent`/`TaskExecutionResult`. Lease records now carry claim attempts and issued write targets; the store includes `recordTargets`. Keep cloud-compatible method signatures. |
| [#866](https://github.com/elaraai/east-workspace/issues/866): routes and dispatch | `cancel` already exists. Preserve `leaseHeld`, v2 refusal, attempt creation on claim, reclaimed-attempt termination, outcome recording, log flush, whole-output verification, write cleanup and the optional cloud wake callback. The bridge's content-addressed PUT/commit methods are distinct from its retained whole-output staging methods. Replace the former env/function agent gates with current `LEASE_MIN_AGENT`. |
| [#867](https://github.com/elaraai/east-workspace/issues/867): routing | Scan `task.body.value.program`, not a `function_ir` input. Scan dict merge and fold combine programs from `task.output.kind`; a fold's zero is a value, not IR. `decodePartitionTaskMetadata` and the assumed input layout no longer describe current tasks. A merge unit must be eligible even when earlier map units were cached. Keep the local host-access guard stricter than cloud's. |
| [#868](https://github.com/elaraai/east-workspace/issues/868): hub | Replace the legacy lease-create payload with the current task/unit event and a session-computed object closure. Add session operations for attempt lifecycle, closure reads, output verification/touch and lease-scoped object uploads. The hub must not decode repository objects or construct version-specific execution records. Use claim-time attempt IDs in events and dedupe. |
| [#869](https://github.com/elaraai/east-workspace/issues/869): client | Update `LeaseHandle`/events for an attempt that is assigned at claim and changes on reclaim. Replay current claim state to late subscribers; retain events arriving before the create response. Bound and abort requests and long polls on close/loss. A numeric `hub.protocol >= client.protocol` alone does not establish BEAST2 schema compatibility. |
| [#870](https://github.com/elaraai/east-workspace/issues/870): runner | Use the current `Budget`, `ExecutionAttempt`, execution liveness and result fields. Preserve `unit`, `peakBytes`, `plan: none`, owner-before-running and log-before-terminal ordering. Cancellation is a `cancelled` record, not an `error` record. Classify outcomes using `state` and `cancelled` before exit-code heuristics. A local fallback has its own attempt; do not overwrite a shared rack attempt. |
| [#871](https://github.com/elaraai/east-workspace/issues/871): CLI | Extend the existing `Budget:` output and use orchestrator `width`, not removed `jobs`, `concurrency` or `partitionConcurrency` options. Reuse the watch's budget for deployment and every run. Preserve force-task selection, cancellation and cleanup. Confirm the printed install flags against the current agent; document that GPU assignment is opportunistic. |
| [#872](https://github.com/elaraai/east-workspace/issues/872): API server | Extend the existing `DataflowSeams`/`localDataflow` architecture. The portable `startDataflow` no longer owns a process-local active-execution map or completion handlers. Own per-run rack leases in local wiring, close after `wait()` settles and on failed start, and reuse the server's one budget. Keep Node/rack imports out of portable routes. Test absent optional ESM dependencies using an isolated installation, not `NODE_PATH`. |
| [#873](https://github.com/elaraai/east-workspace/issues/873): documentation | Document current event/transfer/attempt semantics, budget and width, actual companion prerequisites, and exact compatibility boundaries. Regenerate the shared plugin index and both Claude and Codex artifacts: current CI checks all three locations, plus materialized Codex skills. |

## Current protocol and its extraction boundary

Cloud's completed [#205](https://github.com/elaraai/e3-cloud/issues/205) and
[#214](https://github.com/elaraai/e3-cloud/issues/214) are prerequisites of
the local-hub work. They have already replaced the execution described in the
old epic. The authoritative modules are:

- `packages/e3-cloud-types/src/rack-protocol-types.ts` and the rack subset of
  `delegation-types.ts`;
- `packages/e3-cloud-core/src/rack/rack-lease-event.ts`, `rack-lease-store.ts`,
  `rack-dispatch.ts`, `store-rack-dispatch.ts`, `rack-storage-bridge.ts`,
  `lease-closure.ts` and `rack-attempts.ts`;
- `packages/e3-cloud-core/src/routes/rack-routes.ts`;
- the task/unit/detached event contracts in `src/steps/runner-event.ts`.

The extraction must retain v2 `runnerEvent` (`task`, `unit` or `run-detached`),
`launchId`, `timeoutMs`, the whole `SplitUnit` (`inputs`, `merge`, `own`),
runtime version and closure. Results include `state`, `peakBytes` and
`cancelled`. Function protocol support remains available to the cloud even
though the local CLI does not delegate function calls.

Shared routes now consume cloud-specific attempt and launch machinery. Move
the protocol and mechanism, but inject the backend operations for claim,
completion, interruption, output verification and wake. Cloud supplies its
launch stamps and AWS implementation; the hub forwards those operations to
a live session. Do not add a dependency on the closed cloud package or make
the hub itself a repository reader.

Golden fixtures must be generated from these pinned current types and checked
against the port. Do not generate both sides from the new definitions: that
would test self-consistency, not compatibility.

## Object transfer is a graph, not one input and one output file

A lease's readable closure includes the task, program, output reducers,
staged inputs and all objects those inputs need: collection headers and
segments, record primaries, and merge ranges/parts. The session computes it
with its own e3 version. Large closures use a stored closure list; the hub
must delegate reading that list rather than decode the session's store.

The agent declares each written object's hash and size, receives `held` or a
PUT target with headers, uploads, and commits the returned version. The
current uploader **requires `x-amz-version-id` in the PUT response**, even for
a non-S3 URL. The local bridge must return an opaque upload receipt in that
header and check it on commit. This is protocol compatibility, not a reason
to use S3.

Bind targets and receipts to the repository, lease, hash and size. Verify
bytes while streaming to repository-local staging; commit only while the
lease is held. Retries must recover the same successful upload/commit after
a lost response. Delete uncommitted staging when a lease ends, without
deleting any adopted object. Recheck capability authorization when a lease
ends; a 15-minute URL lifetime is not permission to commit after cancellation.

Before reporting success, verify and re-reference the entire output graph
through the session (`touchReachable`), not merely `objects.exists(root)`.
This also preserves the current concurrent-GC contract. Flush logs before
the terminal record and completion event. `readRange`, `adoptFile`, `touch`
and log `flush` are current required backend methods; the proposed optional
fallbacks are obsolete.

Raw streamed object GET/PUT bodies are a necessary exception to the epic's
"every HTTP body is a ResponseType envelope" statement. Control/protocol
responses use BEAST2; legacy `eventJson`/`resultJson` remain JSON strings.
Current cloud auth errors are JSON non-2xx responses as well: explicitly
test any change to those error bodies rather than call it a verbatim port.

## Attempts, deduplication and cancellation

The cloud mints an attempt on **claim**, and another on **reclaim**. Logs are
addressed by that attempt, not an event's old `taskExecutionId`. Accordingly:

1. Lease creation returns a lease identity and subscription. A claim event
   identifies the attempt and its start time; completion identifies the
   attempt whose result won.
2. One session-side writer owns the shared attempt's records. Subscribers
   consume its outcome; they do not race to rewrite the same record.
3. A late subscriber receives the current claim before completion. When one
   subscriber cancels, only its subscription ends. It must not record the
   shared attempt cancelled while other subscribers still use it.
4. The last subscriber's cancellation stops the lease. A reclaimed/lost
   attempt is recorded interrupted, preserving its log and reason. A local
   retry uses a separate attempt and returns that retry's execution ID.
5. If the writing session dies, a surviving compatible session takes over
   the repository operations before further writes. Liveness must not mark
   shared work dead merely because the original subscriber exited.

Preserve the current `TaskRunner.executionAlive` contract, including how
cache probes, status and history pruning ask it. Do not use a guest PID as a
local process identity. A session/hub-owned local identity may support
crash recovery, but must be consistent with takeover and lease loss.

Use `state: failed` for a task verdict, including a signal exit, and
`state: error` for infrastructure failure. Cancellation never becomes a local
retry. Keep the epic's explicit timeout policy (no local retry) and its
optional retry of task failures. The old `exitCode > 0` test would
misclassify current signal failures. `--rack-only` retains the epic's narrow
meaning: disables capacity spill, not all infrastructure fallback, and does
not guarantee a GPU.

## Execution, routing and scheduling

The new hook is after the cache miss and before scratch creation/budget
acquisition. It receives unit merge metadata and `own`; fallback invokes the
unchanged local body. It works for a plain task, a unit launched by the
dataflow, and every unit of a standalone split task. `runDetached` and intake
remain local and retain their budget and process settings.

Eligibility is based on the immutable task object and all executable program
objects it names. Do not depend on a map unit running first: cache hits may
leave only a merge unit to delegate. Reject a command body conservatively.
The current runtime's input decode setting must survive unchanged.

The host guard also needs a current platform audit: `json_value` reads a
file and is missing from the old list, while prefix-matching `json_open`
incorrectly blocks the in-memory `json_open_text`. `path_resolve` depends on
the process's working directory. Use exact names where a prefix conflates
host access with an in-memory operation. Do not copy cloud's permissive
"unscannable is guest-safe" rule into local routing.

Use one process budget (`cores` and memory), preserved by every local
fallback. Increase loop `width` by compatible rack capacity; remote work
takes no local grant. Spill decisions must account for memory and queued
work, not just free cores. Capacity is tier/version-specific, and the actual
claim must enforce the lease's e3-version floor: checking once before
enqueue does not stop an older rack of the same tier claiming it.

## Hub and session compatibility

The promise that projects at different e3 releases share one hub needs an
explicit negotiated control protocol and versioned message schemas. BEAST2
structs are positional; a newer integer protocol value does not make an
older request decode. Initially support the defined protocol exactly and
report an actionable mismatch; advertise additional versions only with real
compatibility tests. Repository-format interpretation stays in the session.

For sessions of one repo, ensure the selected data session understands the
lease's repository release. An arbitrary live session of the same pathname
is not sufficient. Resolve the repo's real path in the session, so computing
its stable alias does not make the hub inspect the repository.

The startup lock needs atomic publication and ownership-aware cleanup: an
empty file between `open('wx')` and writing BEAST2 is not proof of a dead
hub. Test simultaneous stale-lock recovery too. Failed session registration
must close its data listener; closing a session must abort its events poll.
Each network operation needs a finite deadline. An unclaimed lease must be
re-evaluated if all compatible racks disappear, rather than re-arm a claim
timer forever. A genuinely saturated healthy rack may still be waited for
under `--rack-only`.

Policy is repository state: future changes follow `WIRE_MIGRATION.md`, not
the issue's blanket proposal to keep old decoders and try sibling filenames.
Hub-owned files need their own documented release/upgrade policy because
they are outside repository upgrades. Keep protocol version and e3 release
distinct.

## Tests and packaging corrections

- The test agent executes `taskExecuteUnit` for unit events, including
  merge/range/own, and stages the full closure. It transfers all written
  objects using the real v2 declaration/PUT/commit sequence.
- Cover array, set, dict-merge and fold tasks, cached maps followed by a
  remote merge, and the single-piece `own` case. Assert deterministic
  fixtures' bytes/hashes; arbitrary random/time-dependent programs cannot
  promise the same bytes on two executions.
- Add contracts for missing output segments, out-of-closure reads,
  checksum/receipt mismatch, upload retries, commit racing cancellation,
  retained committed objects, log flush ordering and GC during transfer.
- Exercise late subscribers, completion racing attachment, reclaim IDs,
  one subscriber cancelling, owner-session death, and local fallback with
  a separate record. Test version filtering at claim, not only routing.
- Add the SDK dependency if the new stock-platform constant is imported
  from `@elaraai/e3`. The e3 aggregate no longer has the build script #865
  proposes editing: Make/pnpm already build in dependency order. Update the
  actual publish/version/license lists and lockfile.
- Avoid a build-time cycle from the server's optional rack integration. The
  server must compile before e3-rack exists, and the optional runtime load
  must be tested both present and absent. Keep the shared route entry
  browser-safe and run its portability gate.
- Current plugin verification runs `make -C libs/east-plugin index`, then
  builds both host plugins and checks their indexes, bundles and Codex
  skill copies. Both the old issue and the installed contributor skill name
  only part of this current gate.

## Cloud companion: landed versus still required

Issue checkbox state is not sufficient evidence of implementation. At the
pinned cloud main:

| Companion | Observed state |
| --- | --- |
| #177, #185, #205, #214 | Closed; current sources use e3 1.0.85, task/unit execution, v2 rack leases, closure staging and per-object upload. |
| #189 | Still open, but per-lease runtime selection and `+e3.<version>` reporting are implemented. Do not repeat the epic's claim that main still bundles 1.0.33. Remaining release/image-budget acceptance needs separate verification. |
| #190, #191 | Still open; dispatch cancellation and unit delegation already exist. Review remaining runner wiring/tests separately rather than adding duplicate dispatch methods. |
| #192 | Still open. Installer defaults still use a hostname-derived instance and `gpus=auto`; safe multi-instance setup remains a prerequisite. |
| #193 | Still open and materially outstanding: `RackApiClient.post` sets no request deadline; completion is best-effort and can be lost. A compatible hub alone does not provide the promised durable intermittent-agent behavior. |
| #194 | Still open and needs the same reconciliation: aliases of removed task-execution types and "optional" unit delegation are obsolete. The extraction must include current attempt/closure/transfer seams. |
| #195 | Still open. Test the actual current agent/uploader against the local hub in addition to the in-process test agent. Real hardware acceptance remains separate. |

These findings do not authorize changes to the closed cloud repository. The
open implementation can proceed and be verified with its test agent; the
remaining agent work must be completed for the full hardware/intermittent
control-plane acceptance to be claimed.
