# Design: composite records — one record over several systems of record

> **Status:** design for review, fourth revision, 17 November 2026. Nothing
> here is built yet.
> Issue: [elaraai/east-workspace#1465](https://github.com/elaraai/east-workspace/issues/1465).
>
> - **Revisions 1 to 3** (1 and 2 November 2026): the first draft, its review,
>   runs while people keep editing (rulings 11–14), and the prescriptive form:
>   §4's examples are the target behaviour, §5 numbers each requirement with
>   the example that shows it, the task that builds it and the spec that tests
>   it, and §9's tests replay the examples.
> - **Revision 4** folds in the review of 13 November 2026
>   ([its comment on the issue](https://github.com/elaraai/east-workspace/issues/1465#issuecomment-6844047764)):
>   rulings 15–18, the requirements R54 (changed) and R78–R92, and the cut
>   into five pull requests that replaces "One PR" (§11). It records the
>   product owner's change of order of 17 November 2026: the first four pull
>   requests start now, beside the Plan's, and the fifth waits for the Plan.
> - **Audited again, for the e3 side.** Every reference of task groups A to F
>   (e3-types, the SDK, e3-core, transfer, the server and the client, e3-web,
>   the CLI) is checked against the code the work is built on: the branch
>   `elaraai/feat/index-readers` at `980f65d11`, the last of the functions'
>   pull requests that touches e3. §3.3 says what that audit found and what it
>   changed, and what is still to be read before each pull request.
> - **Not yet audited: the builders.** §7.15, task group G and the review's
>   tasks L and M name Sheet code that is gone. They are audited when the
>   Plan's pull requests have landed, before the fifth pull request is cut.
>   Each such passage is marked.
> - **Every backend.** e3 runs over the local backend, e3-web and a hosted
>   one. §11.1 says, for each pull request, what another backend implements
>   and which shared suite pins it.

## 1. Summary

A composite record is a record whose entries come from declared **sources**.
Each source declares its key type, and e3 builds the record's type from them:
`orders` over `erp` and `own` is `Dict<Variant{ erp: String, own: String },
Order>`. East orders a variant by its case before its value, so each source's
entries are one contiguous run of the record, and an entry's key names the
source that owns it.

A source is the solution's (`source.mutations`), written by the record's
mutations, or **external** (`source.load`), written only by its **load**. A
load runs the author's pure function over a delivery and the source's current
entries, and commits the patch it makes. A delivery comes one of two ways:

- **From the dataflow**, the common case. The source is fed by a dataset of
  the package, usually the output of a task that combines several feeds. The
  dataflow loads it each time that output changes, as a step after the task.
  Nothing waits for the load: the record's readers run on the record as it
  stands, and run again after the load's commit, in the same run. A fed
  source holds what its feed's latest value says: a rollback that undoes a
  load is loaded again by the next run, so a feed is a snapshot of its
  source, never a feed of changes.
- **From `e3 load`**: a file or a stored value, for a source declared with its
  delivery's type. The load is a job its caller polls. A delivery may carry
  the time its source system made it (`--as-of`), and one older than the
  source's last is answered "superseded".

When the delivery is keyed by the source's key, a load runs in pieces cut at
the same keys, under the runner's budget, and a stopped load resumes from the
pieces it finished. The pieces' patches merge by key into one stored delta,
which the load commits once, beside the solution's edits. The edits that land
meanwhile are folded in from their own stored deltas, so a stream of edits
never makes the load apply its delta again. No mutation, view save or patch
writes an external entry. Reads are free.

Everything else is a record as it is today. It is one dataset with one
history, its indexes span every source, and it is read, paged and bound as any
record is. `e3.record` stays for every record with no external source.

People edit such a record several times a minute, all day, while its loads
run. So this design also changes how every run follows the records it reads
(§7.8): every result lands, and its task runs again once on the newest
commits; a task that reads several results reads them all as of one commit of
each record; a view's start hands its edit to the run in flight; and a deploy
stops any run (§7.9).

## 2. Rulings

Rulings 1–6 were decided with the product owner on 1 November 2026. They close
the issue's open questions, and those a source fed by a task raised.

1. **Pending until every external source has delivered.** From its deploy the
   record holds the solution's entries and takes its edits. Its dependents
   wait, as on an unset input, until each external source has delivered once
   (§7.7).
2. **A deploy stops running loads.** Each one starts again once the deploy is
   done (§7.9).
3. **A load reads its delivery and the source's entries, nothing else.** Data a
   load needs from elsewhere is joined into the delivery upstream, by a task
   whose output feeds the load (ruling 5).
4. **A delivery that is not a Dict or Set keyed by the source's key runs as one
   piece.** A large Array is keyed upstream, or declared as a Dict.
5. **A source may be fed by a task's output, or any dataset of the package, and
   the dataflow loads it** each time that output changes: a step after the
   task, its pieces cached, one commit per new output, and the record's
   dependents after it in the same run. A task that feeds a load cannot read
   that record: the cycle is refused. `e3 load` stays for sources delivered as
   a file or a stored value (§7.8).
6. **A deploy while a dataflow run is loading stops the run**, as a stop
   request does. Finished pieces stay cached, and the first run after the
   deploy loads again. A run that is not loading is treated as today (§7.9).

Rulings 7–10 were decided with the product owner on 2 November 2026, on the
questions the review of the first draft raised.

7. **A rollback forgets each delivery it undoes.** The source waits for its
   first delivery again if that one is undone. The next run, or `e3 load` of
   the same delivery, applies it again, mostly from cached pieces. A record fed
   by a task stays what its feed says: to undo a bad delivery, fix the feed
   (§7.7).
8. **A delivery may carry an as-of time** (`e3 load --as-of`, or `asOf` in the
   request). One older than the source's last is answered "superseded", with
   no commit, and the same delivery again is answered "already loaded". A
   delivery without one is handled as now (§7.5).
9. **A deploy keeps a value someone set in an input that feeds a load,
   whatever `--inputs` says.** An input that only holds its package's value is
   never loaded, including after a type change resets it: the load waits until
   someone sets the input (§7.9).
10. **A record's readers wait while its load waits**, before the source's first
    delivery and after it. A reader computes from the feed through the load,
    and a task missing an input cannot run. The review proposed letting them
    run on the record as it stands; the product owner kept them waiting
    (§7.8).

Rulings 11–14 were decided with the product owner on 2 November 2026, on how
the design behaves while people edit a record all day and its loads run for a
quarter of an hour each hour.

11. **Nothing waits on a running load.** People's edits commit as they are
    made, and a load runs beside them and commits once: no edit can touch an
    entry a load writes. A record's readers run on the record as it stands,
    during a load or not, and run again after the load's commit (§7.8).
12. **A run never throws a result away.** Each result lands as its task
    finishes, and a task whose inputs moved meanwhile runs once more, on the
    newest commits, for everything that arrived. This changes how every
    workspace's runs follow their inputs, and it is part of this design
    (§7.8).
13. **A deploy stops any run in flight; an edit never stops one.** A run that
    people keep editing under does not end by itself, so a deploy stops it,
    as a stop request does (§7.9).
14. **An edit wakes the run.** A view starts a run after each write, and a
    start that finds a run in flight hands it the edit: the run looks for
    changed inputs at once. Nothing polls for edits (§7.8).

Rulings 5, 6 and 10 read with these. Ruling 5's readers run after the load's
commit, in the same run, and do not wait for the load meanwhile. Ruling 6's
stop applies to any run (ruling 13). Ruling 10's wait is for a load that
cannot run — its feed has no value, is a record yet to deliver, or holds its
package's value — never for a load that is running.

The review on the issue asked for five changes before building. Changes 1–4
are already in the issue's body and are taken here as written. Change 5 is
ruling 2. The review of the first draft found the gaps F14–F30 of §3.2; the
fixes are in the sections each names, and rulings 7–10 settle the four that
were the product owner's to decide. A review of the revision for people
editing all day found F31–F34, which rulings 11–14 settle. Writing the
target behaviour out as examples found F35, a fix of design (§7.8).

Rulings 15–18 were decided with the product owner on 13 November 2026, in
the review of the third revision.

15. **A fed load that fails does not stop the run.** The record keeps its
    last good delivery, every other task goes on following people's edits,
    and the run ends failed, naming the load (§7.8, "Fail"; R54).
16. **Rows a migration carried over count as delivered.** At the deploy that
    makes a record composite, or gives it another external source, a source
    the migration left rows under does not wait for a first delivery. A
    source with no rows still waits, as ruling 1 says (§7.7).
17. **The limits and timings of §8 are approved as proposed.** One change in
    how the deploy check is made alters none of them (§7.9).
18. **The changes to runs land as their own pull request, the first of the
    composite stack.** Composite records land as stacked pull requests
    (§11). The ruling had the stack land after the Plan's pull requests; the
    order below changes that.

**The order, 17 November 2026 (the product owner's).** The first four pull
requests of §11 start now, in parallel with the Plan's, each stacked on the
one before, the first on `elaraai/feat/index-readers`. The fifth, the
builders over a composite, waits for the finished Plan. Nothing else of
rulings 1 to 18 changes.

**Rulings 29 to 38, 18 November 2026.** Reviews of the third and fourth pull
requests raised ten points this document left unsaid, which the product owner
settled on the issue (#1465), where each is written out with its examples.
The sections each names are amended below. Rulings 19 to 28, made on the
issue while the first three pull requests were built, are not folded into
this document.

29. **A reader that only a load's commit would decide waits on that load
    when the load cannot commit in the run**: it is outside a `--filter`'s
    run set, or it failed, was skipped or waits. The run ends without the
    reader, where it ended in an error (§4.10, §7.8).
30. **A version a fed record carries that the repository no longer holds is
    read as unknown**, as a forgotten delivery's is. Garbage collection roots
    no version a record carries (§7.8).
31. **One record's sources may hold deliveries made from different versions
    of one upstream.** A task that reads the record alone runs on it; one
    that reads the upstream too is deferred until the slower load catches
    up, and is told the two sources (§4.10, §7.8).
32. **A feed that moves releases the readers waiting on its load, never
    those waiting for a first delivery**, which that delivery's commit
    releases, so each is told once that it waits (§7.8).
33. **After a rollback only a source that is external now can wait, and a
    rollback past a restore or a deploy sets what waits as a restore does**
    (§7.7).
34. **A load waits a copy onto its workspace, or the workspace's removal,
    out**, as it waits a deploy out, and fails only where that took the
    workspace (§7.5).
35. **`e3 dataset get -o <path>` writes a file whole or not at all**, and
    starts over when the dataset moves; the standard output stays a stream,
    and a read that fails part way says so (§7.13).
36. **The load's read routes ask the host's rule too**: a load's status asks
    `read`, and an upload's part and its poll ask `upload` (§7.11).
37. **One source's loads apply in the order asked.** Each job store starts
    them in the order they were filed, a waiting load keeps its place, and
    the local lock service hands the turn to its waiters in the order they
    asked. No seam gains a method (§7.5, §8; R14).
38. **A load that has landed is recorded completed, however long the store
    refuses the write**: it is tried again once a second, with no bound
    (§7.5, §8).

**The reviewer's calls.** The review made eight engineering calls. None is a
ruling, and each can be overturned. Calls 1 and 2 are put to the product
owner before they are built; this document writes each as the review made
it, and marks it.

1. A failed load runs again in the same run when its feed moves, and a run
   ends as its nodes stand at its end: a run whose load failed and then
   loaded its feed's next output ends completed (§7.8, "Fail"). *Asked
   before the fourth pull request builds it.*
2. A source changed from `mutations` to `load` while it holds rows counts as
   delivered, as ruling 16 has rows a migration carried over (§7.7). *Asked
   before the second pull request builds it.*
3. A rollback takes a source out of `$pending` when the state it commits
   holds its rows (§7.7).
4. A function's declared input that waits for a first delivery ends its call
   `invalid`, and a dataset a caller names is read as it stands (§7.7).
5. A load job can be cancelled in the first cut (§7.5, §7.11).
6. A load is granted through the host's seam, and as a mutation is where the
   host gives no rule (§7.11).
7. The alternative of §7.8, starting a task that is due again where a task
   sharing a reader with it last started, stays not taken: it would amend
   ruling 12. A catch-up run is what a reader falls back to under either
   choice, so it can be taken up later with no wire changed, and the first
   pull request's tests count the catch-up runs it would save.
8. The cut of the stack after its first pull request (§11).

## 3. What exists, audited

The first audit was made against the code on the stacked branch at
`79a84cdc4`. The review of 13 November read the record branch 648 commits on
(`c7d488d59`). The fourth revision's audit, of the e3 side alone, was made
against `elaraai/feat/index-readers` at `980f65d11`, which the first pull
request is based on: every reference of §3 and of §7.1 to §7.14 below is to
that tree, and §3.3 lists what moved and what the audit found. The
references of §7.15 are to the tree of the first audit, and are not yet
audited.

### 3.1 What the design builds on

- **A record's parts are built by builders, where the record is declared.**
  `record()` (`e3/src/record.ts:137`) builds each index, mutation and
  migration through `builderOf(…).build(rec, key)` (`:173–195`) and checks it
  there; the accepted keys are `CONFIG_KEYS` (`:238`). A source is one more
  part.
- **Every write of a Dict record is a delta.** The delta is `Dict<Variant{
  $conflict, primary, <index>… }, ops>`, generated by the SDK
  (`e3/src/record-programs.ts`: `deltaTargets`, `dictPatchOps`, `dictApply`,
  `indexesChanges`; the type is `mutationDeltaType`, `e3-types/src/record.ts:787`).
  e3-core applies it a segment at a time, reusing every run of segments it
  does not touch (`e3-core/src/record-apply.ts:153` `applyDelta`, `:313`
  `applyTarget`). An entry index's keys carry the record row's key, and a
  summary's op is `add` of totals (`RecordSummaryOpType`, `record.ts:733`): a
  key whose count reaches 0 goes, and an absent key is inserted.
- **A mutation stores its delta in its commit** (`delta: some(…)`,
  `records.ts:935–1061`); a system commit stores none (`delta: none`,
  `records.ts:2480–2486`, and every deploy commit, `:1959–2040`).
- **Split execution.** Pieces are cut over the heaviest partitioned input, the
  other partitioned inputs at the same keys. Each piece's inputs are stored by
  reference, each piece's unit is cached, and a stopped run resumes from the
  pieces it finished (`e3-core/src/execution/pieces.ts:238` `planPieces`;
  `execution/engine.ts` `executeSplitTask`, its `$plan` stages). A task is
  split when one of its inputs is partitioned (`isSplitTask`, `engine.ts:367`).
  A Dict output's equal keys fold with a `merge` program.
- **A delivery is taken in by reference.** `deliveryAdoptStored`
  (`e3-core/src/dataset-adopt.ts:462`) takes a stored object in as a
  collection, in memoized pieces (`delivery-intake.ts`), under running work.
- **Jobs a caller polls.** These are the `TransferBackend` stores
  (`e3-core/src/transfer/interfaces.ts:367–377`). The split call is the nearest
  precedent: a task object over inputs given by hash (`path: []`,
  `splitCall.ts:357–365`), run through `runner.execute` under
  `withRunningWork`, its progress throttled (`transfer/process.ts:569`
  `handleProcessSplitCall`). A job is cancelled by writing it `cancelled`,
  and its store's `updateStatus` records a status only while the job has not
  ended, the check and the write one atomic step (`SplitCallStore`,
  `transfer/interfaces.ts:268–291`). The client polls 100 ms apart, backing
  off to a second (`e3-api-client/src/functions.ts:1053`).
- **Reserved version-vector slots**, carried verbatim by every commit that does
  not own them (`e3-core/src/records.ts:1096` `nextVersions`; the slots at
  `:97–110`). A writer drops a slot only by naming it, as `undefined`.
- **System commits**: `$init`, `$deploy`, `$reset`, `$reindex`, `$compact`, and
  a deploy's `$migrate:<name>` (`records.ts:2310–2319`, `:2417`
  `recordSystemCommit`). A rollback walks the chain from the head to its
  target, and is refused past a `$reset` or `$migrate:` commit
  (`systemCommitState`, `:2574`); a restore names a state. Both write the ref
  with `nextVersions(current.versions, …)` (`:2495`), carrying every slot.
- **The dataflow.** A run builds its graph from the package's tasks
  (`buildDependencyGraph`, `e3-core/src/dataflow.ts:239`; `dataflowGetGraph`,
  `:319`) and keeps it in its stored state (`DataflowExecutionStateType.graph`,
  `e3-types/src/dataflow.ts:504`). It holds the workspace's lock shared, and
  `<ws>#dataflow` exclusively, for its whole length
  (`dataflow/orchestrator/LocalOrchestrator.ts:470–496`). Each ready task is
  prepared (`stepPrepareTask`, `dataflow/steps.ts:675`), served from the
  execution cache or launched — as a split task when an input is partitioned
  (`launchSplit`, `LocalOrchestrator.ts:1643`) — and completed
  (`completeTask`, `:1443`, under the run's mutex), which writes its output to
  the workspace (`stepApplyTreeUpdate`, `steps.ts:1356`). A root input that
  changes mid-run invalidates the tasks that read it and every task that
  depends on them (`findAffectedTasks`, `dataflow.ts:400`): each completed one
  goes back to pending, and a task is ready only once every task it depends on
  is `completed`. A task in flight is not reset, but its result is checked at
  its end against the version vector it was given (`stepTaskResultStale`,
  `steps.ts:633`), and dropped when an input moved and the run has looked
  since. A run looks for changed inputs after each completion and cache hit
  (`handleInputChanges`, `LocalOrchestrator.ts:1408`), and `completeTask` checks before it looks.
  A stop request cancels the run (`cancel`, `LocalOrchestrator.ts:782`). Once a
  task fails, the run launches nothing more (`hasFailure`, `:912`). A start
  while a run holds `<ws>#dataflow` is refused `workspace_locked`
  (`startDataflow`, `e3-api-server/src/handlers/dataflow.ts:224`), with a
  `Retry-After` when the holder is a run that is stopping
  (`e3-api-server/src/stopping-run.ts`), and the client asks again a few
  times before it raises the refusal (`dataflowExecuteLaunch`,
  `e3-api-client/src/executions.ts:63`).
- **The loop is shared code.** The orchestrator every backend runs is the one
  class (`dataflow/orchestrator/LocalOrchestrator.ts`, reached through the
  portable entry), over the storage, the state store and the runner it is
  given; the root entry's `execution/local-orchestrator.ts` only names this
  process as its host. A host whose compute has a time limit runs a run's
  loop in successive processes: the run yields (`shouldYield`), another
  process resumes it (`resume`) from its stored state, and a loop another
  process has moved on stops without writing (`StateWriteOutcome`'s
  `refused`, `DataflowSupersededError`). So whatever a run must remember
  between two passes of its loop is in its stored state, never in the memory
  of the process that runs it. The loop's contract suite drives that class
  over each backend's stores (`contract/dataflow.ts`, `dataflowTests`).
- **Version vectors.** A root input's vector is itself (`inputVersionVector`,
  `dataset-refs.ts:78`), set at the run's start (`steps.ts:134`) and when it
  changes (`:470`); a task's output gets the merge of its inputs' vectors
  (`stepTaskCompleted`, `:1075`); a task whose inputs' vectors disagree is
  deferred until they agree (`stepCheckVersionConsistency`, `:586`).
- **A view writes, then starts a run.** e3-ui's dataset store commits a write
  and then launches the dataflow (`writeAndStart`,
  `e3-ui-components/src/platform/dataset-store.ts:789`), as a record's handle
  does after a mutation (`record-runtime.ts:687`).
- **Locks.** `LockService.acquire` answers null for a holder, or waits up to a
  timeout, 30 s by default, polling about every 100 ms
  (`storage/interfaces.ts:1012–1040`, `storage/local/LocalLockService.ts:488–540`).
  It has no writer preference: a shared taker wins whenever no exclusive holder
  is in place. Every shared taker of a workspace is refused at once while a
  deploy holds it (`trees.ts:410`, `records.ts:425`, `workspace-bundle.ts:161`,
  `workspaces.ts:358`, `LocalOrchestrator.ts:485`, `:567`).
- **Deploy inputs.** A deploy gives an input someone set the new package's
  value under the default policy, `reset` (`input-deploy.ts:204`;
  `workspaces.ts`: `options.inputs ?? 'reset'`), and `e3 watch` deploys under
  it on every save (`e3-cli/src/commands/watch.ts:172`).
- **gc.** Held gc sweeps unreachable objects older than a minute
  (`gc.ts:127`) and is refused while running work is held; gc beside running
  work deletes an object only once it has been unreachable, and untouched, for
  its retention window. A call naming an object by hash re-references it
  (`ObjectStore.touch`, `storage/interfaces.ts:202–232`).

### 3.2 Findings

The issue's plan holds, with these corrections and gaps. F1–F13 are the first
draft's; F14–F30 are the review's; F31–F34 are those of a review of the
revision for people editing all day; F35 was found writing the examples out.

- **F1 — Co-partitioning across key types.** `planPieces` cuts co-partitioned
  inputs at the same keys, and refuses inputs whose cut types differ
  (`pieces.ts:333–338`). A delivery is keyed by the source's key `K`, but the
  record is keyed by `Variant{…}`. The source's entries are a run of the
  record, not a collection of their own. So the review's "split execution cuts
  several inputs at the same keys" holds only once the planner can cut through
  a variant key's case. → §7.3
- **F2 — A mutation runs its program inside its compare-and-swap loop.**
  `recordMutate` calls `writeDelta` on every attempt (`records.ts:973–1055`),
  under the workspace's shared lock for the whole call (`:945`). A load must
  run its pieces once, outside the race, and only apply inside it. → §7.5
- **F3 — Each lost race re-applies the whole delta.** `applyDelta` applies
  every op of the delta to the latest head on each attempt, reusing only that
  head's untouched segments. A large delivery would rewrite its segments again
  for every commit that lands first (the review's change 4). → §7.6
- **F4 — The requests a record remembers are few, and every keyed mutation
  shifts them** (`records.ts:1035–1038`). At the first audit `$idem` was one
  slot. A record now remembers its last sixteen keyed requests (`$idem.log`,
  `RECORD_KEYS_REMEMBERED`, `:123`), which is still a bounded list that
  people's saves push a delivery out of. Each source needs slots of its own.
  → §7.7
- **F5 — Nothing lets a deploy tell a holder to let go.** A deploy takes the
  workspace lock exclusively, and is refused at once while it is held
  (`workspaces.ts:797–805`). A load may hold it for hours, in another
  process. Ruling 2 needs a stop signal that crosses processes. → §7.9
- **F6 — The dataflow waits only on an unassigned ref**
  (`e3-core/src/dataflow.ts:603` `dataflowResolveInputHashes`). Ruling 1 needs
  a record that holds a state and that its dependents still wait on. → §7.7
- **F7 — `e3 dataset get -f beast2` re-encodes whole.** Locally it reads with
  `datasetRead` and writes `encodeBeast2For(type)(value)`
  (`e3-cli/src/commands/get.ts:69`, `:102`). Remotely, `datasetGet` holds and
  decodes the whole splice before the format is chosen. A value encoded whole
  is one run, which intake refuses past 64 MiB (`RUN_MAX_BYTES`,
  `east/src/serialization/beast2/v5/runs.ts:52`). The server already streams
  the stored splice. → §7.13
- **F8 — A remote client can store a file's bytes only into a dataset.** The
  transfer upload targets a dataset path. A remote load from a file needs an
  upload that writes no ref. → §7.11
- **F9 — A Sheet is read-only only as a whole** (`readOnly`,
  `e3-ui/src/sheet/root.ts:233`). None of its rows can be locked, so drawing
  external entries read-only is new renderer work. → §7.15
- **F10 — The builders hand mutation and index bodies no types.** A body is an
  `East.function` over the record's state, or over its key and row. A
  composite's type is built by e3, so the author needs it handed back.
  → §4.1, §7.1
- **F11 — Adding or removing a source changes the record's type**, which a
  deploy plans as any type change: a declared migration, or a reset. → §10
- **F12 — Nothing in a run writes a record.** The graph holds only tasks
  (`dataflow.ts:239`), and a record is a root input
  (`stepDetectInputChanges`, `steps.ts:446`): nothing orders a record's
  readers after a write of it. A fed load needs a node of its own in the
  graph. The graph is kept in each run's stored state, so a field that marks
  the node changes a stored form. → §7.8
- **F13 — A run holds the workspace for its whole length**
  (`LocalOrchestrator.ts:470–496`), so a deploy is refused while any run is in
  flight. Rulings 6 and 13 need a run to let go. → §7.9
- **F14 — The first draft's rebase walked segments, and is ambiguous at a
  run's ends.** It took the load's own segments over any run of segments the
  latest head shares with the base, re-cut at the run's ends. A segment's key
  range is the gap between its neighbours' fences, so an entry a mutation
  inserted in the gap beside a shared run falls in neither side's segments and
  is lost, and one it deleted there comes back from the load's re-cut segment.
  An index's segments are shared and re-cut the same way. Replaying the stored
  deltas of the commits in between needs no alignment. → §7.6
- **F15 — Rollback and restore carry the load slots, and never reopen
  `$pending`.** Both write `nextVersions(current.versions, …)`
  (`records.ts:2495`). After a rollback past a load the slots still name its
  delivery, so a run answers the load node `[CACHED]` over a record that no
  longer holds it; a rollback past the first delivery leaves the readers
  running on a record holding none of the source's entries. → §7.7, ruling 7
- **F16 — A deploy resets an input that feeds a load.** Under the default
  policy every input someone set takes the package's value
  (`input-deploy.ts:204`), and `e3 watch` deploys under it on every save
  (`watch.ts:172`). The next run loads the package's value, deleting what the
  source held. → §7.9, ruling 9
- **F17 — A record's version vector says nothing of what its loads read.** A
  root's vector is itself (`inputVersionVector`, `dataset-refs.ts:78`), and
  the first draft gave a load node's output the feed's vector alone
  (`stepTaskCompleted`, `steps.ts:1075`), which change detection then reset to
  the record's own (`:470`). A task that reads the record and something made
  from the feed's upstream cannot tell which version of the upstream the
  record's entries came from, so it may compare an entry with a newer copy of
  itself. → §7.6, §7.8
- **F18 — Repeats remember only the last delivery.** `$load.<source>` holds one
  hash, so a system that sends an older copy after a newer one has it loaded
  over the newer. → §7.5, ruling 8
- **F19 — A fed load sees only its feed's latest value**, and, under ruling 7,
  loads it again after a rollback forgets it. A feed of changes would skip the
  values it held between runs and apply one twice after a rollback. → §7.1
- **F20 — The first draft's commit loop.** It retried every failure — an apply
  error or a storage failure would spin — and, run in `completeTask`, held the
  run's mutex for the whole commit, stopping every other completion. → §7.6,
  §7.8
- **F21 — `$pending` is reconciled only at a mint, a reset and a migration.** A
  deploy that keeps the record's type — a source changing from `mutations` to
  `load` — never names the new external source, and a source no longer
  external stays named, so the readers wait for good. → §7.7
- **F22 — The waits give up at 30 s.** A load queued behind another load of its
  source, or waiting out a deploy that runs a long migration, waits through
  `acquire(…, { wait: true })`, whose default timeout is 30 s, and fails.
  → §7.5
- **F23 — A deploy handed a lock skips the announcement.** `ProcessDeployDeps.lock`
  says the deploy "takes none of its own" (`transfer/process.ts:348`): e3-cloud's
  path never takes the intent, and its loads never stop. → §7.9
- **F24 — `--plan` takes the deploy lock exclusively** (`workspaces.ts:800`,
  before `options.plan` is read at `:847`). With the intent, a plan would
  announce itself, wait, and stop a loading run. → §7.9
- **F25 — Shared takers starve a deploy.** With no writer preference, the
  mutations, sets and run starts that arrive while a deploy waits its 30 s keep
  the workspace held, though each is brief, and the deploy is refused. → §7.9
- **F26 — gc can sweep a queued delivery.** A delivery is unreachable until
  its load commits. Held gc sweeps it once it is a minute old (`gc.ts:127`),
  as it can be while its job waits behind another load; gc beside running work
  does the same once its window has passed. → §7.10
- **F27 — e3-cloud cannot hold `H0` in memory** between a load node's prepare
  and its commit: they may run in different invocations, and a run resumed
  after a yield has lost it too. → §7.6
- **F28 — The graph has one producer per dataset.** `dataflowGetGraph` rebuilds
  `dependsOn` from `outputToTask` alone (`dataflow.ts:352–361`), and
  `stepTasksWaiting` maps each output to one producer (`steps.ts:819`), as
  `buildOutputVersions` does (`LocalOrchestrator.ts:2034`), while a record may
  have a load node per fed source. The first draft gave each reader an edge to
  each load node, which these maps lose. → §7.8
- **F29 — gc's history prune keeps the wrong execution of a load node.**
  `keepOf` names a workspace's current executions `${task.hash}/${inputsHash}`
  over the graph's inputs (`history.ts:465–481`); a load node's execution is
  over `[feed, run]`, not `[feed]`, so its current execution is kept only while
  it is recent. → §7.8
- **F30 — A Sheet over a composite refuses new rows.** A keyed source with a
  key that is not a String is refused unless `newRowId` is given or inserts are
  off (`e3-ui/src/sheet/root.ts:704–709`), and every composite's key is a
  Variant. → §7.15
- **F31 — The revision held a record's readers up for a whole load.** It read
  ruling 5's "after it" as an edge from each reader to the record's load
  nodes, so for the quarter-hour a load runs nothing computed from the record
  followed people's edits, though no edit can touch an entry a load writes.
  → §7.8, ruling 11
- **F32 — A run throws slow results away, and starves a task that reads
  several.** A result is dropped when an input moved and the run looked
  meanwhile (`stepTaskResultStale`); a change resets every completed task
  downstream, so each waits for the slowest above it; and a task whose inputs
  came from different commits is deferred until they agree. Under an edit
  every few seconds, a task slower than the gap keeps losing its result, and a
  task that reads two of them may never run. → §7.8, ruling 12
- **F33 — An edit reaches a run only when one of its tasks ends.** A view's
  start after a write is refused `workspace_locked` while a run is in flight,
  and the run looks for changed inputs only after a completion, which may be a
  slow task's, minutes later. → §7.8, ruling 14
- **F34 — A run that people keep editing under never ends, so no deploy
  lands.** A run follows its inputs until none moves, holding the workspace
  all the while, and the revision stopped only a run that was loading.
  → §7.9, ruling 13
- **F35 — A task a cache hit makes ready waits for the next completion.**
  After a pass that answered a task from the cache, the loop waits on what is
  in flight before it takes the ready tasks again
  (`LocalOrchestrator.ts:1068–1077`). A fed load whose feed the cache answers
  waits for whatever slow task is running, minutes later, as an edit did
  (F33). → §7.8

### 3.3 The fourth revision's audit

The e3 side was read again, whole file by whole file, at
`elaraai/feat/index-readers` `980f65d11`. Every `file:line` reference of §3
and §7.1 to §7.14 now names that tree.

**What moved.** The run loop and its steps hold to within a few lines
(`steps.ts` not at all). The record store moved by hundreds of lines
(`records.ts` is 2,785 lines; `recordMutate` is at `:935`, `nextVersions` at
`:1096`, `commitDeployRecords` at `:1959`, `recordSystemCommit` at `:2417`,
`systemCommitState` at `:2574`). New since the first audit, and read for
this one: the calls a server keeps and their drafts
(`execution/functionCall.ts`, `execution/functionDrafts.ts`), inputs that
are an index of a record (`dataflowResolveInputHashes`, `taskInputRead`), a
run's events kept apart from its state, the stopping run
(`e3-api-server/src/stopping-run.ts`), a workspace's copy and its bundle
(`workspaces.ts:340`, `workspace-bundle.ts`), and eight repository upgrade
steps (`repository-record.ts:59`).

**What it found.** F36–F47 are this audit's. Each says where the design
changes, and one ends in a question for the product owner (§11.2).

- **F36 — The loop is every backend's, and a run may change process between
  two passes** (§3.1). §7.8 keeps a task's commits, its catch-up runs and the
  order of a record's snapshots in the memory of the loop, and has a resumed
  run decide each task again, the execution cache answering what finished.
  Read against the yield and the resume as they stand (`stepYield`,
  `steps.ts:1326`; `resume`, `LocalOrchestrator.ts:539`), that holds, and no
  stored form of a run changes in the first pull request: a task due again is
  `pending` with its last output and execution kept, which `TaskStateType`
  already holds (`e3-types/src/dataflow.ts:72`). What the audit adds is the
  proof: the loop's contract suite gains a case that yields a run with a task
  due and a catch-up run in flight, resumes it in a second orchestrator over
  the same stores, and finds every result landed once. → §7.8, §9, task C12
- **F37 — The wake is a seam, and so is a start's answer.** `wake` (§7.8) is
  a method of `DataflowOrchestrator`. The shared class wakes a run its own
  process holds. A host whose runs are held by another process or instance
  implements `wake` to reach them, as it reaches them to cancel
  (`cancelRequested`, `e3-types/src/dataflow.ts:642`); where `wake` answers
  false the start is refused as today, so nothing breaks, and the edit is
  found at the run's next completion. A run that is stopping takes nothing
  in: a start that meets one is still answered `workspace_locked` with its
  `Retry-After` (`stopping-run.ts`), and `wake` answers false for it. What a
  hosted backend implements is said in §11.1. → §7.8, "An edit wakes the run"
- **F38 — A local command beside a run in another process stays refused.**
  The CLI runs its own loop in its own process
  (`e3-cli/src/commands/start.ts:180`, `watch.ts:221`), so a second local
  start meets `<ws>#dataflow` held by another process. §10 already keeps
  that as today, and leaves waking a run across processes as a follow-up;
  read against the code, that stands, and ruling 14 is met for a view's
  start, which goes through a server or a page. → §7.8, §10
- **F39 — "Not set" already covers an index its record does not hold.** A
  task waits when an input has no value, and when an input is an index its
  record's state does not hold (`PrepareTaskWaiting.unassigned`,
  `dataflow/types.ts:124`; `taskInputRead`, `dataset-open.ts:547`).
  `InputWait`'s `unset` (§7.8) is that wait whole, with the words it has
  today; what the new kinds take out of it is a record whose `$pending` is
  set, which is read first. → §7.8, "Waiting, and its words"
- **F40 — A task whose input is an index runs again only when the index
  did.** Such a task is decided again whenever its record's commit moves,
  and the execution cache answers it when the index's object in the new
  state is the one it last read (`taskInputRead`, `dataset-open.ts:547`).
  `dataflowResolveInputs` keeps that: it reads the task object's inputs,
  reads a record's ref once for the record and every index of it, and names
  an index input by the index's object in the commit's state. → §7.8
- **F41 — A draft is laid from what the call's start named, and can end
  only as failed, timed out or in conflict.** The review has a draft that
  writes an external entry end its call `invalid` in the Save's words with
  "nothing new to build" (its section 5). As the code stands the laying is
  handed the record's state and the mutation's object by hash, and reads no
  record object (`layCallDrafts`, `functionDrafts.ts:406`; `recordLayDraft`,
  `records.ts:1520`), and its ends have no `invalid`
  (`CallDraftsEnd`, `functionDrafts.ts:293`). So the cases a mutation may
  write must reach the laying, and the laying needs a refusal of its own.
  → §7.4, question 1
- **F42 — The apply streams.** `applyDelta` writes its targets side by side,
  each taking its ops in batches as segments are read ahead
  (`record-apply.ts:178`, `:313`). "Before the target is written" (§7.4) is
  therefore: as the op is taken, before the target's manifest is written.
  Segments already stored are named by nothing, and nothing commits. → §7.4
- **F43 — A keyed load's pieces always fold with a merge program.** With no
  merge program, two pieces that answer one key are the engine's own failure
  (`execution/engine.ts:790–804`), and two pieces can share a `$conflict`
  key whatever the record's indexes. §7.1 had "none for a record with no
  summary" beside "two `$conflict` entries keep either". → §7.1
- **F44 — A reserved slot is compared like any other entry.**
  `checkVersionConsistency` refuses two vectors that differ at any shared
  key (`dataset-refs.ts:32`). The slots of §7.7 ride in a record's vector,
  so whatever compares or merges vectors for a launch leaves every entry
  whose key begins `$` out. → §7.8, "A task runs as of its slowest input"
- **F45 — A workspace's bundle and its copy.** A copy writes every ref as it
  stands, slots and all, and both workspaces are of one repository, so a
  copied composite reads as loaded (`workspaces.ts:340`). A bundle carries
  each task's current execution, found from the graph's inputs
  (`workspace-bundle.ts:186`), which misses a load node's as gc's prune did
  (F29): the bundle names it from the record's `$load.<source>.execution`
  slot, the same way. → §7.8, task C14
- **F46 — A composite at `--schema=reset`.** A record declared with no
  initial value now goes back to unassigned under `reset` (`unassign`,
  `record-deploy.ts:169`). A composite always holds a state (§7.1), so it is
  reset to its solution sources' initial values, never unassigned, with
  every external source waiting again. → §7.7
- **F47 — The limits already in the code.** A stopping run's refusal names a
  one-second wait (`STOPPING_RUN_RETRY_AFTER_S`); a kept call's run reads
  its record for a cancel every second (`functionCall.ts:113`), as a split
  call's job does (`SPLIT_CANCEL_POLL_MS`, `transfer/process.ts:535`). The
  load job's look at its own record (ruling 17, §8) is that same second, and
  adds no timing of its own.

**What holds, read again.** A load's commit replays exactly over the edits
that landed while it ran: the only keys two writers can share are a
summary's and a nested span's, whose totals are whole numbers
(`RecordSummaryTotalsType`, `e3-types/src/record.ts:181`); every other
index entry's key carries its row's key, an entries index's lean rows
included. The slots need no repository upgrade step: `nextVersions` carries
every reserved slot a commit does not own (`records.ts:1104–1106`), and a
load's commit keeps the requests the record remembers by its default. The
planner cuts by a Struct key's fields and checks inputs cut together by
type (`pieces.ts:170–182`, `:333–338`). `retained` sorts after `reset`,
today's last case of the plan's action (`e3-types/src/api.ts:468–474`).
gc's history prune still names a current execution over the graph's inputs
(F29, `history.ts:465–482`).

**Read whole for this audit:** in e3-core, `records.ts`, `record-apply.ts`,
`record-deploy.ts`, `input-deploy.ts`, `workspaces.ts`,
`workspace-bundle.ts`, `trees.ts`, `dataset-refs.ts`, `dataset-adopt.ts`,
`dataflow.ts`, `dataflow/steps.ts`, `dataflow/types.ts`, the orchestrator
and its interfaces, the state store's interfaces, `contract/dataflow.ts`,
`execution/pieces.ts`, `engine.ts`, `oneShot.ts`, `functionCall.ts`,
`functionDrafts.ts`, `splitCall.ts`, `execution/interfaces.ts`,
`storage/interfaces.ts`, `storage/local/LocalLockService.ts`,
`running-work.ts`, `gc.ts`, `history.ts`, `errors.ts`,
`repository-record.ts`, `upgrades/dataflow-force-tasks.ts` and the three
transfer modules; in e3-types, `record.ts`, `dataflow.ts` and `api.ts`; in
the SDK, `record.ts`, `record-builders.ts`, `record-programs.ts`,
`record-guards.ts`, `mutation.ts`, `export.ts` and `package.ts`; the
server's dataflow handlers and `stopping-run.ts`; the CLI's `start`,
`watch`, `workspace` and `get`; and the conventions `E3_BACKEND_SEAMS.md`
and `WIRE_MIGRATION.md`'s rules.

**Still to read whole, before the pull request that touches each.** These
are named in this document without a line, and were located, not read:
`execution/budget.ts`, `LocalTaskRunner.ts` and `MockTaskRunner.ts` (the
first, for `GatedTaskRunner`); `gc-graph.ts`, `executions.ts` and the SDK's
`task.ts` (the second and fourth); `delivery-intake.ts`, `dataset-open.ts`,
`functionCallUnkept.ts`, `transfer/InMemoryTransferBackend.ts`, the
server's record routes, the client's `functions.ts`, `datasets.ts` and
`executions.ts`, the CLI's `seed`, `history` and `cli`, and e3-web's
`WebTransferBackend.ts` (the third); the remaining upgrade steps, whose
frozen forms a new step's "before" type is built from (the first and
fourth). Outside e3, the first pull request changes what a start answers,
which e3-ui-components' dataset store and e3-ui-cli's run screen call; both
are read whole before it, and neither is the Plan's code.

## 4. Target behaviour, by example

These examples are the target behaviour, not illustrations of it. A test
replays each one (§9) and asserts it as written: the commands, the lines they
print in their order, the words of each refusal, each value, and the order of
a timeline's rows. Only these stand for what a run makes, and a test checks
their form, not their value:

- hashes and ids (`3f2a9c1e`, `5e7a3b0c…`, `<inputsHash>/<executionId>`);
- times of day, in a timeline, a history line or a lock's `since`;
- durations in brackets (`[930ms]`);
- a process id (`process 51234`);
- an event's sequence number (`since: 1842n`).

`…` stands for lines left out: a run's header, a load's `[PART]` lines, or more
lines like those around it. A line that begins with `# ` is a note, and so is
the rest of any line after two or more spaces and `# `: a note is not part of
the listing (a piece's `#1` is). A listing's lines come in the order shown,
with one freedom: the lines a run prints in one pass of its loop, before it
next waits on what is in flight — the tasks it starts, answers from the cache,
defers or leaves waiting — may come in any order among themselves, and a test
checks them as a set.

A timeline's times are labels: a test drives its rows in order on a runner
that holds each task until the test lets it finish (§9.1), so "while it runs"
is exact and nothing waits on a clock. A timeline's commits (`c0`, `m1`, `L`)
are the ones its test makes.

### 4.1 Declaring

```ts
import { DictType, East, IntegerType, NullType, PatchType, StringType, StructType, variant } from '@elaraai/east';
import e3 from '@elaraai/e3';

const Order = StructType({ customer: StringType, status: StringType, qty: IntegerType });

// What the ERP sends: its whole order book, keyed by its own order id.
const ErpOrder = StructType({ cust: StringType, state: StringType, qty: IntegerType });
const ErpDelivery = DictType(StringType, ErpOrder);

// The load: the delivery and the source's entries as they stand, to a patch of
// them. It sees the ERP's own ids; e3 puts the source's case on each key, and
// takes it off again.
const loadErp = East.function(
  [ErpDelivery, DictType(StringType, Order)], PatchType(DictType(StringType, Order)),
  ($, delivery, current) => East.diff(current, delivery.map(($, o) => ({ customer: o.cust, status: o.state, qty: o.qty }))),
);

export const orders = e3.recordComposite('orders', Order, {
  // Declared first: the parts after it are handed the types it makes.
  sources: (source) => ({
    erp: source.load(StringType, ErpDelivery, loadErp),  // the ERP's orders: written by this load alone
    own: source.mutations(StringType),                   // the solution's own: written by the mutations
  }),
  initial: { own: new Map() },                           // a solution source's entries, by its own key
  indexes: (index) => ({ by_customer: index.on(['customer']) }),
  mutations: (mutation, { state }) => ({
    plan_order: mutation.edit(East.function(
      [state, StringType, Order, e3.mutation.editType(state)], NullType,
      ($, _current, id, order, edit) => { $(edit.set(variant('own', id), order)); })),
    patch: mutation.patch(),
  }),
});
// orders.type: Dict<Variant{ erp: String, own: String }, Order>
```

- `source.load(key, delivery, fn, { runner? })` takes the source's key type,
  what it is delivered — a type, as here, or a dataset of the package (§4.4) —
  and `fn: (delivery, Dict<key, Row>) -> Patch(Dict<key, Row>)`. The function
  must be pure and synchronous, as a mutation's body is.
- `source.mutations(key)` declares a solution source.
- The builders after `sources` are handed the record's types as a second
  argument, `{ state, key }`: `(mutation, { state }) => …`,
  `(index, { key }) => …`, `(migration, { state }) => …` (F10). A plain
  `e3.record` gets the same argument, built from its declared type.
- A composite has no initial state of its own. `initial` names, for each
  solution source, its entries by the source's own key, and e3 puts the case
  on. External sources have no initial entries: their entries come from their
  loads.
- A load must give the right entries from one delivery alone, whatever was
  loaded before it, as `East.diff(current, delivery)` does: the dataflow loads
  only its feed's latest value, and loads it again after a rollback (§7.1).

### 4.2 Reading and writing

A composite is read, paged, indexed and bound exactly as a record is. A
mutation names an entry by the record's key, `variant('own', id)`. A write of
an external entry is refused, naming the key and its source:

```
$ e3 mutate . orders.patch '…' -w main
invalid: mutation 'patch' writes .erp "SO-1001", an entry of source 'erp', which only its load writes
```

### 4.3 Loading a delivery: `e3 load`

For a source declared with its delivery's type, as in §4.1:

```
$ e3 load . orders.erp ./erp-orders.beast2 -w main --as-of 2026-11-02T03:00:00
Taking the delivery in… done
Pieces 37/37
Loaded orders.erp at 3f2a9c1e, as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged

$ e3 load . orders.erp '#5e7a3b0c…' -w main            # a stored value, by its hash: the same delivery
orders.erp already holds this delivery, loaded at 3f2a9c1e

$ e3 load . orders.erp ./erp-orders-1-nov.beast2 -w main --as-of 2026-11-01T03:00:00
orders.erp holds a delivery as of 2026-11-02T03:00:00.000, later than this one's 2026-11-01T03:00:00.000: nothing loaded (superseded)

$ e3 history . orders -w main
3f2a9c1e  $load:erp   system:load  2026-11-02T03:00:12Z  delivery 5e7a3b0c as of 2026-11-02T03:00:00.000: 1,204 set, 31 deleted, 98,112 unchanged
9b01d2aa  plan_order  ops@example  2026-11-02T02:58:40Z  …
```

A second load of the source, asked while the first runs, waits its turn, and
the first's place is never taken:

```
$ e3 load . orders.erp ./erp-orders-2.beast2 -w main
Waiting for an earlier load of orders.erp to finish…
Taking the delivery in… done
Pieces 37/37
Loaded orders.erp at 6a90c3e5: 212 set, 4 deleted, 99,131 unchanged
```

From code, the same thing is a job its caller polls:

```ts
import { none, some, variant } from '@elaraai/east';
import { workspaceRecordLoad } from '@elaraai/e3-api-client';

// The delivery is a stored value's hash: a file uploaded with objectUpload,
// or a value the repository already holds.
const loaded = await workspaceRecordLoad(url, 'repo', 'main', 'orders', 'erp',
  { delivery: '5e7a3b0c…', actor: none, asOf: some(new Date('2026-11-02T03:00:00Z')) }, { token },
  { onProgress: (p) => console.log(p) });
// { commit: some('3f2a…'), state: some('…'), delivery: '5e7a…', set: 1204n, deleted: 31n, unchanged: 98112n,
//   outcome: variant('loaded', null) }
```

### 4.4 Loading a task's output: the dataflow

The common case: the source is fed by a task that combines several records
which other systems' feeds keep up to date. Only the source's declaration
changes. Its delivery is the task, and the function's delivery type is the
task's output type:

```ts
// erpOrders and erpLines: records other systems' feeds keep up to date,
// declared elsewhere in the package. The task joins each order to its lines,
// keyed by the ERP's order id.
const combineErp = e3.task('combine_erp', [erpOrders, erpLines], East.function(
  [ErpOrders, ErpLines], ErpDelivery,
  ($, orders, lines) => …,
));

export const orders = e3.recordComposite('orders', Order, {
  sources: (source) => ({
    erp: source.load(StringType, combineErp, loadErp),  // loaded by the dataflow, each time combine_erp's output changes
    own: source.mutations(StringType),
  }),
  // initial, indexes and mutations as in §4.1
});

export const forecast = e3.task('forecast', [orders], …);  // runs on orders as it stands, and again after each load
// erpOrders is combine_erp's input too: reconcile reads it as of the delivery orders holds (§4.6)
export const reconcile = e3.task('reconcile', [orders, erpOrders], …);
```

```
$ e3 dataflow run . main                                # erpOrders changed since the last run
  [START] combine_erp
  [CACHED] forecast                                     # on orders as it stands
  [CACHED] reconcile                                    # erpOrders as of the delivery orders holds
  [DONE] combine_erp [1840ms]
  [START] orders.erp
  [PART] orders.erp 1/37 #1 [140ms]
  …
  [PART] orders.erp 37/37 #37 [212ms]
  [DONE] orders.erp [5120ms]
  [START] forecast                                      # the load's commit is a change of orders
  [START] reconcile
  [DONE] forecast [930ms]
  [DONE] reconcile [610ms]

$ e3 dataflow run . main                                # nothing changed upstream
  [CACHED] combine_erp
  [CACHED] orders.erp
  [CACHED] forecast
  [CACHED] reconcile

$ e3 history . orders -w main
5c81e0d7  $load:erp   system:dataflow  2026-11-02T03:00:12Z  delivery 9d4f2a61: 1,204 set, 31 deleted, 98,112 unchanged

# after a rollback of orders to before 5c81e0d7: the record forgets the delivery,
# and the next run loads the feed again, its pieces from the cache
$ e3 dataflow run . main
  [CACHED] combine_erp
  [START] orders.erp
  [START] forecast                                      # orders as the rollback left it
  [DEFER] reconcile: orders.erp's delivery was forgotten, so nothing says which erpOrders orders holds: it runs once orders.erp loads again
  [PART] orders.erp 1/37 #1 (cached) [2ms]
  …
  [DONE] forecast [930ms]
  [DONE] orders.erp [380ms]
  [START] forecast
  [START] reconcile                                     # the load's commit carries erpOrders again
  [DONE] forecast [930ms]
  [DONE] reconcile [610ms]

$ e3 load . orders.erp ./erp-orders.beast2 -w main
invalid: orders.erp is fed by .tasks.combine_erp.output, and the dataflow loads it: run e3 dataflow run . main --filter orders.erp
```

A source fed by an input the package gives a value waits until someone sets
it (ruling 9), and the record's readers wait with it (ruling 10). They wait
only while a load cannot run, as here or before a source's first delivery: a
load that is running holds none of them up (ruling 11, §4.6).

```
$ e3 dataflow run . main
  [WAIT] orders.erp: input 'erp_extract' holds its package's value: set it, and orders.erp loads it
  [WAIT] forecast: record 'orders' waits on its load orders.erp
  [WAIT] reconcile: record 'orders' waits on its load orders.erp
…
3 tasks wait on an input that is not set, or on a record's load: set the input, or load the record's sources, and run again.
```

A feed may be a task, an input or another record. The load is the record's
step in the run, named `<record>.<source>`, and its counts are in the record's
history.

### 4.5 A view over it

```tsx
const ordersView = East.function([], UIComponentType, (_$) => (
  <Reactive>{$ => {
    const record = $.let(Record.bind(orders));
    // The ERP's rows draw locked, saying whose they are; Apply never names one.
    // A new row is the solution's: the Sheet keys it variant('own', …).
    return <Sheet record={record} columns={{
      customer: Sheet.column.text(Order, { header: "Customer" }),
      status: Sheet.column.text(Order, { header: "Status" }),
    }} />;
  }}</Reactive>
));
```

In the Sheet:

- Each of the ERP's rows is locked: its cells carry `data-locked`, and its
  lock's words are `loaded from erp`.
- An edit, a delete, a paste or a fill over a locked row is refused with those
  words, and nothing is staged.
- A row added is the solution's: Apply sends its key as `.own "<id>"`, the
  `.east` text of `variant('own', <id>)`.
- An Apply that names an external entry anyway — through the entry form, say —
  is rejected before any commit: `entry .erp "SO-1001" is source erp's, which
  only its load writes`.

### 4.6 While people edit

People edit the solution's orders several times a minute, and the ERP's load
runs for a quarter of an hour each hour. Nothing waits for it (ruling 11).
Each edit commits as it is made, the load commits once, and every result
lands (ruling 12).

**One reader.** `forecast` reads `orders` and takes 3 minutes:

```
time   erp (its load alone)    own (edits alone)  head  forecast (reads orders, 3 min)
-----  ----------------------  -----------------  ----  ----------------------------------------
10:00  load starts                                c0    starts on c0
10:02                          m1 commits         m1    |
10:03                                             m1    c0 result lands; starts on m1
10:04                          m2 commits         m2    |
10:05                          m3 commits         m3    |
10:06                                             m3    m1 result lands; starts on m3
  ...  pieces running          more edits         ...   one run every 3 minutes
10:12                                             m7    m5 result lands; starts on m7
10:14  load commits L                             L     |
10:15                                             L     m7 result lands; starts on L
10:16                          m8 commits         m8    |
10:18                                             m8    L result lands; starts on m8
10:21                                             m8    m8 result lands; nothing moved since
```

Each source has one writer, so each commit is a whole record:

```
commit  erp         own
------  ----------  ------------------
c0      delivery 1  as it was at 10:00
m3      delivery 1  + m1, m2, m3
L       delivery 2  + m1 .. m7
m8      delivery 2  + m1 .. m8
```

The load read `erp` at 10:00, and nothing else writes `erp`, so its patch
still fits at 10:14, on top of m1–m7 (§7.6). Each run of `forecast` covers
every edit that arrived while the one before it ran: the run from 10:06 covers
m2 and m3 together.

**Two readers, combined.** `plan` reads `forecast` and `capacity`, each made
from `orders`. It runs as of the commit its older input came from, and reads
the other's result at that commit from the execution cache, or runs that task
there once (§7.8). Here the head moves every 15 seconds:

```
time      head  forecast (3 min)          capacity (50 s)             plan (1 min)
--------  ----  ------------------------  --------------------------  -------------------------------------------
10:00:00  c0    starts on c0              starts on c0
10:00:50  c3    |                         c0 lands; starts on c3
10:01:40  c6    |                         c3 lands; starts on c6
10:02:30  c10   |                         c6 lands; starts on c10
10:03:00  c12   c0 lands; starts on c12   |                           starts on c0: capacity's c0 from the cache
10:03:20  c13   |                         c10 lands; starts on c13    |
10:04:00  c16   |                         |                           c0 lands
10:04:10  c16   |                         c13 lands; starts on c16
10:05:00  c20   |                         c16 lands; starts on c20
10:05:50  c23   |                         c20 lands; starts on c23
10:06:00  c24   c12 lands; starts on c24  a catch-up starts on c12    waits for capacity at c12
10:06:40  c26   |                         c23 lands; starts on c26
10:06:50  c27   |                         the catch-up lands          starts on c12
10:07:30  c30   |                         c26 lands; starts on c30    |
10:07:50  c31   |                         |                           c12 lands
```

At 10:03 the cache answers, since both inputs started on c0 with the run.
After that, `capacity` is always busy, and has always moved past the commit
`forecast` started on: it ran on c10 and c13, never on c12. So each run of
`plan` waits for a catch-up run of `capacity` at that commit, beside
`capacity`'s own run. That is one more run of `capacity`, and its 50 seconds,
per run of `plan`, and the catch-up writes nothing to the workspace. When no
edit lands between the two inputs' starts, they share a commit and the cache
answers, as at 10:03. Neither input waits for the other, and `plan` never
computes on a mix.

What `e3 dataflow run` prints for these rows, after its header. A catch-up
run has lines of its own, and a task due again prints nothing until it
starts:

```
  [START] forecast
  [START] capacity
  [DONE] capacity [50110ms]
  [START] capacity
  [DONE] capacity [50090ms]
  [START] capacity
  [DONE] capacity [50130ms]
  [START] capacity
  [DONE] forecast [180040ms]
  [START] forecast
  [START] plan
  [DONE] capacity [50100ms]
  [START] capacity
  [DONE] plan [60020ms]
  [DONE] capacity [50120ms]
  [START] capacity
  [DONE] capacity [50080ms]
  [START] capacity
  [DONE] capacity [50110ms]
  [START] capacity
  [DONE] forecast [180030ms]
  [START] forecast
  [CATCH-UP] capacity for plan
  [DONE] capacity [50090ms]
  [START] capacity
  [DONE] capacity for plan [50120ms]
  [START] plan
  [DONE] capacity [50100ms]
  [START] capacity
  [DONE] plan [60010ms]
```

**A reader of the feed's upstream, while the load runs.** `combine_erp` makes
the ERP's delivery from `erpOrders`, and `reconcile` reads `orders` and
`erpOrders`. Each commit of `orders` carries the version of `erpOrders` its
ERP entries came from (§7.8), so `reconcile` reads `erpOrders` there, from its
history:

```
time   erpOrders   the ERP's load                  orders (carries)  reconcile (reads orders, erpOrders)
-----  ----------  ------------------------------  ----------------  --------------------------------------
10:00  e2 commits  combine_erp starts on e2        m4 (e1)           not due: orders still carries e1
10:01                                              m5 (e1)           starts on m5, erpOrders at e1
10:02              combine_erp lands; the load     m5 (e1)           |
                   starts on its output
10:03                                              m6 (e1)           m5 lands; starts on m6, erpOrders at e1
  ...              pieces running                  ...               ...
10:17              the load commits L              L (e2)            starts on L, erpOrders at e2
```

`reconcile` follows people's edits all through the load, and never compares
an order with a newer copy of itself.

### 4.7 A change, one step at a time

`clean` reads `orders` and takes a minute, `forecast` reads `clean`'s output
and takes 3, and `report` reads `forecast`'s and takes 30 seconds. An edit
lands while `forecast` runs:

```
time      head  clean (1 min)       forecast (3 min)                report (30 s)
--------  ----  ------------------  ------------------------------  --------------------------
10:00:00  c0    starts on c0
10:01:00  c0    c0 lands            starts on clean's c0
10:01:30  m1    starts on m1        |
10:02:30  m1    m1 lands            |
10:04:00  m1                        c0 lands; starts on clean's m1  starts on forecast's c0
10:04:30  m1                        |                               c0 lands
10:07:00  m1                        m1 lands                        starts on forecast's m1
10:07:30  m1                                                        m1 lands; nothing is due
```

- **10:01:30.** The view that made `m1` starts a run, which hands the edit to
  this one (§4.8). `clean` is idle, so it starts on `m1` at once.
- **10:02:30.** `clean`'s result lands while `forecast` runs on the one before
  it. `forecast` is not stopped: it is due again, and is asked as it lands.
- **10:04:00.** `forecast`'s result from `c0` lands, and `report`, which has
  no result in the run yet, runs on it. `forecast` starts again, on `clean`'s
  `m1` result.
- The workspace holds each result as it lands, and none is taken back while
  the next is made: from 10:02:30 `clean`'s output is the one from `m1`, and
  until 10:07:00 `forecast`'s is the one from `c0`.
- **10:07:30.** No task is due, ready, in flight or catching up, so the run
  ends.

What the run prints, after its header and before its summary:

```
  [START] clean
  [DONE] clean [60010ms]
  [START] forecast
  [START] clean
  [DONE] clean [60020ms]
  [DONE] forecast [180030ms]
  [START] forecast
  [START] report
  [DONE] report [30010ms]
  [DONE] forecast [180020ms]
  [START] report
  [DONE] report [30020ms]
```

An edit that no start follows — `e3 mutate`, or a write from another process
— is taken in at the run's next completion instead: here `clean` would start
on `m1` at 10:04:00, when `forecast` lands.

### 4.8 An edit handed to the run

A view writes, then starts a run. The start answers a `DataflowStartResult`:
`started` when it began a run, and `handed` when a run was in flight and took
the edit in (§7.8). Through the client:

```ts
import { dataflowExecuteLaunch, dataflowExecutePoll } from '@elaraai/e3-api-client';

const answer = await dataflowExecuteLaunch(url, 'repo', 'main', {}, { token });
// no run in flight:                  variant('started', null)
// a run in flight took the edit in:  variant('handed', { since: 1842n })

// `since` is the run's next event: follow the run from there.
const state = await dataflowExecutePoll(url, 'repo', 'main', { since: 1842n }, { token });
```

Both answer HTTP 202. A start given `filter` or `force` asks for a run of its
own, so it is refused `workspace_locked` while a run is in flight, as today;
so is any start while the run in flight is stopping.

From the terminal, against a server whose run is in flight:

```
$ e3 dataflow run https://e3.example.com/repos/acme main
Starting tasks in workspace: main

A run is in flight on main: it takes your changes in now.
  [START] capacity
  [DONE] capacity [50120ms]
  …
```

It prints the run's lines from `since`, not from the run's first event, and
the run's summary when it ends. Ctrl-C stops following and leaves the run
running, since this start did not begin it, and the command exits 130, as an
interrupted one does:

```

Received SIGINT, aborting...
Stopped following the run on main, which goes on.
```

In the run, the wake is §7.8's timeline: the run looks for changed inputs at
once, and a task that is idle starts on the edit then.

### 4.9 What a task reads

In a run each dataset's version is a version vector: the commits and values
it came from, each entry written below as the dataset's name and its version.
A record's version is its commit, with what its fed sources carry; a result's
is the version its task was launched with. For §4.6's `reconcile`, `erpLines`
is at `l1`, and `erpOrders` moves from `e1` to `e2` at 10:00:

| Dataset | Its version |
|---|---|
| `erpOrders` | `erpOrders e2` |
| `erpLines` | `erpLines l1` |
| `combine_erp`'s output, launched on `e1` | `erpOrders e1, erpLines l1` |
| `orders` at `m5`, its ERP entries loaded from that output | `orders m5, erpOrders e1, erpLines l1`, the last two from `$load.erp.feed` |
| `orders` at `L`, which loaded the output launched on `e2` | `orders L, erpOrders e2, erpLines l1` |

`stepTaskCommits` gives each task the commit it reads of each record:

| Task, as it is prepared | Its inputs' versions | The commits it reads |
|---|---|---|
| `reconcile` at 10:01 | `orders m5, erpOrders e1, erpLines l1`; `erpOrders e2` | `orders m5`; `erpOrders e1`, the version `orders` carries |
| `reconcile` at 10:17 | `orders L, erpOrders e2, erpLines l1`; `erpOrders e2` | `orders L`; `erpOrders e2` |
| `plan` at 10:06:00 (§4.6) | `forecast`'s `orders c12`; `capacity`'s `orders c20` | `orders c12`, the older |

So at 10:01 `reconcile` reads `erpOrders` at `e1` from its history, though its
head is `e2`. At 10:06:00 `plan` reads `forecast`'s result as it stands, and
`capacity`'s at `c12`. The cache has none there, since `capacity` ran on
`c10` and `c13`, so a catch-up run makes it (§4.6).

### 4.10 When a task waits for its inputs to agree

A task never waits for results made from different commits of a record (§4.6,
§4.9). It is deferred in four narrow cases, each because nothing says which
version of an input to read. The run says why when it defers the task, once
for each reason until the task next starts, and the task's `[START]` follows
once its inputs agree:

```
  [DEFER] plan: input 'rates' is read at two values (through forecast and capacity): it runs once they agree
  [DEFER] reconcile: orders.erp's delivery was forgotten, so nothing says which erpOrders orders holds: it runs once orders.erp loads again
  [DEFER] audit: orders and invoices hold deliveries made from different versions of erpOrders: it runs once their loads catch up
  [DEFER] check: orders holds a delivery made from an earlier value of input 'erp_extract': it runs once orders.erp loads the new one
```

1. **A plain input read at two values.** `forecast` and `capacity` both read
   the input `rates`, and `plan` reads both. Someone sets `rates` while
   `forecast` runs, and `capacity` runs on the new value first. An input keeps
   no earlier value to read, so `plan` waits until `forecast` has run on the
   new value too.
2. **A forgotten delivery.** A rollback undid `orders.erp`'s delivery (§4.12).
   `reconcile` reads `orders` and `erpOrders`, and nothing says which
   `erpOrders` the ERP's entries came from, so it waits until the run loads
   the feed again. `forecast`, which reads `orders` alone, runs at once.
3. **Two fed records carrying different versions of one upstream.** `orders`
   and `invoices` are each fed by a task that reads `erpOrders`, and `audit`
   reads both. While `orders` holds a delivery made from `e1` and `invoices`
   one made from `e2`, `audit` waits for `orders`'s load to catch up.
4. **A fed record beside the plain input that feeds it.** `orders.erp` is fed
   by the input `erp_extract`, and `check` reads `orders` and `erp_extract`.
   Once someone sets `erp_extract`, `check` waits until `orders.erp` has
   loaded the new value.

Case 3 holds for two sources of one record too (ruling 31): where `orders`'s
`erp` and `wms` are each fed from `erpOrders`, a task that reads `orders` and
`erpOrders` waits for the slower load, and is told the two:
`orders.erp and orders.wms hold deliveries made from different versions of
erpOrders`. A task that reads `orders` alone runs on it.

In cases 2 to 4 the task waits for a load's commit. Where that load cannot
commit in the run — `--filter` leaves it out, or it failed or waits — the
task waits on the load instead, and the run ends without it (ruling 29):

```
  [WAIT] check: record 'orders' waits on its load orders.erp
```

A remote run's caller sees no `[DEFER]` line: the API serves no deferral
(§10).

### 4.11 A load's commit, worked

The ERP's load prepared on `c0`: it stored the source's run `R0`, and its
pieces computed the delta `D` from it. While they ran, people's edits `m1` and
`m2` landed (§7.6):

| Attempt | Reads the head | Walks back to `checked` | Applies | `checked` after | Its write |
|---|---|---|---|---|---|
| 1 | `m2` | `m2`, `m1`: mutations, each storing its delta | `D`, once, onto `m2` | `m2` | refused: `m3` landed first |
| 2 | `m3` | `m3`: a mutation | `m3`'s delta, onto attempt 1's result | `m3` | the commit `L`, its parent `m3` |

However many edits land, `D` is applied once: each later attempt applies only
the few ops of what landed since the one before.

```
$ e3 history . orders -w main
8e1f20c4  $load:erp   system:dataflow  2026-11-02T10:14:02Z  delivery 4a7c19e2: 1,204 set, 31 deleted, 98,112 unchanged
6b2d9f13  plan_order  ops@example      2026-11-02T10:13:58Z  …
```

Where the walk meets a commit with no delta, or a load of the same source,
the load checks the entries instead:

| What landed during the load | The check | Then |
|---|---|---|
| `$reindex`, which leaves the entries as they are | the source's run of the head equals `R0` | `D` once onto the head, and the commit |
| a rollback past the ERP's previous load, which changes `erp`'s entries | it differs | a restart: "the entries of source 'erp' changed under its load" |
| a `$load:erp` of the same delivery, by a run another process took up | it differs, so the node restarts, and its prepare finds the slots naming the delivery | `[CACHED]`: nothing is applied twice |

A restart prepares again on the new head, and the pieces whose entries did not
change come from the cache. With `erp` delivered by `e3 load`, as in §4.3,
the load job says so:

```
$ e3 load . orders.erp ./erp-orders.beast2 -w main
Taking the delivery in… done
Pieces 37/37
Loading again: the entries of source 'erp' changed under its load
Pieces 37/37 (35 from the cache)
Loaded orders.erp at 0c7a5d31: 1,204 set, 31 deleted, 98,112 unchanged
```

With `erp` fed by `combine_erp`, as in §4.4, the run's load node goes back to
pending and starts again:

```
  [START] orders.erp
  [PART] orders.erp 1/37 #1 [140ms]
  …
  [PART] orders.erp 37/37 #37 [212ms]
  [START] orders.erp
  [PART] orders.erp 1/37 #1 (cached) [2ms]
  …
  [DONE] orders.erp [610ms]
```

### 4.12 The slots, step by step

The record ref's reserved slots (§6) for `orders`, its `erp` source fed by
`combine_erp`. A blank cell is a slot the ref does not hold. A `.feed` is
written as East prints the version vector (`printFor(VersionVectorType)`);
here, its entries.

| Slot | Minted (`a1`) | First load (`5c81e0d7`) | An edit (`9b01d2aa`) | Second load (`8e1f20c4`) | Then rolled back to `9b01d2aa` | Or rolled back to `a1` |
|---|---|---|---|---|---|---|
| `$external` | `erp` | `erp` | `erp` | `erp` | `erp` | `erp` |
| `$pending` | `erp` | | | | | `erp` |
| `$load.erp` | | `9d4f2a61…` | `9d4f2a61…` | `4a7c19e2…` | | |
| `$load.erp.load` | | `7c3e0a95…` | `7c3e0a95…` | `7c3e0a95…` | | |
| `$load.erp.commit` | | `5c81e0d7…` | `5c81e0d7…` | `8e1f20c4…` | | |
| `$load.erp.execution` | | `<inputsHash>/<executionId>` | the same | the second load's | | |
| `$load.erp.feed` | | `erpOrders e1, erpLines l1` | the same | `erpOrders e2, erpLines l1` | | |
| `$load.erp.asOf` | | | | | | |

- **Minted.** The deploy's `$init` writes `$pending` and `$external`, and the
  record's readers wait: `[WAIT] forecast: record 'orders' waits for the first
  delivery of erp`.
- **First load.** Its commit's args say `first: true`, and `$pending` goes.
  The readers run, in the same run.
- **An edit** carries every slot as it is.
- **Second load.** Its args say `first: false`.
- **Rolled back to `9b01d2aa`.** The rollback undoes the second load, so its
  slots go, though the record holds the first delivery's entries again: a
  rollback forgets each delivery it undoes (ruling 7). `$load.erp.execution`
  no longer names the load node's execution, so the run in flight, or the
  next, loads the feed again (`[START] orders.erp`), and its pieces come from
  the cache.
- **Rolled back to `a1`** instead, the rollback undoes the first delivery too:
  `$pending` names `erp` again, and the readers wait, as after the mint.
- **And then rolled back again, to `9b01d2aa`** (R80). A rollback's commit
  sits on the head it rolls back from, so a further rollback can reach a
  commit the first one undid. The state it commits holds `erp`'s rows again,
  so `$pending` goes blank and the readers run. The `$load.erp` slots stay
  blank: a commit keeps no copy of them. So the run in flight, or the next,
  loads the feed again, its pieces from the cache.

**A record made composite from rows it already holds** (ruling 16, R78). A
record in use becomes composite by a declared migration that puts each row
under its source's case:

```ts
// Before: one record, its rows taken from the ERP's export
export const orders = e3.record('orders', DictType(StringType, Order), { /* … */ });

// After: the same rows, each under the source that owns it
export const orders = e3.recordComposite('orders', Order, {
  sources: (source) => ({
    erp: source.load(StringType, ErpDelivery, loadErp),
    own: source.mutations(StringType),
  }),
  migrations: (migration, { key }) => [
    migration.rekey('by_source', East.function(
      [StringType, Order], StructType({ key, value: Order }),
      ($, id, order) => ({ key: variant('erp', id), value: order }))),
  ],
  // indexes and mutations as in §4.1
});
```

| Slot | The deploy that migrates | The first load |
|---|---|---|
| `$external` | `erp` | `erp` |
| `$pending` | | |
| `$load.erp` | | `5e7a3b0c…` |
| `$load.erp.commit` | | `3f2a9c1e…` |
| the other `$load.erp.*` slots | | as above |

- **The deploy.** The migrated state holds rows under `erp`, so `$pending`
  does not name it (§7.7). The readers run on the record as migrated. Nothing
  waits.
- **The first load** is a load like any other. It diffs its delivery against
  the rows carried over, so a row the delivery does not name is deleted:
  `Loaded orders.erp at 3f2a9c1e: 1,204 set, 31 deleted, 98,112 unchanged`.
  Its commit's args say `first: false`, and a rollback to before it leaves
  the source not waiting: the record holds the rows carried over again.
- **A source the migration left no row under** waits for its first delivery,
  and the readers with it, as ruling 1 has it.

A source loaded by `e3 load` differs in two slots. It has no `.feed`. Its
`.asOf` holds the latest as-of any of its deliveries carried, as East prints a
DateTime: after `e3 load --as-of 2026-11-02T03:00:00`, it is
`2026-11-02T03:00:00.000`, and a later delivery with no as-of leaves it.

### 4.13 A deploy, while people work

**It stops a run.** A run loads `orders.erp`, and `forecast` runs on `orders`
as it stands. Someone deploys. Within about a second of the deploy announcing
itself, the run stops and says why:

```
$ e3 dataflow run . main
…
  [START] combine_erp
  [START] forecast
  [DONE] combine_erp [1840ms]
  [START] orders.erp
  [PART] orders.erp 1/37 #1 [140ms]
  …
  [PART] orders.erp 21/37 #21 [151ms]
  [CANCELLED] orders.erp
  [CANCELLED] forecast

Stopped: a deploy of main started.
  Completed before it stopped: 1
```

It exits 130, as an aborted run does. The deploy's own output is today's: it
waited about a second for the run to let the workspace go. What stands:

- every result that landed, here `combine_erp`'s: its output stays in the
  workspace;
- every finished piece and execution, in the execution cache.

Nothing starts the run again by itself. The next start — a view's after its
next write, `e3 watch`'s, or a person's — runs under the deployed package, and
the cache answers what the deploy left unchanged:

```
$ e3 dataflow run . main
…
  [CACHED] combine_erp
  [START] orders.erp
  [START] forecast
  [PART] orders.erp 1/37 #1 (cached) [2ms]
  …
  [PART] orders.erp 21/37 #21 (cached) [2ms]
  [PART] orders.erp 22/37 #22 [148ms]
  …
```

A run on a server stops the same way, and its stored `execution_cancelled`
event holds the reason. Its caller sees the run end `aborted` and prints its
summary, as after a stop request made elsewhere today: the API serves no
cancelled run's reason (§10).

**It stops a load job, which goes on after it.** Here `erp` is delivered by
`e3 load`, as in §4.3:

```
$ e3 load . orders.erp ./erp-orders.beast2 -w main
Taking the delivery in… done
Pieces 21/37
Stopped: a deploy of main started. The load goes on once the deploy is done…
Pieces 37/37 (21 from the cache)
Loaded orders.erp at 7d2e41b0: 1,204 set, 31 deleted, 98,112 unchanged
```

The job keeps its place, so no later load of `orders.erp` passes it, and keeps
its delivery while it waits. The intake is not run again: its memo answers. A
deploy that removed the record or the source, or changed the source's key or
delivery type, fails the job instead, with `the deploy removed source 'erp'
of record 'orders'`, `the deploy removed record 'orders'`, `the deploy changed
the key type of source 'erp' of record 'orders'`, or `the deploy changed the
delivery type of source 'erp' of record 'orders'`.

**Writes are refused while it waits.** From the moment a deploy announces
itself until it is done — its wait, at most 30 seconds, then the deploy — every
mutation, set, export, copy and run start on the workspace is refused at once,
with:

```
Workspace 'main' is locked by a deploy in process 51234 (since 2026-11-02T10:05:00.000)
```

A view's write is refused `workspace_locked` with the same holder, and a load
job waits it out, as above. `e3 workspace deploy --plan` announces nothing and
stops nothing: it plans under the workspace's lock taken shared, beside
running work.

### 4.14 Two loads of one record

`orders` has two fed sources: `erp`, fed by `combine_erp`, and `web`, fed by
`combine_web`. People edited `orders` since the last run, and both feeds
changed. Each load commits on its own, a change of `orders`, and a reader
running when both land runs once more, for both:

```
  [START] combine_erp
  [START] combine_web
  [START] forecast                                      # on orders as it stands, with the edits
  [DONE] combine_web [920ms]
  [START] orders.web
  …
  [DONE] combine_erp [1840ms]
  [START] orders.erp
  …
  [DONE] orders.web [2210ms]
  [DONE] orders.erp [5120ms]
  [DONE] forecast [180020ms]
  [START] forecast                                      # once, for both loads
  [DONE] forecast [180010ms]
```

## 5. Requirements

Each row is one requirement of the target behaviour, numbered. **Shown in**
names the example that shows it, where one does, and the example is part of
the requirement. **Built by** names its tasks (§11). **Tested in** names the
spec that checks it, under `libs/e3/packages/` or `libs/east-ui/packages/`.
The test's title begins with the requirement's number (`R34 — …`), so a number
with no test is a gap a reviewer sees. These specs are new:

- `e3/src/record-composite.spec.ts`
- `e3-core/src/record-load.spec.ts`, `record-load-commit.spec.ts`,
  `record-composite.spec.ts`, `deploy-lock.spec.ts`, `dataflow-follow.spec.ts`,
  `dataflow-loads.spec.ts` and `upgrades/dataflow-graph-loads.spec.ts`
- `e3-cli/src/commands/load.spec.ts`
- `e3-api-tests/src/suites/records-load.ts` and `object-upload.ts`

**Declaring and writing**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R1 | A composite is declared | Its type is `Dict<Variant{ <source>: <key>… }, row>`. The parts after `sources` are handed `{ state, key }`, and `initial` names each solution source's entries by its own key. | §4.1 | B1, B2 | `e3/src/record-composite.spec.ts` |
| R2 | A declaration breaks a rule: a name that is not an identifier, no source, a load that is async, calls a platform function or has the wrong signature, a source fed by its own record, mutations with no solution source, an external source in `initial` | Refused at build, naming the record and the source. | — | B1, B2 | `e3/src/record-composite.spec.ts` |
| R3 | A package names a task `<record>.<source>`, or a task feeds a load and reads its record | The package is refused at build, naming the clash, or the cycle's steps. | — | B5 | `e3/src/package.spec.ts` |
| R4 | A mutation edits, reduces or patches an entry of an external source | Refused as `invalid`, naming the key and the source. Nothing is written. | §4.2 | C2 | `e3-core/src/records.spec.ts` |
| R5 | `e3 seed` of a composite | Refused, naming `e3 load` and the record's mutations. | — | C9 | `e3-cli/src/commands/seed.spec.ts` |

**Loading a delivery**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R6 | `e3 load` of a delivery | It is taken in, run in pieces, and committed once as `$load:<source>`, with its counts and its as-of. | §4.3 | C4, F1 | `e3-core/src/record-load.spec.ts`, `e3-cli/src/commands/load.spec.ts` |
| R7 | A load's patch names a key outside its source, or outside its piece's keys | The load fails, naming the key. Nothing is committed. | — | B3, C3 | `e3/src/record-programs.spec.ts`, `e3-core/src/record-load-commit.spec.ts` |
| R8 | A load's function replaces (`replace`) | It replaces the piece's entries of its source, never the record. | — | B3 | `e3/src/record-programs.spec.ts` |
| R9 | A new delivery that changes nothing | It commits once, `0 set, 0 deleted`, so the history and the slots record it. | — | C3, C4 | `e3-core/src/record-load.spec.ts` |
| R10 | The same delivery again, under the same load declaration | Answered "already loaded" (`again`) by the commit that applied it, whatever committed since, unless a rollback or restore undid it. Nothing runs. In a run, the load is `[CACHED]`. | §4.3, §4.4 | C4, C16 | `e3-core/src/record-load.spec.ts`, `dataflow-loads.spec.ts` |
| R11 | A delivery whose as-of is older than the source's | Answered `superseded`, naming the source's as-of. Nothing runs or commits. | §4.3 | C4, F1 | `e3-core/src/record-load.spec.ts`, `e3-cli/src/commands/load.spec.ts` |
| R12 | A delivery whose as-of is the source's or later, or that has none | Loaded. The source's as-of becomes the later of the two; a delivery without one leaves it. | §4.12 | C3, C4 | `e3-core/src/record-load.spec.ts` |
| R13 | The same delivery after the load's function changed (a redeploy) | It applies again under the new function. | — | C4 | `e3-core/src/record-load.spec.ts` |
| R14 | Two loads of one source | One at a time, in the order asked. The second waits for the first, however long it takes, saying `Waiting for an earlier load of orders.erp to finish…`, and keeps its place: a third asked after it applies after it (ruling 37). A fed source has one load at a time, its workspace's one run. | §4.3 | C4, D1, F1 | `e3-core/src/record-load.spec.ts`, `e3-cli/src/commands/load.spec.ts` |
| R15 | Loads of two sources | Side by side, each committing its own run. | — | C4 | `e3-core/src/record-load.spec.ts` |
| R16 | A mutation, or another source's load, commits while a load runs | It commits as it does today, and the record's readers run on it (ruling 11). The load's commit folds it in from its stored delta, and applies its own delta once, whatever lands. | §4.6, §4.11 | C3 | `e3-core/src/record-load-commit.spec.ts` |
| R17 | A rollback, restore, migration, reset or reindex lands while a load runs | At its commit, the load reads the source's entries again. As they were, it commits over the new head; changed, it starts again, reusing every piece still valid, and a job says `Loading again: the entries of source 'erp' changed under its load`. | §4.11 | C3, C4, C17, F1 | `e3-core/src/record-load-commit.spec.ts`, `record-load.spec.ts`, `dataflow-loads.spec.ts` |
| R18 | A load's commit loses a race | Only a ref conflict is retried, with no cap or deadline, and each attempt applies only what landed since the one before. An apply error or a storage failure fails the load. | §4.11 | C3 | `e3-core/src/record-load-commit.spec.ts` |
| R19 | A load is stopped (a deploy, Ctrl-C, a crash) | Asked again, it resumes: finished pieces are answered from the execution cache. | §4.13 | C4 | `e3-core/src/record-load.spec.ts` |
| R20 | `e3 load` names a fed source | Refused, naming the feed and the run that loads it. | §4.4 | C4, D2, F1 | `e3-cli/src/commands/load.spec.ts`, `e3-api-tests/src/suites/records-load.ts` |
| R21 | `e3 load` of a file against a server | The file is uploaded as an object, writing no ref, and the load job is then polled. | — | D1, D2, D3, F1 | `e3-api-tests/src/suites/object-upload.ts`, `e3-cli/src/commands/load.spec.ts` |
| R22 | A load job whose delivery gc swept before the job was made | It fails: "delivery <hash> is not in the repository: upload it again". | — | C4 | `e3-core/src/record-load.spec.ts` |
| R23 | A load queued behind a load longer than 30 s, or waiting out a deploy longer than 30 s | It goes on waiting: its waits have no bound. | — | C4 | `e3-core/src/record-load.spec.ts` |

**Slots, pending and history**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R24 | Deploy mints a composite | Genesis `$init`: the solution sources' `initial` entries, or none. `$pending` names every external source, fed or not, and `$external` names them all. | §4.12 | C5 | `e3-core/src/record-deploy.spec.ts` |
| R25 | A later deploy keeps or migrates a composite | `$pending` is reconciled (§7.7): a source new to the external set joins it — one changed from `mutations` to `load` too — and one no longer external leaves it, its slots dropped. A migration also drops each external source's delivery slots and keeps its as-of, so a fed source loads again on the next run. | — | C5 | `e3-core/src/record-deploy.spec.ts` |
| R26 | `$reset` (deploy with `--schema reset`) | The record goes back to genesis. Every `$load.` slot is dropped, and `$pending` names every external source again. | — | C5 | `e3-core/src/record-deploy.spec.ts` |
| R27 | A task reads a record whose `$pending` is set | The task waits, as on an unset input, naming the sources yet to deliver. The run goes on without it. | §4.12 | C16, F4 | `e3-core/src/dataflow-loads.spec.ts`, `e3-cli/src/commands/start.spec.ts` |
| R28 | A source's first delivery commits | Its name leaves `$pending`. Once `$pending` is empty the slot is dropped, and the dependents run: in the same run for a fed source; for a delivered one, in a run in flight once it next looks for changes, or in the next run. | §4.12 | C3, C16 | `e3-core/src/record-load.spec.ts`, `dataflow-loads.spec.ts` |
| R29 | A load commits | The slots name its delivery, its load object, its commit and its execution, the feed's version for a fed source, and the later as-of; its args say whether it took the source out of `$pending`. | §4.12 | C3, C14 | `e3-core/src/record-load-commit.spec.ts` |
| R30 | A rollback or restore undoes a delivery | The source forgets it: its delivery slots are dropped, and it is pending again if its first delivery is undone. A fed source is loaded again by the next run; a delivered one, when it is sent again. | §4.12 | C6 | `e3-core/src/record-composite.spec.ts` |
| R31 | A restore | Every external source's slots are dropped, and `$pending` names those with no entries in the restored state. | — | C6 | `e3-core/src/record-composite.spec.ts` |
| R32 | `$compact` cuts a load's commit from the chain | The slot's commit is emptied, as `$migrations` does. A retry of that delivery is answered "already loaded", with no commit. | — | C5 | `e3-core/src/record-composite.spec.ts` |
| R33 | A record's history and its description | `e3 history` says a `$load:` commit in words, with its as-of, and `--delta` shows its delta. Describe answers each source: external or not, its feed, its last delivery, commit and as-of, and whether it is pending. | §4.3 | C9, F2 | `e3-core/src/record-history.spec.ts`, `e3-cli/src/commands/history.spec.ts` |

**Runs that follow people's edits**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R34 | People edit a record while a task that reads it runs | Each edit commits at once. The task's result lands as it finishes, its output written, and it runs once more, on the newest commit, for every edit that arrived meanwhile — never once per edit. | §4.6 | C12 | `e3-core/src/dataflow-follow.spec.ts` |
| R35 | A task's result lands while its dependents hold results of its earlier run | They keep theirs, and are due once its next result lands, not when the root moves: a change travels a step at a time. | §4.7 | C12 | `e3-core/src/dataflow-follow.spec.ts` |
| R36 | A task whose inputs each have a result in the run | It is ready, whatever those tasks' status, save `waiting`, and starts in the pass of the loop that made it ready — a cache hit's dependents too — never waiting for a task in flight to land first (F35). A task with no result yet in the run runs on what has landed. | §4.7, §4.13 | C12 | `e3-core/src/dataflow-follow.spec.ts` |
| R37 | The run's end | It ends once no task is due, ready, in flight or catching up. A run people keep editing under does not end by itself. | §4.7 | C12 | `e3-core/src/dataflow-follow.spec.ts` |
| R38 | A task reads results made from different commits of a record | It runs as of the oldest: the record from its history, and each other result as it stands or from the execution cache. It never waits for its inputs to agree. | §4.6, §4.9 | C13 | `e3-core/src/dataflow-follow.spec.ts` |
| R39 | … and the cache has no result of a task at that commit | That task runs there once, a catch-up run: `[CATCH-UP] capacity for plan`, then `[DONE] capacity for plan [<ms>]`. It writes nothing to the workspace, and the summary does not count it. | §4.6 | C13, F4 | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts` |
| R40 | … and that task is running on exactly those inputs | The task waits for that run, and nothing runs twice. | — | C13 | `e3-core/src/dataflow-follow.spec.ts` |
| R41 | A catch-up run fails | The task fails, naming the catch-up run's task and the commit. | — | C13 | `e3-core/src/dataflow-follow.spec.ts` |
| R42 | A task reads a fed record and its feed's upstream | It reads the upstream at the version the record's commit carries, from its history, and runs again once the load commits. | §4.6, §4.9 | C13, C14 | `e3-core/src/dataflow-follow.spec.ts` |
| R43 | Two inputs of a task read a plain input at different values | The task is deferred until they agree, saying so (`[DEFER]`): a plain input keeps no earlier value to read. | §4.10 | C13, F4 | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts` |
| R44 | A rollback, restore or migration forgets a fed delivery | Until the next load commits, a task that reads the record and its feed's upstream is deferred, saying so. A task that reads the record alone runs on it. | §4.10 | C13, C14 | `e3-core/src/dataflow-follow.spec.ts` |
| R45 | Two fed records carry different versions of one upstream; or a fed record is read beside the plain input that feeds it, once the input changed | The task is deferred until the loads catch up, saying so. | §4.10 | C13, C14 | `e3-core/src/dataflow-follow.spec.ts` |
| R46 | Which of two commits of a record is older | The run's order of its snapshots; for commits a result named before the run resumed, a walk back from its first snapshot; a commit a compaction cut is the older. | — | C13 | `e3-core/src/dataflow-follow.spec.ts` |
| R47 | A view starts a run while one is in flight | The start is handed to the run, which looks for changed inputs at once, and is answered `handed { since }`. A start that began a run is answered `started`. | §4.8, §7.8 | C15, D2, D3 | `e3-core/src/dataflow-follow.spec.ts`, `e3-api-tests/src/suites/dataflow.ts` |
| R48 | A start with a filter or a force, or any start while the run in flight is stopping | Refused `workspace_locked`, as today. | §4.8 | C15, D2 | `e3-api-tests/src/suites/dataflow.ts` |
| R49 | An edit that no start follows (`e3 mutate`, a write from another process) | The run in flight takes it in at its next completion. | §4.7 | C15 | `e3-core/src/dataflow-follow.spec.ts` |
| R50 | `e3 dataflow run` against a server, its start handed | It says `A run is in flight on main: it takes your changes in now.`, and prints the run's lines from `since`. Ctrl-C stops following and leaves the run running. | §4.8 | F4 | `e3-cli/src/commands/start.spec.ts` |

**Fed loads in a run**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R51 | A run reaches a fed load whose feed changed | The load runs after the feed's task and commits once. Its commit is a change of the record: the readers run again after it, in the same run. Meanwhile they run on the record as it stands. | §4.4 | C16, C17 | `e3-core/src/dataflow-loads.spec.ts` |
| R52 | A fed load's feed has no value, is a record yet to deliver, or is an input holding its package's value | The load waits, saying why, and the record's readers wait with it, before the first delivery and after it. | §4.4 | C16, F4 | `e3-core/src/dataflow-loads.spec.ts`, `e3-cli/src/commands/start.spec.ts` |
| R53 | A fed load's feed changes while it runs or commits | Its commit stands, as any result does, and the load runs again on the new output (ruling 12). | — | C17 | `e3-core/src/dataflow-loads.spec.ts` |
| R54 | A fed load fails (ruling 15) | The node fails and says so at once. The record keeps its last commit and the run goes on: every other task follows people's edits. The node runs again when its feed moves. A run whose load stands failed at its end ends failed, naming it. No task depends on the load, so none is skipped. | §7.8, "Fail" | C17 | `e3-core/src/dataflow-loads.spec.ts`, `e3-core/src/contract/dataflow.ts` |
| R55 | Two load nodes of one record | Each commits on its own, a change of the record. A reader running when both land runs once more, for both. | §4.14 | C17 | `e3-core/src/dataflow-loads.spec.ts` |
| R56 | A load node commits while the run goes on | Its commit runs outside the run's mutex: other tasks complete and cache hits apply meanwhile. A yield waits for the commit, and a cancel stops it before its write. | — | C17 | `e3-core/src/dataflow-loads.spec.ts` |
| R57 | `--force` or `--filter` over load nodes | A forced load node runs past the cache and the slots, and commits only if its delta changes something. `--filter orders.erp` runs it and what it depends on; `--filter forecast` loads nothing. | — | C17 | `e3-core/src/dataflow-loads.spec.ts` |
| R58 | The run's graph | A load node per fed source, depending on its feed's task. No node depends on a load node, and the record stays a root input. A name that clashes, and a cycle, are refused. | — | C11, D2 | `e3-core/src/dataflow.spec.ts`, `e3-api-tests/src/suites/dataflow.ts` |
| R59 | History's prune, with a load node | It keeps the load node's current execution, named by the record's slot. | — | C19 | `e3-core/src/history.spec.ts` |
| R60 | A repository whose stored runs predate load nodes | The upgrade step writes `load: none` on every node of every stored run. A run already in the new form, or in neither, is left as it is. | — | A4 | `e3-core/src/upgrades/dataflow-graph-loads.spec.ts` |

**Deploys and locks**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R61 | A deploy starts while a run is in flight, loading or not | Within about a second the run stops: each task in flight prints `[CANCELLED]`, then `Stopped: a deploy of main started.` and `Completed before it stopped: N`, N the tasks with a result in the run, and the run exits 130. Every result it landed stands, and finished pieces and executions stay cached. Nothing restarts it; the next run runs under the deployed package, the cache answering what the deploy left. | §4.13 | C18, F4 | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts`, `e3-api-tests/src/suites/dataflow.ts` |
| R62 | A deploy starts while a load job runs | Within about a second the load stops and lets the workspace go, saying `Stopped: a deploy of main started. The load goes on once the deploy is done…`. It keeps its place and its delivery, and goes on once the deploy is done. | §4.13 | C4, C7, F1 | `e3-core/src/record-load.spec.ts`, `e3-api-tests/src/suites/records-load.ts` |
| R63 | The deploy removes the record or the source, or changes the source's key or delivery type | The stopped load fails, naming what changed. | §4.13 | C4 | `e3-core/src/record-load.spec.ts` |
| R64 | A mutation, set, export, copy or run start while a deploy has announced itself | Refused at once with `Workspace 'main' is locked by a deploy in process <pid> (since <time>)`. | §4.13 | C7 | `e3-core/src/deploy-lock.spec.ts` |
| R65 | A deploy that finds the workspace held by a write | It waits up to 30 s in all, then is refused `workspace_locked`, naming the holder. | — | C7 | `e3-core/src/deploy-lock.spec.ts` |
| R66 | `e3 workspace deploy --plan` | It plans under the workspace's lock taken shared: it announces nothing, and stops nothing. | §4.13 | C7 | `e3-core/src/deploy-lock.spec.ts` |
| R67 | A workspace's removal, or its export as a package, while a run is in flight | Refused, naming the run, as today: stop the run first. | — | C7 | `e3-core/src/deploy-lock.spec.ts` |
| R68 | A deploy over an input that feeds a load | A value someone set is kept, whatever `--inputs` says, while its type is unchanged, and the plan says it is retained, naming the load. A changed type resets it, and the load waits until it is set. | §7.13 | C8, F5 | `e3-core/src/input-deploy.spec.ts`, `e3-cli/src/commands/workspace.spec.ts` |

**Garbage collection, data and e3-web**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R69 | gc while a load job is queued or stopped | Its delivery is kept: the job holds running work from its creation, and re-references the delivery at each turn of its waits. | — | C4, C10 | `e3-core/src/gc.spec.ts` |
| R70 | gc walks a composite | A record object reaches its load objects, and a load object its task object. | — | C10 | `e3-core/src/gc-graph.spec.ts` |
| R71 | `e3 dataset get -f beast2` | It writes the stored segments, locally and remotely, decoding nothing, and the file loads into another workspace. | — | F3 | `e3-cli/src/commands/get.spec.ts` |
| R72 | e3-web's transfer | It holds the two job stores, and its sweep covers them. | — | E1 | `e3-web/src/transfer/WebTransferBackend.spec.ts` |

**Views**

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R73 | A record is bound | The binding names its sources, in the IR, the handle and `UiAccess`. | — | G1 | `e3-ui/test/access/access.spec.ts`, `e3-ui-components/test/record-runtime.spec.ts` |
| R74 | A view's Apply names an external entry | Rejected before any commit, naming the entry and its source. | §4.5 | G2 | `e3-ui-components/test/record-apply.spec.ts` |
| R75 | A Sheet over a composite: an external row | It draws locked, saying whose it is, and an edit, a delete, a paste or a fill over it is refused with those words. | §4.5 | G3 | `e3-ui/test/sheet/sheet-record.spec.ts`, `e3-ui-components/test/sheet-record-rows.spec.ts`, `east-ui-showcase/tests/responsive/sheet-bound.spec.ts` |
| R76 | A Sheet over a composite: a new row | It is the solution source's, keyed `variant('own', <id>)`. The edit session makes the key (R89); no Sheet option does. | §4.5 | L1 | not yet audited (§7.15) |
| R77 | The terminal UI | The records view shows each source, and the dashboard shows a load node as a step of the run after its feed. | — | G5 | `e3-ui-cli/src/tui/data/records.spec.ts` |

R73–R77, and R89 and R90 below, are the builders' (§7.15): their specs' paths
are those of the first audit and are not yet audited.

**Added by the review of 13 November 2026.** R54 above changed with ruling
15. The pull request that builds each is the one §11 gives its task.

| # | Situation | What happens | Shown in | Built by | Tested in |
|---|---|---|---|---|---|
| R78 | A migration makes a record composite and leaves rows under an external source (ruling 16) | The source does not wait. Its readers run on the rows carried over, and its first load diffs against them. A source left no rows waits. | §4.12 | C5 | `e3-core/src/record-composite.spec.ts` |
| R79 | A source changes from `mutations` to `load` while it holds rows | The same: its rows count as delivered (the reviewer's call 2). | — | C5 | `e3-core/src/record-composite.spec.ts` |
| R80 | A rollback commits a state that holds rows of a source in `$pending` | The source leaves `$pending`. Its delivery slots stay forgotten. | §4.12 | C6 | `e3-core/src/record-load.spec.ts` |
| R81 | A function is called while a record among its declared inputs, or the record of an index among them, waits for a first delivery | The call ends `invalid`, naming the record and the sources yet to deliver. Nothing runs. | — | C20 | `e3-core/src/record-composite.spec.ts`, `e3-api-tests/src/suites/calls.ts` |
| R82 | A caller names such a record as a dataset argument | It is read as it stands. | — | C20 | `e3-core/src/record-composite.spec.ts` |
| R83 | A task's input is an index of a record that waits for a first delivery | The task waits, as one that takes the record does. | — | C20, C16 | `e3-core/src/record-composite.spec.ts`, `e3-core/src/contract/dataflow.ts`, `e3-api-tests/src/suites/index-inputs.ts` |
| R84 | A drafted call's draft writes an external entry | The call ends `invalid` in the Save's words, and the body does not run (F41). | — | C2 | `e3-core/src/record-composite.spec.ts`, `e3-api-tests/src/suites/function-drafts.ts` |
| R85 | A load job is cancelled | Before its commit writes the ref, it stops and ends `cancelled`: nothing commits, and its pieces stay cached. After, it ends `completed`, and the cancel is answered that it came too late. | — | C4, D1, D2 | `e3-core/src/record-load.spec.ts`, `e3-api-tests/src/suites/records-load.ts` |
| R86 | A caller the host does not grant a load asks for one | `permission_denied`, naming the record and the source. A host with no rule allows what its mutate route allows. | — | D2 | `e3-api-tests/src/suites/records-load.ts` |
| R87 | A load where the runner cannot run its east-c | Its pieces run on east-node, as a mutation's do. | — | C4, C8 | `e3-core/src/record-load.spec.ts` |
| R88 | The planner cuts a load whose source's entries outweigh its delivery | It decodes no segment to find a boundary. | — | C1 | `e3-core/src/execution/pieces.spec.ts` |
| R89 | A new row in a builder over a composite | Its key is made by the edit session under the solution source's case, in every builder. | — | L1 | not yet audited (§7.15) |
| R90 | A gesture on an external entry, in any builder | Refused where it is made, in the source's words. No draft is made. | — | L2 | not yet audited (§7.15) |
| R91 | A save while a load's pieces hold every core of the process | Its program takes the next core freed. The load holds or waits for no more cores than the budget has. | — | C4 | `e3-core/src/record-load.spec.ts` |
| R92 | A load's commit while people save | Its apply reads and writes only the segments its delta's keys fall in, and takes nothing a save waits for. | §4.11 | C3 | `e3-core/src/record-load-commit.spec.ts` |

## 6. Wires

Package-borne wires change by hard cutover (`docs/conventions/WIRE_MIGRATION.md`):
a package exported before this is re-exported. A stored form changes through
a repository upgrade step. A case added to an existing stored or API variant
is named to sort last, as `LockOperationType`'s `workspace_copy` and
`ApiExecutionStatusType`'s `stopping` were: `InputPlanType`'s `retained` sorts
after `reset`.

| Wire | Change | Kind |
|---|---|---|
| `RecordObjectType` (e3-types `record.ts:576`) | `+ sources: Dict<String, Variant{ load: String, mutations: Null }>`: each source by name, an external one naming its load object. A record object an earlier SDK exported does not decode: a read through it is refused, naming the fix, and gc, which knows a record object by its shape, no longer walks it, as for the index object's `form`. A deploy reads no record object of the deployed package: what it needs of the prior sources is in the ref's `$external` slot | package-borne; re-export |
| `RecordLoadObjectType` (new) | `{ kind: '$recordLoad', key: EastType, delivery: EastType, feed: Option<TreePath>, task: String }`: the source's key and delivery types, the dataset that feeds it, and the load's task object | package-borne; a new kind that names an object, so tagged, with a GC test |
| The load's task object | A `TaskObjectType`, as a split call's is built: inputs and output at `path: []` | package-borne; existing type |
| `DataflowGraphTaskType` (e3-types `dataflow.ts:113`) | `+ load: Option<{ record: String, source: String }>`, after `dependsOn`: `some` on a load node | stored state, each run's graph: a repository upgrade step, `dataflow-graph-loads`, writes `load: none` on every node of every stored run. And the API's graph and run answers: client and server ship together |
| `DataflowStartResultType` (new, e3-types `api.ts`) | `Variant{ handed: { since: Integer }, started: Null }`: the run start's answer, in place of `Null`. `started` began a run; `handed` gave the start to the run in flight, `since` its next event | API; client and server ship together |
| `RecordSignatureType` (e3-types `api.ts:1821`) | `+ sources: Array<{ name, key: EastType, external: Boolean, delivery: Option<EastType>, feed: Option<TreePath>, last: Option<{ delivery: String, commit: Option<String>, asOf: Option<DateTime> }>, pending: Boolean }>` | API; client and server ship together |
| `InputPlanType.action` (e3-types `api.ts:466`) | `+ retained: { load: String }`: an input someone set, kept whatever the policy because it feeds the load named | API; a case named to sort last |
| `RecordLoadRequestType` (new) | `{ delivery: String, actor: Option<String>, asOf: Option<DateTime> }`: a stored object's hash. A delivery never travels by value | API |
| `RecordLoadStatusType` (new) | `Variant{ cancelled: Null, completed: RecordLoadResult, failed: { message }, processing: Option<RecordLoadProgress> }`: every case but `processing` is an end, which the store never moves the job out of, as a split call's job (`SplitCallStatusType`'s `cancelled`, R85) | API |
| `RecordLoadProgressType` (new) | `Variant{ commit, intake: IntakeFile, pieces: { done, total, cached }, queued, restarted: String, stopped }`: `queued` behind an earlier load of the source; `pieces.cached` the pieces the execution cache answered; `restarted` the reason a commit sent the load back to its pieces (§7.6); `stopped` while a deploy holds the workspace | API |
| `RecordLoadResultType` (new) | `{ commit: Option<String>, state: Option<String>, delivery: String, set, deleted, unchanged: Integer, outcome: Variant{ again: Null, loaded: Null, superseded: DateTime } }`: `superseded` carries the source's as-of; `again` and `superseded` carry no counts (0) | API |
| `RecordLoadArgsType` (new) | `{ delivery: String, load: String, asOf: Option<DateTime>, first: Boolean, execution: { inputsHash: String, executionId: String }, set, deleted, unchanged: Integer }`: a load commit's `args`. `first` is true when the commit took the source out of `$pending`, which a rollback reads | stored in commits; new |
| `RecordLoadJobType` (new, e3-core `transfer/types.ts`) | the load's job: repo, workspace, record, source, delivery, actor, asOf, status, createdAt | job store; new kind |
| `ObjectUploadJobType` (new, e3-core `transfer/types.ts`) | an upload that writes no ref (F8) | job store; new kind |
| `MutationObjectType` (e3-types `record.ts:124`) | `+ cases: Option<Array<String>>`: the cases of the record's key the mutation may write, `none` for a plain record. Proposed by this revision so that a Save, the patch door and a draft's laying refuse an external write through one check (F41); awaits question 1 (§11.2) | package-borne; re-export |
| `RecordBindingType` (e3-ui `bind/record.ts:121`) | `+ sources: Array<{ name: String, external: Boolean }>` | UI IR; re-export |
| `record_bind` platform function (e3-ui `bind/record.ts:303`) | `+` a literal argument: the record's sources | UI IR; re-export |
| `UiAccessType.records[]` (e3-ui `derive.ts`) | `+ sources` | derived; no store |
| `SheetRowType` (e3-ui `sheet/types.ts:250`) | `+ lock: Option<String>`: the words that lock the row, or none | UI IR; re-export |

The last four rows are the builders' and are not yet audited (§7.15).
`SheetRootType.newRowKey`, which the third revision added, is not added: a
new row's key is the edit session's (the review's section 10, R89), and no
wire changes for it.

Unchanged wires:

- `TaskPartitionType`: a `by` that steps through a variant's case is accepted
  (§7.3). Nothing exported has one, because the SDK and the planner refuse it
  today.
- `TaskObjectType`: a load's task object is an ordinary one.
- `ExecutionEventType` and `TaskStateType`: a load node's events and state are
  a task's, and a task due again goes back to `pending`, as an invalidated one
  does today. No event carries a load's counts (§10), no event says why a task
  waits — the reasons go to the run's caller (§7.8) — and no event records a
  catch-up run (§10). A deferral's `task_deferred` carries, as its
  `conflictPath`, the path its reason names (§7.8), and a run a deploy stopped
  records `execution_cancelled` with the reason `a deploy of main started`
  (§7.9).
- `DataflowExecutionStateType`: a task's output vector is the one it was
  launched with, and a record's is its commit and what its fed sources carry,
  entries of the run's `versionVectors` as today (§7.8). The order of a
  record's commits, and the catch-up runs, are the run's, in memory: a run
  resumed in another process decides each task again, and the execution
  cache answers what finished (F36).
- `MutationResultType`: an external write is the existing `invalid` outcome.
- `DatasetRef`: the slots are entries of its version vector.
- `LockOperationType`: loads take the workspace lock as `dataset_write`, as
  record writes do. The intent lock is taken as `deployment`.

Reserved slots, in the record ref's version vector. Each is text: an as-of is
an East DateTime, and a feed's vector a `VersionVectorType`, each printed and
read through East (`printFor` / `parseFor`):

| Slot | Value | Written by | Dropped by |
|---|---|---|---|
| `$load.<source>` | The last delivery's stored hash | The source's load commits | A rollback or restore that undoes it, a migration, `$reset`, a deploy after which the source is not external |
| `$load.<source>.load` | The load object's hash it ran under | The source's load commits | As `$load.<source>` |
| `$load.<source>.commit` | The commit that applied it; emptied once a compaction cuts it | The source's load commits; `$compact` | As `$load.<source>` |
| `$load.<source>.execution` | `<inputsHash>/<executionId>`: the execution that made its delta | The source's load commits | As `$load.<source>` |
| `$load.<source>.feed` | The version vector of the feed the delivery was made from | A fed source's load commits | As `$load.<source>` |
| `$load.<source>.asOf` | The latest as-of any delivery of the source carried | A load commit whose delivery has an as-of: the later of the two | A rollback or restore that undoes it, `$reset`, a deploy after which the source is not external. A migration keeps it |
| `$pending` | The external sources yet to deliver, sorted, comma-separated | Every deploy of a composite (§7.7); a rollback past a source's first delivery; a restore | The commit that takes its last source out |
| `$external` | The record's external sources at its last deploy, sorted, comma-separated | Every deploy of a composite | A deploy after which the record has none |

Every other commit carries them verbatim (`nextVersions`). The load commit is
named `$load:<source>`, colon-joined as `$migrate:<name>` is, and its `args`
hold a `RecordLoadArgsType`.

## 7. Design by package

### 7.1 e3 (the SDK)

- **`e3.recordComposite(name, row, config)`** (`e3/src/record-composite.ts`,
  new). `config` holds `{ sources, initial?, indexes?, mutations?, migrations?
  }`, with `sources` required and declared first. It builds the sources
  through the `source` builder, then the type `DictType(VariantType({ <name>:
  key… }), row)`, then calls the record's own construction with that type. So
  indexes, mutations and migrations are built and checked exactly as
  `e3.record` builds them. It returns a `CompositeRecordDef<…>`, which extends
  `RecordDef` with `sources` typed by name. `RecordDef` gains an optional
  `sources`, so every consumer of a record takes a composite as it is
  (`e3-ui`'s `Record.bind`, `package.ts:147–151`). The record's `deps` gain each
  fed source's feed, so `e3.package` collects the feed with the record
  (`e3/src/record.ts:164`, `package.ts:90–101`).
- **A composite always holds a state.** Declared with no `initial`, it is
  minted with no entries of its own (R24). So a system commit's `$init` over
  an unassigned record never arises for a composite, a deploy never plans one
  `unassigned` or `unassign` (F46), and `e3 seed`'s refusal (R5) leaves none
  without a first state.
- **The `source` builder** (`record-builders.ts`). Its methods are
  `source.load(key, delivery, fn, { runner? })` and `source.mutations(key)`.
  A load's `delivery` is an East type, delivered by `e3 load`, or a dataset of
  the package — a task (its output), an input or a record — which the dataflow
  loads (§7.8). Refused, naming the record and the source:
  - a name that is not an identifier;
  - no source;
  - a load whose `fn` is async or calls a platform function (`checkPure`, with
    load-specific reasons);
  - a load whose `fn` is not `(delivery, Dict<key, row>) -> Patch(Dict<key,
    row>)`, with `delivery` the feed's type for a fed source (`functionAt`);
  - a source fed by its own record;
  - mutations declared on a record with no `source.mutations` source.

  A delivery is **keyed** when it is a Dict or Set whose key type is the
  source's. A keyed delivery runs in pieces. Any other runs as one piece
  (ruling 4). A source declared with no `runner` names `DEFAULT_RECORD_RUNNER`,
  as a mutation and an index do (`mutation.ts:98`, `record-guards.ts:215`),
  and its units run on any runtime (§7.5, R87).
- **The delivery contract**, in `source.load`'s TypeDoc and the e3 skill. A
  load must give the right entries from one delivery alone, whatever was loaded
  before it: a whole snapshot of the source (a diff of `current` against it, as
  §4.1's does) or an idempotent upsert of the latest state. The dataflow loads
  only the value a feed holds when the run reaches it — a value it held between
  two runs is never loaded — and loads it again after a rollback forgets it
  (ruling 7). A system that sends changes, each the changes since the last, is
  loaded with `e3 load`, one delivery at a time, in order, each with its as-of
  (ruling 8). e3 cannot check this.
- **`e3.package` refuses** a task named `<record>.<source>`, the name of a fed
  source's step in a run, and a cycle through a fed load: a task that feeds a
  load and reads its record, directly or through other datasets. Each refusal
  names what clashes, or the cycle's steps.
- **The types argument** (F10). `record()` passes `{ state: type, key }` as a
  second argument to `indexes`, `mutations` and `migrations`, each of which is
  called with its builder alone today (`e3/src/record.ts:172`, `:186`, `:189`).
  `migrations` returns its steps in order, as a list, as `e3.record`'s does
  (`:46`), and a migration that makes a record composite puts each row under
  its source's case (§7.7, ruling 16). TypeScript infers
  the sources before the parts after them, because the object's properties are
  inferred in order; that is why `sources` comes first.
- **`initial`, per source.** e3 puts each source's case on its entries, and
  refuses an external source named in `initial`. Each source's `initial` is a
  value or a function that makes it, as `e3.record`'s is
  (`e3/src/record.ts:40`, `:152–169`): a large one is made when the package
  is exported, never where a page only binds the record.
- **The load program** (`record-programs.ts`: `buildLoadProgram(rec,
  source)`, generated at export as a mutation's program is, and built free of
  source locations as every record program is, so its bytes are the
  declaration's alone). It is the patch door's program (`dictPatchOps`,
  `:444`, then `dictApply`, `:840`) over the source's entries, with the
  author's function in front, and it takes the record's indexes as the
  mutation program takes them: every index as built, an entries index's lean
  rows and a nested index's span among them (`:1156`).
  1. Take the piece's entries of the source (record keys, all of its case) and
     key them by the case's value, in memory.
  2. Run `fn(deliveryPiece, current)`.
  3. Turn the patch into per-key ops over `current`: a `replace` arm becomes
     inserts, updates and deletes of the piece's keys, and `unchanged` becomes
     none. Each op's `before` is checked against `current`. For a keyed
     delivery, every key the patch names must be a key of the delivery piece or
     of `current`. A key outside them is not an error the program throws: it
     emits a `$conflict` entry whose key is the message, "load 'erp' names
     "SO-9", which is in neither its piece of the delivery nor its entries", as
     a mutation's program reports a conflict (`DELTA_CONFLICT`,
     `e3-types/src/record.ts:766`). The commit refuses a delta that holds one
     (§7.6), so the load fails with that message and nothing commits.
  4. Put the case back on every key, and emit the `primary` arm and every
     index's arm through `dictApply` / `indexesChanges`, the same maintenance a
     patch mutation's program does.
- **The merge program** (`buildLoadMergeProgram`). Pieces name different
  primary keys and different entry-index keys `{ik, k}`. A summary's (or a
  span's) totals can share a key across pieces, so the merge program sums those
  `add` ops through the index's own `summaryMergeProgram`. Two pieces that both
  report a `$conflict` under one key keep either: the message is the same. Any
  other key two pieces share fails the merge with an East error, "two pieces
  of load 'erp' wrote one entry <key>": the planner never cuts two pieces over
  one key, so this guards the planner, and the load fails rather than commit a
  guess. A keyed load's task object always names it, a record with no summary
  included: with no merge program two pieces that answer one key are the
  engine's own failure, and two pieces may share a `$conflict` key whatever
  the record's indexes (F43).
- **Export** (`export.ts`). For each external source it writes:
  - **the load's task object**, built as a split call's is
    (`splitCall.ts:357–365`): the load program as its body, the source's
    runner, role `data`. Its inputs are `[delivery, run]` at `path: []`, each
    with `index: none`, partitioned `by: []` and `by: [<source>]` when the
    delivery is keyed and unpartitioned otherwise. Its output, at `path: []`, is a `dict` folded by
    the merge program when keyed, and a `value` otherwise. The author's
    function is linked into the program as a mutation's body is, under the
    owner `load "orders.erp"`.
  - **the load object** (`$recordLoad`): the key and delivery types, the
    feed's path for a fed source, and the task object's hash.

  The record object's `sources` names each load object, and a solution source
  as `mutations`. A composite's mutation objects each name the cases they may
  write, the record's solution sources (`MutationObjectType.cases`, §6; this
  revision's proposal, F41).

### 7.2 e3-types

The wires of §6, with their TypeDoc and decoders. `decodeRecordObject` says
"re-export" for a record object written before `sources`. The load object's
tag, `RECORD_LOAD_KIND = '$recordLoad'`, sits beside `RECORD_STATE_KIND`
(`record.ts:619`), and the `$load:` commit-name helpers beside the system
commit names. The graph node's `load` documents what a load node is
(`dataflow.ts:113`). `InputPlanType`'s TypeDoc gains `retained` beside `keep`
(`api.ts:444–465`).

### 7.3 e3-core: the planner cuts through a variant's case (F1)

`cutOf` (`execution/pieces.ts:170`) learns one step: a `by` entry that names a
**case** of a variant key cuts by that case's value. A load's two inputs are:

- the delivery, keyed `K`, with `by: []`;
- the source's entries, keyed `Variant{…}`, every key of case `erp`, with
  `by: ['erp']`.

Both cut as `[K]`, so the type check at `pieces.ts:333–338` passes unchanged, and
the cut is otherwise the existing one. A case step's tuple is the whole key
of its case, so no two rows share one and every boundary is clean. As the
planner stands, `groupEnd` runs whenever the primary input has a `by`
(`pieces.ts:291`), and where two neighbouring fences differ it reads the
earlier segment's last key, which decodes that segment
(`DatasetSegments.lastKey`, `dataset-open.ts:182`): under a case step every
fence differs from the next, so each boundary would decode a segment
whenever the source's entries outweigh the delivery. So the planner passes
no `groupEnd` for a cut whose tuple is the whole key of its case: `by: []`,
as today, and a lone case step. A test counts the segments a plan decodes
(R88). An entry of another case
in an input cut through `erp` refuses the plan, naming the input. A load never
hands the planner one (§7.5 stores the source's run alone).

Alternatives considered:

- A new partition field, such as `within: Option<String>`. That is a wire
  change: every partitioned task in every package would be re-exported, and
  every split task's cache would miss once.
- A copy of each external source keyed by its own key, kept beside the
  record. That doubles the source's storage and every load's writes.
- Projecting the source's run into a `K`-keyed collection at each load. That
  copies the whole source per load, even for a delivery of ten changes.

### 7.4 e3-core: an external entry is never written

`applyDelta` and `applyDeltaEntries` (`record-apply.ts:153`, `:178`) take the
cases the write may touch: `{ cases: ReadonlySet<string> }`. A `primary` op on
a key of any other case throws `ExternalEntryError(key, source)` as the op is
taken, before the target's manifest is written. The apply streams: its
targets are written side by side, each taking its ops in batches as segments
are read ahead (`applyTarget`, `:313`), so segments an earlier batch stored
may exist. They are named by nothing, and nothing commits (F42). This is a
check of the op's tag that reads no state.

- `writeDelta` (`records.ts:1192`) passes the cases the mutation may write,
  for both the program path and the patch door's fast path (`patchDelta`,
  `:1295`). The error becomes `{ kind: 'invalid', message }`, naming the
  mutation, the key (as East prints it) and the source.
- **Where the cases come from** (F41). `writeDelta` is handed the mutation's
  object by every caller: a Save (`recordMutate`, `:935`) and a draft's
  laying (`recordLayDraft`, `:1520`). A Save has the record object in hand
  too. The laying does not: it is handed the record's state and the
  mutation's object by hash, as the call's start named them, and reads
  nothing else. So this revision proposes that the mutation object carries
  the cases it may write (`MutationObjectType.cases`, §6), written at export
  from the record's solution sources, and that `writeDelta` reads them there
  for every caller. The alternative keeps them on the record object alone and
  adds them to what a kept call stores of each drafted record, which changes
  a stored form and ships a repository upgrade step. Question 1 (§11.2).
- **A drafted call** (R84). A draft that writes an external entry ends its
  call `invalid` in the Save's words, and the function's body does not run.
  The laying's ends are `failed`, `timed_out` and `conflict` today
  (`CallDraftsEnd`, `functionDrafts.ts:293`): it gains `invalid`, which a
  call's state and its result already hold (`FunctionCallStateType`,
  `ExecuteResultType`), so no wire changes for it.
- **A write of the whole state.** A mutation that writes a record whole is
  refused when the record has indexes (`resolveMutation`,
  `records.ts:813–818`), for a
  Save and a draft alike. The refusal covers a record with sources too: such
  a write would pass no cases, so a package that mixes builds cannot write an
  external entry that way.
- A load, run as a job or by the dataflow, passes its own case alone.
- A replay of commits under a load (§7.6) passes no restriction: each was
  checked when it committed.
- A plain record has no sources, and passes no restriction.

`resolveRecord` (`records.ts:715`) reads the record object's `sources` into the
resolved record.

### 7.5 e3-core: the load job (F2, F18, F22, F26)

`recordLoad(storage, runner, repo, ws, record, source, delivery, options)` in
`e3-core/src/record-load.ts` (new) is the whole load of a delivered source.
The CLI calls it in process, and the job handler (`handleProcessRecordLoad`)
calls it in a job. `options` holds `actor`, `asOf` (`Date`, an East DateTime),
`onProgress`, `signal`, and `transferFiles` for a file. `delivery` is the
stored object's hash: the one the caller names, or a file's, adopted first as
`seed` adopts one (`objectAdoptFile`). Steps 5 to 7 are functions the
dataflow's load node calls too (§7.8): `recordSourceRun` and
`recordLoadCommit`.

1. **Hold running work, and reference the delivery.** The whole load runs under
   `withRunningWork` (`running-work.ts:51`), so held gc is refused until it
   ends. It re-references the delivery (`touchReachable(storage, repo,
   [delivery])`), as a call naming an object by hash does; a delivery the store
   no longer holds fails the load: "delivery <hash> is not in the repository:
   upload it again". A fed source is refused here, naming its feed and the run
   that loads it.
2. **Queue.** Take `<ws>#load~<record>~<source>` exclusively, so one source's
   loads run one at a time, reporting `queued` while it waits. The wait has
   no bound: the load ahead may take hours. A job store starts one source's
   jobs in the order they were filed, a job's place taken as it is asked to
   run, before anything is awaited, so within a server they run in the order
   asked. Across processes, the lock is the order (ruling 37): a lock
   service that serves its waiters in the order they asked says so
   (`LockService.queuesWaiters`), and the load then makes one wait, with no
   bound (`timeout: Infinity`), which keeps its place, re-referencing its
   delivery every 30 s meanwhile. The local lock service keeps a place file
   for each such waiter in the resource's directory and gives the lock to
   the oldest; e3-web's is one Web Locks request. Of a service that keeps no
   queue the wait is a loop of
   `acquire(…, { wait: true, timeout: 30_000 })`, in no set order: each time
   it answers null, the load checks its signal, re-references the delivery,
   and asks again. That is enough where the store's own queue runs one job
   of a source at a time.
   A removal of the workspace or a copy onto it that announces itself is
   waited out as a deploy is, and the load then fails only where that took
   the workspace (ruling 34). A load whose commit has written is recorded
   `completed` however long the store refuses that write, which is tried
   again once a second (ruling 38).
3. **Answer a repeat, or an older copy.** Read the record's ref:
   - If `$load.<source>` names this delivery and `$load.<source>.load` names
     this load object, answer `again`, with `$load.<source>.commit` (none once
     a compaction cut it). The as-of is not asked: a delivery already loaded
     has nothing more to give.
   - Otherwise, if `options.asOf` is given and `$load.<source>.asOf` names a
     later time — compared as East compares DateTimes (`compareFor(DateTimeType)`)
     — answer `superseded`, with the source's as-of.
   - Otherwise go on. A delivery without an as-of is never superseded.

   Nothing runs or commits for an answer. The queue lock makes the answer
   stand: no other load of the source commits until this one lets it go.
4. **Hold the workspace.** Probe the deploy intent (§7.9). While a deploy has
   announced itself, wait on the intent in the same loop as step 2 (`stopped`),
   re-referencing the delivery at each turn. Then take the workspace's lock
   shared, as `dataset_write`, as a record write does, through
   `acquireWorkspaceShared` (§7.9): a null — a deploy announced itself since
   the probe — goes back to the wait. Then start the deploy watch. A deploy
   that announces itself once the load holds the workspace finds it held, and
   the watch stops the load.
5. **Take the delivery in.** The stored object goes through
   `deliveryAdoptStored` against the source's delivery type (`intake`); the
   adoption memo answers a delivery taken in before.
6. **Read the head** `H0` and its state, and the record's declaration
   (`resolveRecord`), which a deploy the load stopped for may have changed
   (§7.9). Store the source's run as a collection of its own, by reference
   (`recordSourceRun`): `storeCollection` over the run's whole segments, with
   only the two border segments re-cut.
   The run's bounds are found by bisecting the record's fences on the case
   alone. Equal entries cut the same way store as the same collection, so a run
   that other sources' writes did not touch keeps its hash, and its pieces stay
   cached.
7. **Run the pieces.** The load object names the load's task object, written
   at export (§7.1). Run it with `runner.execute` over `[delivery, run]`,
   reporting `pieces`. Its output is the delta: a mutation delta, so
   `applyDelta`, `summarizeDelta` and `history --delta` read it unchanged. The
   pieces are cached units, so a stopped load asked again resumes.
8. **Commit** (§7.6) with `base: H0`, reporting `commit`. A commit that answers
   `restart` returns to step 6: the head and the run are read again, and the
   pieces whose inputs did not change come from the cache.

The **deploy watch** runs from step 4 until the commit ends (§7.9). It probes
the intent every second. Once a deploy has announced itself, it fires the
load's abort: the running units stop through the runner's signal, and the
commit loop stops before its next write (§7.6). The load then lets the
workspace go, reports `stopped`, and returns to step 4. It keeps the queue
lock, so no later load of the source passes it, and its running work, so its
delivery is kept while it waits.

Ctrl-C, or the job's own signal, stops the load. Everything before the commit
is kept in the execution cache.

**A caller stops its own load job** (R85; the reviewer's call 5). A load's
wait for its turn and for a deploy has no bound (§8), and a hosted job has no
process anyone can signal, so the stop is in the first cut of the load. The
job's record is the signal: a cancel writes the job `cancelled` through its
store, whose `updateStatus` records a status only while the job has not
ended, the check and the write one atomic step, so a cancel never overwrites
a result, nor a result a cancel (§7.11). The load reads its record where it
already checks its signal — each turn of its waits, between pieces, and
before each attempt of its commit — and a refused progress write says the
same, as a split call's job finds its end (`handleProcessSplitCall`,
`transfer/process.ts:569`). A commit that has written its ref has landed: the
job ends `completed`, and the cancel is answered that it came too late.

**Its pieces run on any runtime** (R87). A load's function is held pure
(§7.1), as a mutation's and an index's are, and those run with `anyRuntime:
true` (`records.ts:892`, `:1604`): a local runner that cannot run its east-c
runs the unit on east-node (`execution/interfaces.ts:74–81`). A load's units
take the same option, in the job's `runner.execute` and in a run's launch of
a load node. Otherwise a machine with no east-c could edit a composite and
not load it.

**A save waits for a piece, never for the load** (R91). A process holds one
budget of cores and memory, and every runner it spawns takes a core from it,
first come first served, a split task's pieces and a mutation's program
alike (`execution/budget.ts`). A split task's pool keeps at most as many
units in flight as the budget has cores, and asks for the next only when one
ends (`execution/engine.ts:1099–1131`). A load's pieces go through that pool,
in a job and in a run. So a load holds or waits for no more cores than the
budget has, and a save made while its pieces hold them all takes the next
core freed. A test holds two pieces on a budget of two cores, asks for a
save, and finds its program the next to start. A hosted backend's capacity
is its own.

**Progress** (`RecordLoadProgress`, §6), each when it happens:

- `queued`, once, when step 2 first asks for the queue lock without waiting
  and an earlier load of the source holds it. A load that finds it free
  reports nothing there.
- `stopped`, each time the load waits on a deploy: at step 4, and once the
  deploy watch fires.
- `intake`, while step 5 takes the delivery in. When the adoption memo answers
  it — a load resumed after a deploy, say — the load reports none.
- `pieces`, as step 7's pieces settle: `done` of `total`, and `cached`, those
  the execution cache answered.
- `restarted`, with the commit's reason, when step 8 returns to step 6.
- `commit`, while step 8 commits.

The CLI's words for each are §7.13's.

### 7.6 e3-core: the commit (F3, F14, F20, F27)

`recordLoadCommit(storage, repo, ws, record, source, { delta, run, base?,
delivery, feed?, asOf, load, execution, actor, signal })` commits a load's
delta. A load job and the dataflow's load node both call it, under the
workspace's shared lock, which its caller holds. `feed` is the version vector
of a fed source's feed; a load job has none. It answers `{ committed: {
commit, state } }`, `{ restart }` or `{ stopped }`, and throws for anything
else.

Before the first attempt it refuses a delta that holds a `$conflict` entry,
with that entry's message, as a mutation's write reads one (`conflictDetail`):
the load fails, and nothing commits.

It keeps two things between attempts: `checked`, the last head its result is
valid on (`base` at the start, or none), and `result`, the load's own targets
(primary and each index) once computed. Each attempt, `n = 1, 2, …`:

1. **Stopped?** If `signal` has fired, answer `stopped`. Nothing has been
   written.
2. **Read** the record's ref with its revision (`readVersioned`): the latest
   head `Hn` and its version vector `Vn`.
3. **Bring the result to `Hn`.**
   - **Replay.** If `checked` is set, walk `Hn`'s chain back to `checked`,
     reading each commit (`decodeRecordCommit`). If every commit passed is a
     mutation (a name with no `$`) or a `$load:` of another source, and each
     stores its delta (`delta: some`), then:
     - with no `result` yet (attempt 1, or the first since a run check),
       `result` = `applyDelta(D, targets(Hn), { cases: {source} })`: the delta
       applied once, onto the latest head;
     - with a `result`, `result` = the deltas of the commits passed, oldest
       first, applied onto `result` with no `cases` restriction (§7.4). Each
       is a mutation's few ops, never `D` again.

     `checked` becomes `Hn`.
   - **The run check.** Otherwise — no `checked` (no `base` was given: a
     resumed run, or e3-cloud, F27), a commit with no delta (a system commit:
     rollback, restore, `$reindex`, `$compact`, a deploy's), a `$load:` of this
     source, or a chain that never reaches `checked` (a compaction cut it) —
     store `recordSourceRun(Hn)`. Equal to `run`, the source's entries are those
     `D` was computed from: `result` = `applyDelta(D, targets(Hn), { cases:
     {source} })`, and `checked` becomes `Hn`. Different, answer `restart`,
     "the entries of source 'erp' changed under its load". A difference in how
     the same entries were cut at the run's ends is a restart too; the cache
     answers its pieces where their inputs are unchanged.
4. **Store the commit** (`storeCommit`): parent `Hn`, mutation
   `$load:<source>`, actor (`system:load` for a job unless given,
   `system:dataflow` for a run), `delta: some(D)`, and `args`, a
   `RecordLoadArgs`:
   - `delivery`, `load`, `asOf`, and `execution`;
   - `first`: whether `Vn`'s `$pending` names the source;
   - `set` = inserts + updates and `deleted` = deletes, from `summarizeDelta`'s
     primary arm;
   - `unchanged` = the run's count (its manifest's `count`s) less updates and
     deletes.

   The args are stored as every commit's are: a tuple, here of that one value
   (`storeCommit`, `records.ts:674–694`), so history and the rollback's walk
   read them through the same door (`recordCommitArgs`, `:2688–2700`).
5. **Write the ref** (`writeIf` at `Hn`'s revision) with `nextVersions(Vn,
   self, commit, owned)` (`records.ts:1096`), its `remembered` left at its
   default, so the requests the record remembers are carried under the new
   head: a load changes no row a keyed retry could apply twice. It owns:
   - `$load.<source>` = `delivery`, `$load.<source>.load` = `load`,
     `$load.<source>.commit` = the commit,
     `$load.<source>.execution` = `<inputsHash>/<executionId>`;
   - `$load.<source>.asOf` = the later of `Vn`'s and `asOf`, printed through
     East; no `asOf` leaves the slot as it is;
   - `$load.<source>.feed` = `feed`, printed through East, for a fed source;
   - `$pending` = `Vn`'s without the source, `undefined` once empty.
6. **A ref conflict** (`DatasetRefConflictError`) is the only failure retried:
   wait `casBackoffMs(n)` (`records.ts:463`) and go back to 1. An apply error
   (`ExternalEntryError`, a summary's integrity error), a storage failure, or
   anything else is thrown, and the load fails. There is no attempt cap and no
   deadline (§8): each attempt replays only what landed since the last.

**Why replay is exact.** `D` writes only its own source's entries: primary keys
of its case, and in each entry index the keys that carry those rows' keys. No
mutation writes them (§7.4), and neither does another source's load. A
summary's and a span's ops are `add`s of totals: they commute, and no total
passes below zero in either order, since `D` subtracts only its own rows,
which no other commit touches. So `D` and each commit in between commute on
every target, and `D` applied once onto `Hn` equals the commits in between
replayed onto `D` applied onto `base`. The commits passed are replayed in
chain order, so two of them that touch one solution entry land as they did.
The totals two commits can share are Integers (`RecordSummaryTotalsType`), so
they add exactly in either order; a row's own totals
(`RecordNestedTotalsType`) are entries of that row, which only its source's
writer touches, as are an entries index's lean rows (`entriesRowsName`,
`e3-types/src/record.ts:338`), kept by the row's key.

**Why the run check is exact.** When the source's entries in `Hn` are those
`D` read, each of `D`'s ops holds on `Hn`: its `before` values are the
entries'. The load object is the deployed one, since no deploy lands while
the caller holds the shared lock, and a job stopped for a deploy reads its
head again (§7.5).

**At most once.** A commit of this source since `checked` forces the run check;
if that commit changed the entries, the run differs and the load restarts, and
its prepare or step 3 then finds the slots naming its delivery. A run another
process took up, or a load whose commit landed just before a stop, are
answered so.

**Cost.** Attempt 1 applies `D` once, as the first draft's apply did; every
later attempt applies only the deltas of what landed since. A stream of edits
never makes the load apply `D` again, and cannot starve it. Only a commit
with no delta — rare — costs a run check, and, the entries unchanged, `D`
once more.

**The commit's one sizeable step holds up no save** (R92). The commit applies
the stored delta once, and the apply is the write path that costs what a
write touched: it reads the delta in order, decodes only the segments its
ops fall in, and carries every other segment over as stored
(`record-apply.ts:6–22`). It runs under the workspace's shared lock, which a
save takes too, and takes nothing a save waits for. The record's head then
moves in one compare-and-swap. A save that lands during the apply is folded
in from its own few ops, and the delta is never applied again (R16). A save
that loses the swap to the load's commit runs once more on the new head, as
when two saves meet today. A test counts the segments the apply reads and
writes against those the delta's keys fall in. How long the apply of a very
large delivery takes is not measured, since nothing is built: the third pull
request measures it, with people's saves landing meanwhile.

### 7.7 e3-core: slots, pending, rollback, restore, deploy (F4, F6, F15, F21)

- **Pending, read by the dataflow.** `dataflowResolveInputs` (§7.8, in place
  of `dataflowResolveInputHashes`, `dataflow.ts:603`) reads each record
  input's ref with its version vector, and answers `null` for a ref whose
  versions hold `$pending`, as for an unassigned one. So `stepPrepareTask`
  leaves its dependents `waiting`, and the run goes on without them; the
  reason words name the sources (§7.8). A load node does not read its record
  as an input, so a pending record never holds up its own load. The first
  load's commit moves the record's commit, so change detection finds it, and
  the waiting dependents are decided again and run.
- **A task whose input is an index of such a record waits too** (R83), as a
  task that takes the record does. `dataflowResolveInputs` reads an index
  input's record ref once, for the record and every index of it: for
  `$pending`, for its commit, and for whether the task is due (F40).
- **A function's call while a record waits for its first delivery** (the
  reviewer's call 4). The calls a server keeps were written after the first
  audit. A call's start pins its function's declared inputs
  (`pinCallArguments`, `execution/oneShot.ts:355`), and refuses one only when
  its ref holds no value (`unassignedInput`, `:443–462`, whose own words are
  "A dataflow waits on each of these, so a task reading the same dataset
  would not run either"). A composite waiting for a delivery holds a value:
  its own entries. So an optimiser or a fit called from a page would compute
  over part of the record. The same rule as a task's:
  - **A function's declared input** that is a record whose `$pending` is set,
    or an index of one, ends the call `invalid`, and nothing runs (R81):
    `The function's input .records.orders waits for the first delivery of
    erp: a task reading it would wait too, and nothing ran`.
    `pinCallArguments` reads each input's ref with its versions, where today
    it reads the hash alone (`workspaceGetDatasetHash`, `trees.ts:698`).
  - **A dataset a caller names as an argument** is read as it stands (R82),
    as the record's own route serves it and a Sheet shows it. A person
    looking at the record sees their own entries before the first delivery,
    and the query builder's one-shot reads the same.
- **At every deploy** (`commitDeployRecords`, `records.ts:1959`; the plan's
  `RecordDeployment` gains each composite's external sources, read from the
  new package's record object). The prior external sources are the ref's
  `$external` slot: a deploy reads no record object of the package it
  replaces, which an earlier SDK may have written (§6).
  - **mint** (`:1980`): `$pending` and `$external` name every external
    source.
  - **reset** (`:2021`): every `$load.*` slot is dropped, each named, since
    `nextVersions` drops only what a writer names; `$pending` and `$external`
    name every external source. A composite is reset to its solution sources'
    initial values, and is never sent back to unassigned (`unassign`,
    `:2034`), which is for a record declared with no initial value (F46).
  - **keep, with a `$deploy` commit** (`:1991`), and **migrate** (`:1999`)
    (ruling 16):
    - `$pending` = (the prior `$pending` ∩ the new external sources) ∪ (the
      new external sources not in the prior `$external` **that hold no entry
      in the state the deploy commits**). Whether a source holds one is read
      by bisecting the state's fences on its case, the check a restore makes
      (below). So a source the migration left rows under does not wait: its
      readers run on the record as migrated, and its first load is a load
      like any other, which diffs its delivery against the rows carried over
      (R78). `$pending` did not name the source, so that commit's args say
      `first: false`, and a rollback to before it leaves the source not
      waiting: the record holds the rows carried over again. A source the
      migration left no row under waits for its first delivery, and the
      readers with it, as ruling 1 has it;
    - a source changed from `mutations` to `load` while it holds rows takes
      the same rule: its rows are now the load's, and count as delivered
      (R79). The ruling was made for rows a migration carried over; reading
      it for this case is the reviewer's call 2, asked before it is built
      (§11.2);
    - each source in the prior `$external` and not the new — removed, or
      changed from `load` to `mutations` — has its slots dropped, and leaves
      `$pending`;
    - `$external` names the new set (dropped when it is empty).
  - **migrate**, besides: each external source's `$load.<source>`, `.load`,
    `.commit`, `.execution` and `.feed` are dropped, and `.asOf` kept. A
    migration rewrites the entries, so the record no longer holds what its
    feeds said: a fed source loads again on the next run, and a delivered one
    when it is sent again. Its as-of still dates what the source sent, so an
    older copy stays superseded. (This is design, not a ruling.)
  - **keep** of the same package (no `$deploy`) copies the versions as today.
- **Rollback** (ruling 7). `systemCommitState`'s walk (`records.ts:2595–2613`)
  already decodes each commit it passes on its way from the head to the target.
  For each `$load:<source>` commit passed — each one the rollback undoes — it
  reads the commit's args (`RecordLoadArgsType`) and records the source as
  undone, and as reopened when `first` is true. `recordSystemCommit` then
  writes the ref with `nextVersions(current.versions, self, commit, owned)`
  (`:2495`), owning, for each undone source, `$load.<source>`, `.load`,
  `.commit`, `.execution`, `.feed` and `.asOf` as `undefined`, and `$pending`
  with each reopened source added. A source forgets the delivery it undid,
  as-of included, since the record no longer holds what it sent; it waits for
  a first delivery again only if its first was undone. A run in flight finds
  the record changed and its load node due, and the next run's prepare finds
  no slot naming its feed; either loads it (§7.8).

  **A rollback that brings a delivery back** (R80; the reviewer's call 3). A
  rollback's commit sits on the head it rolls back from
  (`recordSystemCommit`, `records.ts:2417`), so a later rollback can walk
  back through it to a commit the first one undid. The walk only ever adds a
  source to `$pending`. So after the walk, a source leaves `$pending` when
  the state the commit commits holds an entry of its case: one bisect for
  each source, the check of a deploy above. After a rollback `$pending` is
  the prior `$pending`, with each source whose first delivery the rollback
  undid, less each source the state holds rows of. Two more rules (ruling
  33): a source that is not external now never waits, since a deploy may
  have handed it to the record's mutations and no load would deliver it; and
  a rollback whose walk passes a deploy, or a state an operator committed,
  sets `$pending` as a restore does, to every external source the state it
  commits holds no entry of, because such a commit can bring rows of a
  source that never delivered. A commit does not say whether an operator's
  system commit was a restore, so any such commit counts. The delivery slots and
  the as-of of a source are forgotten when a rollback undoes its delivery,
  and nothing brings them back when a later rollback returns the rows,
  because a commit keeps no copy of the slots. After any rollback of a
  delivery, the next delivery of that source loads whatever its as-of. The
  same delivery sent again runs again, its pieces from the cache, and
  commits `0 set, 0 deleted` (R9), which writes the slots anew.
- **Restore.** A restored state comes from outside the history, so nothing
  says what it holds of each source. A restore drops every external source's
  `$load.*` slots, and sets `$pending` to the external sources with no entries
  in the restored state, found by bisecting its fences on each case, as
  `recordSourceRun` bounds a run. A source whose last delivery was empty is
  read as pending, so a restore errs toward waiting. A restore's rule is
  unchanged by the review. A first state a system commit gives a record that
  holds none (`$init` over an unassigned record, `genesisState`,
  `records.ts:2532`) never arises for a composite, which always holds a
  state (§7.1).
- **Compaction.** `recordCompact` (`records.ts:2247`) empties a
  `$load.<source>.commit` it cuts from the chain, as it rewrites
  `$migrations` (`records.ts:226–233`).
- **History.** `recordCommitArgs` and `recordHistory` (`records.ts:2688`,
  `:2749`) decode a `$load:` commit's `args`, a tuple of one
  `RecordLoadArgsType`, and the CLI says it in words (§4.3).
- **Describe.** `recordDescribe` (`records.ts:2161`) answers `sources`: each
  source's key type, whether it is external, its delivery type, its feed, its
  last delivery, commit and as-of from the slots, and whether it is pending.
- **Seed.** `e3 seed` refuses a composite (`commands/seed.ts`).

### 7.8 e3-core: runs that follow their records, and a fed load (rulings 5, 10–12 and 14, F12, F17, F20, F28, F29, F31–F33, F35)

People edit a record several times a minute, so a run that reads it sees it
move under every task. Four rules make such a run worth having. They hold for
every workspace's runs, composite or not:

- **Every result lands** (ruling 12). A task whose inputs moved while it ran
  keeps its result, and runs once more on the newest commits.
- **A task runs as of its slowest input.** A task that reads several results
  reads them all as of one commit of each record, so it never waits for them
  to agree and never computes on a mix.
- **An edit wakes the run** (ruling 14). A start that finds a run in flight
  hands the edit to it, and the run looks for it at once.
- **Nothing waits on a running load** (ruling 11). A load's commit is one more
  change of its record, and its readers run on the record as it stands
  meanwhile.

```
                       today                                 this design
                       ------------------------------------  ---------------------------------------------
a task's input moves   its result is dropped if the run      its result lands, and it runs once more, on
while it runs          looked since, and it runs again       the newest commits
its dependents         reset, and wait for it                keep their results, and run again once its
                                                             next result lands
a task reading two     deferred until both came from one     runs as of the older commit, the other
results                commit                                result read there from the cache, or run
                                                             there once
an edit                found at the run's next completion;   the view's start hands it to the run, which
                       the view's start is refused           looks at once
a record's readers     (no loads today)                      run on the record as it stands, and again
while its load runs                                          after the load's commit
```

#### Every result lands (F32, ruling 12)

- **A result lands as its task finishes.** `completeTask`
  (`LocalOrchestrator.ts:1443`) and the cache hit (`:983–1036`) no longer ask
  `stepTaskResultStale` (`steps.ts:633`), which is removed. `stepTaskCompleted`
  records for the task's output the version vector the task was launched with,
  in place of the merge of the run's vectors at its end (`steps.ts:1065–1076`),
  and the output is written to the workspace (`stepApplyTreeUpdate`), as today.
- **A task is due when an input it reads directly changes.**
  `stepTasksDue(state, changed)` (`steps.ts`, new) takes the place of
  `stepInvalidateTasks` and its transitive `findAffectedTasks`
  (`dataflow.ts:400`). `changed` is a root whose snapshot moved
  (`handleInputChanges`, `LocalOrchestrator.ts:1408`), or a task whose result
  landed. Each task that reads one of them directly is asked whether it would
  now read other inputs than its last result did: another commit of a record,
  another result of a task, or another value of a plain input, at its commits
  (below). If so it is **due**:
  - a completed task goes back to `pending`;
  - a task in flight is asked again as it lands, and goes back to `pending` if
    it is still due, `task_invalidated` saying "its inputs moved while it ran".

  Either runs once, on the newest commits, for everything that arrived
  meanwhile. Deferred and waiting tasks are decided again, as
  `stepInvalidateTasks` decides them (`steps.ts:561–570`).
- **A result stays usable while its task runs again.** A due task keeps its
  `outputHash`, its `execution` and its output's vector, and its output stays
  in the workspace. A task is ready once every task it depends on has a result
  in the run, whatever that task's status, save `waiting`, whose dependents
  wait with it as today (`stepGetReady`, `steps.ts:345`;
  `dataflowGetReadyTasks`, `dataflow.ts:446`, takes the tasks with a result
  apart from those completed). So a change travels a step at a time: a task's
  dependents are due once its next result lands, not when the root moves, and
  none of them is reset to wait for it.
- **A task starts in the pass that made it ready** (F35). A pass of the loop
  that answered a task from the cache, or left one waiting, takes the ready
  tasks again before it waits on what is in flight (`hadSyncCompletion`,
  `LocalOrchestrator.ts:1068–1077`, checked before the wait rather than after
  it). So a fed load whose feed the cache answers starts at once, beside a
  slow task in flight (§4.13), where today it waits for that task to land.
- **The run's end.** A run ends once no task is due, ready, in flight or
  catching up (`stepIsComplete`, `steps.ts:393`). A run people keep editing
  under does not end by itself, as today's runs do not: it follows the edits,
  each task at most one run of its own behind its inputs, until it is stopped
  or a deploy stops it (§7.9).

#### A task runs as of its slowest input

**What a record's version names.** In a run, a record's version vector is its
commit, `{ record: commit }`, merged with what each of its fed sources
**carries**: the version vector of the feed the source's delivery was made
from, the `$load.<source>.feed` slot (§7.6), read through East
(`parseFor(VersionVectorType)`). When the feed's hash in the run is the
source's delivery (`$load.<source>`), the source carries the feed's vector in
the run instead: the same value, from upstream versions at least as new. A
source whose delivery was forgotten — a rollback, restore or migration dropped
its slots (§7.7) — carries `$unknown` for each root its feed reads, through the
graph. The run reads the slots with the record's ref each time it takes a
snapshot of the record (`stepDetectInputChanges`, `steps.ts:446`).

**A task's commits.** For each record a task reads, directly or through other
tasks' results, the task reads one commit. `stepTaskCommits(state, task)`
(`steps.ts`, new) gives them from its inputs' version vectors, and takes the
place of `stepCheckVersionConsistency` before a launch
(`LocalOrchestrator.ts:944`):

1. **A record no input carries**: the oldest commit of it that its inputs
   name. That is the run's snapshot for a record the task reads directly, and
   a result's vector's entry for one it reads through that result.
2. **A root a fed record carries**: the version that record's commit carries.
3. **A plain input**: the value its inputs agree on. A plain input keeps no
   earlier value to read: once it is set again, the old value is unreachable,
   and gc may take it. So a task whose inputs disagree on one is deferred until
   they agree, as today (`task_deferred`). Such an input is set by hand, seldom
   while a run is in flight.

A carried version that is `$unknown` where another input names the root, or
two fed records carrying different versions of one root, defer the task the
same way, until a load commits. A task that reads a fed record alone is never
deferred. `stepTaskCommits` answers each deferral with its reason, one of the
four cases of §4.10 (a `DeferReason`, below).

Three rulings of 18 November 2026 complete this:

- **Ruling 30.** A carried version the store no longer holds, a compaction
  having cut it and a sweep taken it, is read as `$unknown`. The step asks
  the store for it as a launch asks for any commit it reads, and the run
  remembers one that is gone.
- **Ruling 31.** Two sources of one record may carry different versions of a
  root. A task for which that record alone names the root reads the record
  as it stands, the root `$unknown` in what its result was made from; a task
  that another input also names the root to is deferred `carried`, and the
  reason names the two sources.
- **Ruling 29.** Where the load a `forgotten`, `carried` or `feed` deferral
  waits for cannot commit in the run — it is outside the filter's run set,
  or it failed, was skipped or waits — the step answers `waiting` instead,
  naming the load, and the loop leaves the task waiting on it (`upstream`),
  as it leaves a reader of a load that cannot run. A load's failure sends
  its record's readers back to be decided, so one deferred before the
  failure is asked again.

And ruling 32: a feed that moves sends back to be decided only those waiting
readers of its record that waited on the load, which the move released; one
waiting for the record's first delivery is decided again by that delivery's
commit.

Whatever compares or merges two vectors for a launch leaves out every entry
whose key begins `$`. The slots of §7.7 ride in a record's version vector,
and `checkVersionConsistency` refuses two vectors that differ at any key
they share (`dataset-refs.ts:32`), so a slot a load wrote between two reads
would defer a task for nothing (F44).

**Reading the inputs at the task's commits.** `dataflowResolveInputs(storage,
state, task, commits)` (`dataflow.ts`, new) takes the place of
`dataflowResolveInputHashes` (`dataflow.ts:603`), which reads the refs as
they stand. It
reads:

- a record at its commit: that commit's `state` (`decodeRecordCommit`), from
  the record's history;
- a plain input by its hash;
- a task's output, the first of these that holds:
  - its last result, when that came from the task's commits;
  - the execution cache, asked for that task's execution over its own inputs
    resolved at the same commits (`dataflowCheckCache`);
  - that task's run in flight over exactly those inputs, once it lands;
  - otherwise a **catch-up run**: that task run once over those inputs, for
    this task.

It answers `null` for an input with no value, or for a record whose `$pending`
is set, as today, with the reason (below).

It keeps what `dataflowResolveInputHashes` does for an input that is an index
of a record (F40): it reads the task object's inputs for each one's index,
reads a record's ref once for the record and every index of it, so they are
of one state, and names an index input by the index's object in the commit's
state (`taskInputRead`, `dataset-open.ts:547`). So a task that reads an index
is decided again whenever its record's commit moves, and the execution cache
answers it when the index it reads did not.

**Catch-up runs.** `stepPrepareTask` (`steps.ts:675`) answers `behind: { runs
}`: the catch-up runs whose own inputs are at hand, the deepest first.

- The launch loop keeps the task's commits and its catch-up runs in memory, as
  it keeps a launch. It launches each run as an execution of its task over the
  inputs given, a split task's as a split, each taking a place in the run's
  width.
- A run is tracked in `runningTasks` under a key of its own,
  `<task>@<inputsHash>`, and its completion applies to no node and writes no
  ref: the execution cache records it, and nothing else. So a task's output in
  the workspace never goes back.
- Once a task's runs have settled it is prepared again at the same commits, so
  it never chases newer ones.
- A run that fails fails the task, naming the run's task and the commit.
- The task's stored state is `pending` until it launches itself. A resumed run
  decides it again, and the cache answers the runs that finished.
- `onCatchUp(task, forTask, phase)` tells the run's caller, its `phase`
  `{ state: 'started' }`, or `{ state: 'completed', duration }` once the run
  lands. No event records it (§10).

**Which of two commits is older.** `recordCommitOrder(storage, state, record,
a, b)` (`dataflow.ts`, new) answers. The run numbers, in memory, each snapshot
of a record it takes, so two it took compare by number. A commit it never took
— one that a result named before the run resumed — is older than its first
snapshot. Two such are ordered by walking back from that snapshot a parent at a
time, a commit being a few hundred bytes: the first of the two met is the
newer, and one never met, which a compaction cut, is the older. The run keeps
each answer.

**Why it holds.**

- A task's inputs all come from one commit of each record, so it never
  computes on a mix. A record is read at any of its commits from its history,
  and a result made from a newer commit is read at the older one from the
  cache, or run there once.
- It never waits for its inputs to agree. It takes the commit its slowest
  input came from, and that input's result is already in hand.
- Every result lands, so each task trails its inputs by at most one run of
  its own, and a task that combines results by the catch-up runs it waits on
  too.
- A catch-up costs at most one more run of each task the combining task reads
  through, per run of that task, at commits the run has seen. Under steady
  edits it is the common case: a faster input that is always busy has moved
  past the commit the slower one started on (§4.6). When no edit lands between
  their starts, the cache answers.

**Alternative considered.** A task due again could start on the commit that a
task sharing a reader with it last started on, when that is newer than its
own last, rather than on the newest. The reader would then find both results
in the cache, so most catch-up runs would go, at no extra run, for a little of
that task's freshness. It would amend ruling 12, which starts a task due again
on the newest commits, so this design does not take it.

#### An edit wakes the run (F33, ruling 14)

A view writes, then starts a run (`writeAndStart`,
`e3-ui-components/src/platform/dataset-store.ts:789`; `record-runtime.ts:687`).
Today the start is refused while a run is in flight, and the run finds the
edit only when one of its tasks next ends: for a run of slow tasks, minutes
later. Now the start hands the edit to the run:

- **`DataflowOrchestrator.wake(storage, repo, ws): Promise<boolean>`**
  (`orchestrator/interfaces.ts`, new) tells the run in flight on `ws` to look
  for changed inputs now. It answers whether a run took the wake: one of this
  orchestrator's, not stopping, that runs every task. A run started with a
  filter would leave the edit's other readers out, so it answers false.
- **`LocalOrchestrator`** keeps its runs in flight by workspace. Each run's
  loop waits on its wake beside what it has in flight (`Promise.race`,
  `LocalOrchestrator.ts:1070`). A wake runs `handleInputChanges` (`:1408`)
  under the run's mutex, then the loop launches what became ready. The look
  after each completion and cache hit stays, so an edit that no start follows
  — `e3 mutate`, or a write from another process — is found at the run's next
  completion, as today.
- **The start** (`startDataflow`, `e3-api-server/src/handlers/dataflow.ts:224`).
  When `orchestrator.start` throws `WorkspaceLockError` for a start with no
  filter and no force, the handler asks `orchestrator.wake`:
  - true answers 202 `handed { since }`: `since` is the run's next event, so a
    caller follows the run from there;
  - false is refused as today (`sendLockRefusal`).

  A start that begins a run answers 202 `started`. The answer is a
  `DataflowStartResult` (§6). A filtered or forced start asks for a run of its
  own, so it is refused while a run is in flight, as today.

Nothing polls for edits: the writer's start wakes the run. A run in another
process, such as a local `e3 dataflow run` beside a server's, is not woken
(§10).

**Across processes and instances (F37).** `wake` is a seam. The shared class
wakes a run its own process holds, which is every run of the local server
and of e3 in a page. A host whose runs are held by other processes or
instances implements `wake` to reach them, as it reaches them to cancel, and
its loop takes the wake as the shared loop does: `handleInputChanges`, then
a launch of what became ready. Where `wake` answers false the start is
refused as today, and the client asks again as it does now
(`dataflowExecuteLaunch`, `e3-api-client/src/executions.ts:63`), so the edit
is found at the run's next completion and nothing is lost. A run that is
stopping takes nothing in: `wake` answers false for it, and the refusal
keeps the `Retry-After` it has today (`sendLockRefusal`,
`e3-api-server/src/stopping-run.ts:139`). The handler opens no second
attachment to a host's runners for a start that is handed over (the
`dataflowRunner` lease of `startDataflow`).

**A second local command (F38).** `e3 dataflow run` and `e3 watch` each run
their own loop in their own process (`e3-cli/src/commands/start.ts:180`,
`watch.ts:221`). A second local command on a workspace whose run another
process holds meets `<ws>#dataflow` held, and is refused as today (§10).

```
time      the view                         the run in flight
--------  -------------------------------  --------------------------------------------
10:02:00  an edit commits m1               forecast running on c0; capacity done on c0
10:02:00  starts a run: handed to the run  looks now: orders moved to m1
                                           capacity starts on m1
10:02:40                                   capacity's m1 result lands
10:03:00                                   forecast's c0 result lands; it starts on m1
```

Without the wake, `capacity` would start on m1 only at 10:03, when `forecast`
lands.

#### The load node (rulings 5 and 10, F12, F17, F20, F28, F29)

A fed source is loaded by the dataflow as a step after what feeds it: a **load
node** of the run's graph, with its pieces cached and one commit per new
output. Nothing waits on it (ruling 11). Its commit is a change of the record,
as a mutation's is, so the record's readers are due after it and run again in
the same run (ruling 5). While it runs, they run on the record as it stands.

**The graph.** `buildDependencyGraph` (`dataflow.ts:239`) reads each record
object of the package, and its load objects. Beside its task nodes it returns
the load nodes, and `loadsOf`: a record's path to its load nodes. Each fed
source is a node:

- `name`: `<record>.<source>` (`orders.erp`);
- `hash`: the load's task object;
- `inputs`: the feed's path;
- `output`: the record's path;
- `load`: `some({ record, source })` (§6). A task's node has `none`.

A load node's `dependsOn` is the task that writes its feed, when a task does.

No node depends on a load node (F28). The record stays a root input:
`stepInitialize` leaves load nodes out of `taskOutputPaths`
(`steps.ts:117–121`), and they are not entered in `outputToTask`. So
`dataflowGetGraph`'s `dependsOn` (`:319`, `:352–361`) and
`buildOutputVersions` (`LocalOrchestrator.ts:2034`) are unchanged, and
`loadsOf` is read for waiting alone (below).

A name that clashes with a task's, and a cycle, are refused, naming them, as
the SDK refuses them first (§7.1). A load node is not a task of the package:
the `e3 task` commands do not list it. The run's state, events and lines name
it as they name a task.

**The record's version** (F17) is its commit and what its fed sources carry
(above). A load node's completion records the feed's vector for the node
alone. Its commit is found as any change of the record is: change detection
reads the record's ref, its slots with it. A load node is due when its feed
moves. It is due too when a change of its record leaves
`$load.<source>.execution` no longer naming the execution the node completed
with: a rollback or restore that forgot the delivery (ruling 7). A mutation
leaves the slot, and the node, as they are.

**A reader waits while its record's load cannot run** (ruling 10). A task that
reads a record directly waits while one of the record's load nodes waits
(step 1 of the prepare, below), and its dependents wait with it.
`stepTasksWaiting` (`steps.ts:792`) and `waitsOnDependency` read, through
`loadsOf`, the load nodes of each record a task reads, and give the reader the
`upstream` reason. A load that can run holds no reader up.

**Prepare** (`stepPrepareLoad`, `steps.ts`, new). The launch loop
(`LocalOrchestrator.ts:966`) calls it for a node whose `load` is `some`:

1. **Wait** (rulings 9 and 10), as on an unassigned input, when the feed:
   - has no value (`unset`);
   - is a record whose `$pending` is set (`pending`);
   - is an input that holds the deployed package's value for it (`package`,
     ruling 9).

   For `package`, the feed's ref is compared with the package's
   (`pkg.data.refs`) as a deploy compares them (`sameValue`,
   `input-deploy.ts:84`, exported). The loop reads the package's refs once,
   with its structure (`readStructure`, `LocalOrchestrator.ts:2051`). A value
   someone set equal to the package's is read as the package's.
2. **Answer** from the slots. When the run does not force the node
   (`stepTaskForced`), and `$load.<source>` names the feed's hash and
   `$load.<source>.load` the node's load object, the node completes at once,
   `[CACHED]`. Its execution is the one `$load.<source>.execution` names, and
   its output is the record's head. Nothing commits.
3. **Prepare.** Read the record's head `H0`, and store the source's run
   (`recordSourceRun`, §7.5 step 6). The inputs are `[feed, run]`.
   - The execution cache is asked unless the node is forced
     (`dataflowCheckCache`, `dataflow.ts:509`).
   - It skips the check that the workspace's output ref matches
     (`steps.ts:714–728`): a load's output is a commit, not a ref.
   - The prepared node carries `base: H0`, held with its launch in memory.

**Launch.**

- A node the cache answers launches its commit alone (`launchLoadCommit`). It
  is tracked in `runningTasks` under its name, as `launchTask` tracks a task
  (`LocalOrchestrator.ts:1614`). The cache key holds the run, so a cached delta
  was made from the entries as they stand, and its commit never applies a
  delivery twice.
- Any other node launches as a task does. A keyed load launches as a split
  task (`launchSplit`, `:1643`), its pieces reported as `[PART]` lines. A load
  of one piece launches as one execution (`launchTask`).

**The commit, outside the run's mutex (F20).** A load node's success goes to
`completeLoad` (`LocalOrchestrator.ts`, new) in place of `completeTask`'s
success arm (`:1459–1527`). Failure and cancel go through `completeTask` as any
task's do. `completeLoad`:

1. **Under the mutex.** For a run another process took up
   (`stoppedBy === 'refused'`), nothing. Otherwise the node stays
   `in_progress`, and its commit's abort, a child of the run's, is entered in
   the run's `loadCommits`.
2. **Outside the mutex.** It calls `recordLoadCommit` (§7.6) with:
   - the delta (the execution's output);
   - `run` and `delivery` (the inputs), and `base`;
   - `feed`: the feed's vector the node was launched with;
   - no as-of, the node's load object and the execution;
   - actor `system:dataflow`, and the commit's abort.

   Every other completion, launch and cache hit of the run goes on meanwhile,
   and so do people's edits.
3. **Under the mutex**, by the answer:
   - `committed`: `stepTaskCompleted` records the node, its output the commit
     and its vector the feed's it was launched with. The run's
     `taskExecutions` and `onTaskComplete` hear it. The run's change detection
     then finds the record changed, as after a mutation, and its readers are
     due. If the feed moved while the load ran or committed, the node is due
     again and runs on the new output; the commit stands, as any result does.
   - `restart`: the node goes back to pending, `task_invalidated`, "the record
     changed under its load". It prepares again, and the pieces still valid
     come from the cache.
   - `stopped`: the node goes back to pending, as a cancelled task does.
   - thrown: the node fails as a task's failure arm records one
     (`stepTaskFailed`, `:1544–1576`), without setting the run's `hasFailure`
     (ruling 15, "Fail" below). No node depends on a load node, so
     `stepTasksSkipped` skips none.

A cancel and a stop wait for a commit already in flight, as for anything in
`runningTasks` (`:1089–1091`, `stopLaunched`, `:1269`). A yield does not
(`:1060–1066`). So `checkpointYield` (`:1374`) first fires every commit's
abort in `loadCommits` and waits for each to settle, before it takes the
mutex: no commit lands after the run lets the workspace go. A commit that had
written its ref is answered by the slots when the run resumes.

Two load nodes of one record commit side by side, each a change of the
record. A reader runs once for both when both land while it runs.

**Fail** (ruling 15, R54). Today one failed task stops every launch of its
run: `completeTask` and `failTask` set the run's `hasFailure`
(`LocalOrchestrator.ts:1545`, `:1596`), and the loop launches no task once it
is set (`:912`). A run that people keep editing under lasts all day, so one
bad delivery would stop every result following their edits. For a load node:

- **The node fails, and says so at once.** A failed piece, a refused delta,
  or an apply error fails the node with the load's message. `stepTaskFailed`
  (`steps.ts:1124`) records it as it records any task: its status `failed`,
  the run's `failed` count, the `task_failed` event, and `onTaskComplete`. A
  local run prints the failure as it happens, not at its end. No node depends
  on a load node, so nothing is skipped.
- **The run goes on.** A load node's failure does not set `hasFailure`. The
  loop goes on launching (`:912`), takes a yield (`:1060`) and reports a
  stuck run (`:1111`) as it does when nothing has failed. A task's failure
  stops the run, as today. The record keeps its last commit.
- **The node runs again when its feed moves.** `stepTasksDue` returns a
  failed load node to `pending`, and takes it out of the `failed` count, once
  its feed's output has moved since the launch that failed. A change of its
  record alone does not run it again: its pieces read the delivery and its
  own source's entries, which no edit and no other source's load changes.
  Today a failed task is left as it is when an input moves, because its run
  is ending (`stepInvalidateTasks`, `steps.ts:525`).
- **The run ends as its nodes stand.** `stepFinalize` is unchanged. A run
  ends failed when a node stands failed at its end (`state.failed`,
  `steps.ts:1246`), and its record names that node
  (`LocalOrchestrator.ts:1145–1156`). A load that failed and then loaded its
  feed's next output leaves a run that ends completed, with the failure in
  its events. The ruling says the run ends failed, naming the load. This
  reads it for a load that still stands failed when the run ends: the
  reviewer's call 1, asked before it is built (§11.2). Should a run end
  failed whenever a load failed during it, `stepFinalize` reads a mark the
  failure leaves, and nothing else here changes.
- **Readers.** Before the source's first delivery they wait, as ruling 1 has
  it. After it they run on the record as it stands.
- **The next run** tries the load once more. A failed execution is never
  served from the cache.

```
$ e3 dataflow run . main                                # combine_erp's new output is one loadErp fails on
  [START] combine_erp
  [CACHED] forecast                                     # on orders as it stands
  [DONE] combine_erp [1840ms]
  [START] orders.erp
  [FAIL] orders.erp [412ms] (exit code 1)               # told as it fails: orders keeps its last delivery
  [START] forecast                                      # someone saved an edit of orders: the run goes on
  [DONE] forecast [930ms]
  [START] combine_erp                                   # erpOrders changed again
  [DONE] combine_erp [1790ms]
  [START] orders.erp                                    # its feed moved: the load runs again
  [DONE] orders.erp [5080ms]
  [START] forecast                                      # the load's commit is a change of orders
  [DONE] forecast [930ms]
```

Had the feed not moved again, the run would have ended once nothing else was
due: its summary counting one failed, `orders.erp` listed under `Failed
tasks:`, and exit code 1, read from the nodes' states at its end as a run
with a failed task ends today (`e3-cli/src/commands/start.ts:244–277`). The
rule is the shared loop's, so every backend's runs take it.

**Force and filter.**

- A forced load node (`--force`, or the node named) runs its pieces past the
  cache and past the slots' answer. When the slots already name its delivery,
  it commits only if its delta changes something.
- `--filter orders.erp` runs the node and what it depends on (`stepGetRunSet`,
  `steps.ts:297`).
- `--filter forecast` runs `forecast` on the record as it stands, and loads
  nothing.

**One load of a source at a time.** A workspace runs one dataflow at a time
(`<ws>#dataflow`), and `e3 load` and the load route refuse a fed source, so a
load node takes no queue lock. A commit of the same delivery by a run another
process took up is caught by §7.6's walk.

**Waiting, and its words.** `PrepareTaskWaiting.unassigned: string[]`
(`dataflow/types.ts:124`) becomes `waits: InputWait[]`, a hard cutover:

```ts
type InputWait =
  | { input: string; kind: 'unset' }                          // no value: today's case
  | { input: string; kind: 'pending'; sources: string[] }     // a record yet to hear from these sources
  | { input: string; kind: 'package' }                        // a feed input holding its package's value
  | { input: string; kind: 'upstream'; task: string };        // a record whose load node waits
```

`unset` is today's wait whole: an input with no value, or an index its
record's state does not hold (F39), with the words it has today.

- `stepPrepareTask` classifies a `null` from `dataflowResolveInputs` by the
  input's ref: `$pending` set, which is read first, or not.
- `stepPrepareLoad` gives its own.
- `stepTasksWaiting` gives a waiting node's dependents `unset` for a task's
  output, as today, and a record's readers `upstream` for its load node that
  waits.
- `onTaskWaiting(taskName, waits)` replaces `(taskName, inputs)`
  (`dataflow.ts:208`, `orchestrator/interfaces.ts:162`,
  `LocalOrchestrator.ts:976`, `execution/local-orchestrator.ts:146`). So do its
  callers: `e3-cli` `start.ts:209` and `watch.ts:248`,
  `record-deploy.spec.ts:914`, and `contract/dataflow.ts:399` and `:449`.

The CLI says each (§7.13). No event carries the reasons: a run's events are a
stored form (`steps.ts:782–784`).

**Deferring, and its words.** A deferral's reason reaches the run's caller as a
`DeferReason`, one of the four cases of §4.10:

```ts
type DeferReason =
  | { kind: 'plain'; input: string; through: string[] }                     // a plain input its inputs read at two values
  | { kind: 'forgotten'; record: string; source: string; roots: string[] }  // a fed delivery a rollback, restore or migration forgot
  | { kind: 'carried'; records: [string, string]; root: string }            // two fed records carrying different versions of one root
  | { kind: 'feed'; record: string; source: string; input: string };        // a fed record beside the input that feeds it, once it changed
```

- `through` names the task's inputs that read the plain input at different
  values: each a task's name, or the input's own where the task reads it
  directly. `roots` names the roots the forgotten source's feed reads that
  another input of the task names.
- `onTaskDeferred(taskName, reason)` replaces `(taskName, conflictPath)`
  (`dataflow.ts:204`, `orchestrator/interfaces.ts:153`,
  `LocalOrchestrator.ts:961`, `execution/local-orchestrator.ts:145`), a hard
  cutover. No caller passes it today; `e3-cli`'s `start.ts` and `watch.ts`
  will (§7.13).
- The run tells a deferral once. A task deferred again for the same reason,
  with no launch between, is not told again and records no second
  `task_deferred`. The event keeps its form: its `conflictPath` is the input,
  or the first root, that the reason names.

**History's prune (F29).** `keepOf` (`history.ts:441`) names a load node's
current execution by the record's `$load.<source>.execution` slot,
`${node.hash}/${inputsHash}`, read with the record's ref. This replaces the
inputs hash over the graph's inputs (`:477–481`). A node whose slot is gone
has no current execution.

**A workspace's bundle and its copy (F45).** A bundle's head lists each
task's current execution the same way, over the graph's inputs
(`headOf`, `workspace-bundle.ts:186`), and so names a load node's from the
slot too, or a workspace made from the bundle would run every fed load
again. A copy writes every ref as it stands, the slots with it
(`workspaceCopy`, `workspaces.ts:340`), and both workspaces are of one
repository, so a copied composite reads as loaded with nothing changed.

**The upgrade step.** `e3-core/src/upgrades/dataflow-graph-loads.ts` carries
every stored run into the form whose graph nodes carry `load`, with `none` on
each. It follows `dataflow-force-tasks.ts`:

- both forms frozen;
- every run read through `StorageBackend.runStates`;
- a run already in the new form, or in neither, left as it is;
- a workspace a unit, in parts.

It is appended to `REPOSITORY_UPGRADES` (`repository-record.ts:59`), after
the eight steps registered there today: a step is never reordered once
released. Its frozen "before" form is the run state as the last of those
steps left it, with every change that has landed unreleased since.

### 7.9 e3-core: the deploy intent, locks and feed inputs (rulings 2, 6, 9 and 13, F5, F13, F16, F22–F25, F34)

The stop signal uses only the lock service, which every backend implements
(`LockService`, `storage/interfaces.ts:1012`), so it crosses processes and
machines with no new store and no new method. The functions below live in
`e3-core/src/deploy-lock.ts` (new), over `LockService` alone, and are
exported from the portable entry, so every backend shares them. `<ws>#deploy`
is a lock's name as `<ws>#dataflow` is: a lock's name may hold the `#` no
workspace's may.

- **The probe** (ruling 17). `deployAnnounced(storage, repo, ws)` reads the
  intent's state first (`LockService.getState`, `storage/interfaces.ts:1048`),
  and asks `acquire`, shared and without waiting, only when the state shows a
  holder, so a holder is still judged as the lock service judges every
  holder, a dead one's lock cleaned as any is. Every run in flight and every
  load job checks once a second. On a lock service whose locks are writes to
  a store, taking the lock and letting it go each time was two writes a
  second for each of them, all day, where one read answers. The interval,
  and every other limit of §8, is unchanged. The intent is taken exclusively,
  which is what a state read sees (`getWorkspaceLockState` reads the
  exclusive holder alone, `storage/local/LocalLockService.ts:550`).
- **A deploy announces itself** (F5, F23). `acquireForDeploy(storage, repo,
  ws, { waitMs = 30_000 })`:
  1. takes `<ws>#deploy` exclusively, as `deployment`, waiting up to `waitMs`;
     a null is refused `workspace_locked`, naming the other deploy that holds
     it;
  2. takes the workspace's lock exclusively, as `deployment`, waiting what is
     left of `waitMs`; a null lets the intent go, and is refused
     `workspace_locked`, naming the holder (`getState(repo, ws)`), as today;
  3. answers one `LockHandle` over both: its `resource` and `report` are the
     workspace lock's, so a deploy's progress reads as today
     (`getProgress(repo, ws)`), and its `release` lets the workspace lock go,
     then the intent.

  `workspaceDeployWith` (`workspaces.ts:782`) takes its lock through it in
  place of its acquire at `:800`. A caller that hands a deploy its own lock —
  `ProcessDeployDeps.lock` (`transfer/process.ts:348`), the deploy options'
  `lock`, a host that runs one deploy job over several calls — must take it
  through `acquireForDeploy`, which both TypeDocs and the seams convention
  say (§11.1). A new workspace's bundle import (`workspace-bundle.ts:379`)
  takes its lock as today: no load or run holds a workspace that does not yet
  exist.
- **A plan announces nothing** (F24). `workspaceDeployWith` with `plan: true`
  takes the workspace's lock shared, through `acquireWorkspaceShared`, and
  stops nothing.
- **Writer preference** (F25). `acquireWorkspaceShared(storage, repo, ws,
  operation)` probes the intent first: once a deploy has announced itself it
  answers null at once, which its caller reports as `WorkspaceLockError`
  naming the deploy (`getState(repo, '<ws>#deploy')`); otherwise it takes the
  lock shared, as today. Every shared taker uses it: `trees.ts:410`
  (`dataset_write`), `records.ts:425` (`withSharedWorkspaceLock`: mutations and
  system commits), `workspace-bundle.ts:161` (export), `workspaces.ts:358` (a
  copy's source) and `LocalOrchestrator.ts:485`, `:567` (a run's start and
  resume). A function's call starts under `withSharedWorkspaceLock` too
  (`functionCallStart`, `execution/functionCall.ts:315`), so it is one of
  them. A load job waits on the intent instead (§7.5 step 4). A shared taker
  that took the lock just before the deploy announced finishes, and the deploy
  waits for it.
- **A refusal names the deploy.** `WorkspaceLockError` (`errors.ts:239`) says
  a holder whose operation is `deployment` is a deploy: `Workspace 'main' is
  locked by a deploy in process 51234 (since 2026-11-02T10:05:00.000)`, or
  `Workspace 'main' is locked by a deploy (since …)` for a holder with no
  process id, such as a lease. Every other holder reads as today.
- **The waits run in loops** (F22). A load's wait for its queue lock and for
  the intent are loops of 30-s acquires, each turn checking the signal and
  re-referencing the delivery (§7.5). A deploy's wait is bounded (§8).
- **A load job stops** (ruling 2). The deploy watch (§7.5) probes the intent
  every second. Once a deploy has announced itself, the load aborts its units
  and its commit, releases the workspace lock, reports `stopped`, waits on the
  intent, and starts again from §7.5 step 4.
- **A load job restarts** against what the deploy left:
  - a removed record or source fails the load, naming it;
  - a changed key or delivery type fails it too;
  - a changed load function runs the new one, and the slot records it.

  Pieces whose program and inputs did not change come from the cache. A deploy
  that did not touch the record leaves every piece valid.
- **A run stops for a deploy** (rulings 6 and 13, F34). A run that people keep
  editing under does not end by itself (§7.8), so every run in flight probes
  the intent every second, loading or not. Once a deploy has announced itself,
  the run cancels itself as a stop request does (`cancel`,
  `LocalOrchestrator.ts:782`; `endCancelled`, `:1281`), with the reason "a
  deploy of <ws> started":
  - running units and catch-up runs stop through the runner's signal;
  - a load's commit in flight stops before its next write;
  - the run lets the workspace go;
  - its `execution_cancelled` event records the reason: `endCancelled`
    already takes one and hands it to `stepCancel` (`steps.ts:1287`), whose
    event carries it (`reason: Option<String>`), so no stored form changes.
    Its wait rejects with `DataflowAbortedError`, whose new `reason`
    (`errors.ts:516`) holds it: the run keeps the reason it stopped for, and
    the loop's throw (`LocalOrchestrator.ts:1131`) passes it on. A stop
    request leaves `reason` unset;
  - while it stops it is a stopping run as any is: its poll answers
    `stopping` until it has let the workspace go, and the deploy's wait
    (§8) is for exactly that.

  The CLI says how many tasks completed before the stop (§4.13).
  `buildPartialResults` (`LocalOrchestrator.ts:1974`) counts a task with a
  result in the run as completed, whatever its status: a task due again keeps
  its result while it runs again, and goes back to `pending` when the run
  stops (§7.8).

  Every result it landed stands, and finished pieces and executions stay in
  the execution cache. Nothing restarts the run by itself. The first start
  after the deploy — a view's after its next write, or `e3 watch`'s — runs as
  of the deployed package, its loads from the pieces still valid. An edit
  never stops a run (ruling 13): the run takes it in (§7.8).
- **Feed inputs at a deploy** (ruling 9, F16). `planInputDeployments`
  (`input-deploy.ts:167`) takes `feeds`: each input of the new package that
  feeds a load, to the load's name (`orders.erp`), read from the package's
  record and load objects. For an input in `feeds` that someone set
  (`heldValue` answers `set`):
  - its type unchanged, under `reset`: `retained { load }`, kept as the
    workspace holds it, which `refsKeepingInputs` (`:235`) keeps as it keeps
    a `keep`;
  - its type unchanged, under `keep-edited`: `keep`, as any input;
  - its type changed: `reset`, as today, the reason adding "orders.erp waits
    until it is set again".

  An input that holds its package's value is planned as today, and the load
  waits on it (§7.8). A record that feeds a load is planned as a record
  (§7.7), never as an input. The CLI says a `retained` input (§7.13).

Three changes in behaviour, for every workspace:

- A deploy stops a run in flight, where today it is refused while one runs.
- A deploy that finds the workspace held by a write in progress waits up to
  its bound before it is refused, where today it is refused at once.
- A mutation, set, export, copy or run start is refused while a deploy has
  announced itself, as it is today while a deploy holds the workspace. The
  window is the deploy's wait, at most 30 s, longer than today's.

A workspace's removal and its export as a package take it exclusively, and
are refused while a run is in flight, as today: a run that people keep
editing under is stopped first, by a stop request.

### 7.10 e3-core: garbage collection (F26)

- `gc-graph.ts`: a record object's children (`extractChildren`) add each
  external source's load object (`node`). The load object is a tagged kind, an
  entry of `TAGGED_KINDS`: its child is its task object (`node`), which gc
  already walks to its program, its merge and its environment
  (`TASK_OBJECT_KIND`). `RECORD_OBJECT_FIELDS` follows the record object's new
  field by itself (`namesOf`). As for the index object's `form`, a record
  object an earlier SDK exported is no longer known by its shape, and the
  programs only it names are swept; its package is re-exported (§6).
- **A load job's delivery.** The job holds running work from its creation to
  its end (§7.5 step 1), so held gc, refused while work runs, never sweeps it.
  gc beside running work deletes an object only once it has been unreachable
  and untouched for its window: the job re-references the delivery when it is
  made and at each turn of its waits, at most 30 s apart. Between an upload and
  the job's creation the delivery is fresh: held gc's age gate (`gc.ts:127`, a
  minute) and the window cover the gap; a job made later than that, after a gc,
  fails with words that say to upload again.
- **What a load writes before its commit roots it** is held:
  - for a load job, by its running work;
  - for a load node, by its run's `<ws>#dataflow` lock, which held gc takes
    with every workspace's before it sweeps.

  That is the stored run, the pieces (rooted by the split execution's `$plan`
  while it can resume), the delta (the execution's output), and each attempt's
  commit and state. The adoption memo stays a memo, not a root.

### 7.11 e3-core transfer, and the API server

- **`TransferBackend.recordLoad: RecordLoadStore`** (`transfer/interfaces.ts`),
  with create, get, updateStatus, delete and execute, as `SplitCallStore` has
  (`:268–291`), and with its contract for an end: `updateStatus` records a
  status only while the job has not ended — `completed`, `failed` or
  `cancelled` — the check and the write one atomic step, and answers whether
  it did. A cancel is that write of `cancelled` (R85, §7.5).
  `InMemoryTransferBackend` runs each job in the background, and runs one
  source's jobs in the order they were made (a chain per source).
  `handleProcessRecordLoad` (`transfer/process.ts`) calls `recordLoad`, its
  progress throttled to 500 ms as a split call's is, reads its record once a
  second for its end as a split call's job does (`SPLIT_CANCEL_POLL_MS`,
  `:535`), and takes a refused progress write for the same. A job stopped by
  its signal hands over as a split call's does, left `processing`. The job's
  stored form is `RecordLoadJobType`, in e3-core's `transfer/types.ts` beside
  `SplitCallJobType`: hashes, names and a status, so a store with small
  records keeps it.

  A load job is a `TransferBackend` job, as a split call is, and not a record
  of the repository as a kept call is (`StorageBackend.calls`, with gc's
  `gcScanCallRoots`): once it commits, the record's ref roots what it wrote,
  and until then its running work and its re-references keep its delivery
  (§7.10), so gc needs no root for it.
- **`TransferBackend.objectUpload: ObjectUploadStore`** (F8). This is the
  dataset upload's protocol (init `{hash, size}`, parts, commit, poll) with no
  dataset: the commit verifies the bytes, stores them as an object under their
  SHA-256, and writes no ref. It is a new kind, so no stored job record
  changes. A split call can now take a large local file as an `object`
  argument too.
- **Routes** (`e3-api-server`), in the route factories e3-web shares:
  - `POST /repos/:repo/workspaces/:ws/records/:rec/loads/:source` → `{ id }`
    (the deploy's job response), its body a `RecordLoadRequest`;
  - `GET  /repos/:repo/workspaces/:ws/records/:rec/loads/:source/:id` →
    `RecordLoadStatus`;
  - `POST /repos/:repo/workspaces/:ws/records/:rec/loads/:source/:id/cancel`,
    as `POST …/split/:id/cancel` is for a split call: it writes the job
    `cancelled`, and answers a job that had already ended as it ended;
  - `POST /repos/:repo/workspaces/:ws/objects` (init), `GET
    …/objects/upload/:id/parts/:n`, and `POST …/objects/upload/:id` (commit;
    then poll with GET).

  A load is a write. **Who may load** (R86; the reviewer's call 6): the
  record routes ask the host nothing about a mutation today, and a delivery
  replaces a whole source, so a host with roles of its own will want to grant
  it apart from an edit: to the integration that sends it, not to everyone
  who may change a row. The workspace function routes already ask the host
  whether a caller may pass a draft, which is whether they may commit its
  mutation (`draftAccess`, beside `CallAccess`). The load, cancel and upload
  routes ask through a seam of the same kind, given the record and the
  source, and a host that gives no rule allows what its mutate route allows:
  the local server and e3 in a page allow every caller. A refusal is
  `permission_denied`, whose one field, `path`, names the record and the
  source as the load is named, `orders.erp`. The actor is resolved as a
  mutation's (`resolveActor`). A load of a fed source is refused `invalid`,
  naming its feed.
- **The dataflow's answers.** The graph and run-state answers carry each
  node's `load`, and the run start answers `DataflowStartResult`, handing a
  start to the run in flight through `wake` (§7.8). Client and server ship
  together.
- **The deploy route** takes its lock through `acquireForDeploy` (§7.9).

### 7.12 e3-api-client

`workspaceRecordLoadLaunch`, `workspaceRecordLoadStatus`,
`workspaceRecordLoadCancel`, and `workspaceRecordLoad` (launch, then poll as
`splitCall` does, `e3-api-client/src/functions.ts:1053`, with `onProgress`
and a `signal` that stops polling while the job runs on). Its
arguments are `(url, repo, ws, record, source, request, requestOptions, {
onProgress, signal })`, `request` a `RecordLoadRequest` with its `asOf`. Also
`objectUpload` (init, parts, commit, poll), `workspaceRecordDescribe`'s
`sources`, the graph nodes' `load`, the input plan's `retained`, and
`dataflowExecuteLaunch` (`e3-api-client/src/executions.ts:63`) answering
`DataflowStartResult`, where it answers nothing today. Its retries of a
`workspace_locked` stay for the holders that still refuse a start: a deploy,
a removal, a copy, a run that is stopping, and a run `wake` cannot reach.
`dataflowExecute` follows a run it was handed from the `since` it was given.
The callers that start a run and ignore the answer need no change:
e3-ui-components' dataset store and e3-ui-cli's run screen.

### 7.13 e3-cli

- **`e3 load <repo> <record>.<source> <delivery> -w <ws> [--as-of <time>]`**
  (`commands/load.ts`, registered beside `mutate`/`seed` in `cli.ts`). The
  delivery is `#<hash>` for a stored object, and any other argument is a
  beast2 file. `--as-of` is read as East reads a DateTime
  (`parseFor(DateTimeType)`: `2026-11-02T03:00:00`, UTC), and a time it cannot
  read is refused, naming the form.
  - Locally, it calls `recordLoad` in process: a file is adopted as `seed`
    adopts one (`objectAdoptFile`), and progress goes through the intake
    reporter and a pieces line.
  - Remotely, a file is uploaded (`objectUpload`, its hash streamed), then
    `workspaceRecordLoad` is polled. What Ctrl-C does to a job it follows,
    now that a job can be cancelled (R85), is question 4 (§11.2); the third
    revision had it stop following and leave the job running.
  - A fed source is refused, naming its feed and `e3 dataflow run <repo> <ws>
    --filter <record>.<source>`.

  It answers as §4.3 does: `Loaded …` with the counts and the as-of,
  `already holds this delivery`, or `… nothing loaded (superseded)`. A
  superseded delivery exits 0: nothing went wrong.

  Its progress (§7.5) prints as §4.3, §4.11 and §4.13 show it:
  - `queued`: `Waiting for an earlier load of orders.erp to finish…`;
  - `intake`: the intake reporter's `Taking the delivery in… done`;
  - `pieces`: `Pieces 37/37`, with ` (21 from the cache)` after it when the
    cache answered any. The line is printed once the pieces settle, stop or
    restart, and counts up in place on a terminal;
  - `restarted`: `Loading again: ` and the reason, `the entries of source
    'erp' changed under its load`;
  - `stopped`: `Stopped: a deploy of main started. The load goes on once the
    deploy is done…`;
  - `commit`: nothing, since the answer's line follows it.

  A job that fails prints its message and exits 1; a deploy's are §4.13's.
- **`e3 dataflow run`** prints a load node's lines as a task's (§4.4):
  `[START]`, `[PART]` for its pieces, `[DONE]`, `[CACHED]` when the slots or
  the cache answer it, and `[FAIL]` or `[ERR]` with the load's message.
  - A local run prints a catch-up run (`onCatchUp`) as `[CATCH-UP] capacity
    for plan` as it starts, and `[DONE] capacity for plan [50120ms]` as it
    lands. The summary's counts are per task, as today, and count no catch-up
    run.
  - A deferral (`onTaskDeferred`) prints `[DEFER] <task>: ` and
    `describeDeferral(reason)` (`commands/start.ts`), once each time the run
    tells it (§7.8):
    - `plain`: `input 'rates' is read at two values (through forecast and
      capacity): it runs once they agree`. A direct read is said `directly`,
      before the tasks: `(directly and through forecast)`. Three or more
      tasks are joined `forecast, capacity and supply`;
    - `forgotten`: `orders.erp's delivery was forgotten, so nothing says which
      erpOrders orders holds: it runs once orders.erp loads again`, two or
      more roots joined as tasks are;
    - `carried`: `orders and invoices hold deliveries made from different
      versions of erpOrders: it runs once their loads catch up`;
    - `feed`: `orders holds a delivery made from an earlier value of input
      'erp_extract': it runs once orders.erp loads the new one`.
  - A run a deploy stopped prints, after its tasks' `[CANCELLED]` lines, a
    blank line, `Stopped: ` and the error's `reason` with a full stop, and
    `  Completed before it stopped: N`, and exits 130 (§4.13). A run stopped
    by a signal prints `Aborted.` and `  Completed before abort: N` as today,
    N counted as §7.9 counts it.
  - A remote start answered `handed` prints "A run is in flight on <ws>: it
    takes your changes in now.", and follows the run from `since`:
    `followRemoteRun` (`start.ts:375`) takes its first cursor as an argument,
    0 for a start answered `started`. Ctrl-C after a handed start sends no
    cancel: it prints `Stopped following the run on <ws>, which goes on.`
    after the signal's line, and exits 130. After a start answered
    `started`, Ctrl-C cancels the run, as today.
- **`e3 watch`** prints the same `[DEFER]` and catch-up lines, and, for a run a
  deploy from another process stopped, `Dataflow stopped: a deploy of <ws>
  started` in place of `Dataflow aborted` (`watch.ts:263`).
- **Waiting words.** `describeUnset` (`commands/start.ts:465`) becomes
  `describeWaits(waits)`, which `start.ts:209` and `watch.ts:248` print after
  `[WAIT] <task>:`:
  - `unset`: `input 'x' not set`, as today;
  - `pending`: `record 'orders' waits for the first delivery of erp`, the
    sources joined with commas;
  - `package`: `input 'erp_extract' holds its package's value: set it, and
    orders.erp loads it`;
  - `upstream`: `record 'orders' waits on its load orders.erp`.

  The summary line (`start.ts:478–481`) becomes "N tasks wait on an input that is
  not set, or on a record's load: set the input, or load the record's sources,
  and run again.", and the watch's (`watch.ts:256`) "N waiting on an input or
  a load".
- **Input plan lines.** `inputPlanLine` (`commands/workspace.ts:545`) says
  `keep input inputs/erp_extract, as it was set: it feeds orders.erp, which a
  deploy never resets`, and both `e3 workspace deploy` (`:604`) and `e3 watch`
  (`watch.ts:190–193`) print a `retained` input's line.
- **`e3 history`** says a `$load:` commit in words, with its as-of, and
  `--delta` (local) shows its delta as for a mutation (`commands/history.ts`).
- **`e3 dataset get -f beast2` writes the stored segments** (§5 of the issue,
  F7; `commands/get.ts`).
  - Locally, a collection streams `DatasetSegments.open(…).splice()`, and any
    other value writes its stored bytes.
  - Remotely, it streams `datasetGetStream`'s chunks and decodes nothing.

  Other formats are unchanged. The standard output is a stream, so a read
  that fails part way — a dataset that moves while a server's is read — has
  written part of a value: the command says so as it exits 1. `-o <path>`,
  in every format, writes a file whole or not at all: beside the path, then
  renamed into place, the read starting over when the dataset moves
  (ruling 35).
- **`e3 seed`** refuses a composite.
- **The lines come from callbacks a spec can drive.** The callbacks
  `startCommand` and `loadCommand` print through are factored out of them, so
  `start.spec.ts` and `load.spec.ts` hand them a run over the gated runner and
  check the lines printed (§9.1).

### 7.14 e3-web

`WebTransferBackend` gains `recordLoad` and `objectUpload` stores. Each is a
`JobStore` with its record type (`{ job, owner, finishedAt }`), and the
`TransferKind`s go in `WebStorage`'s `transferKeys` / `stagedKeys`, which the
sweep covers. Pieces run on the page's worker runner as a split call's do.
Routes come from the shared factories. Its runs follow their records through
the shared steps and `LocalOrchestrator`, a load node among them, and its run
start hands over through `wake` (§7.8). Its locks go through the shared
functions of §7.9. Its `recordLoad` store keeps an end as its split call
store does, the check and the write in one records transaction. It runs the
stores' contract suites and the routes' suites over its own stores, as it
does today (`stores.spec.ts`, `web-compliance.spec.ts`).

### 7.15 e3-ui, e3-ui-components, e3-ui-cli (F9, F30)

> **Not yet audited.** This section, task group G and the review's tasks L
> and M are the fifth pull request's, which waits for the finished Plan. The
> references below are those of the first audit (`79a84cdc4`) and name Sheet
> code that is gone: on the record branch the Sheet's root and types were
> rewritten and its renderer is thousands of lines shorter. They are audited
> against the code as the Plan leaves it, before the fifth pull request is
> cut. Until then the rules of the review, written next, are what the
> builders must meet, and where a bullet after them disagrees, the rules
> hold.

**The rules the builders meet** (the review's section 10; R89, R90).

- **A new row's key is the edit session's.** The third revision added
  `SheetRootType.newRowKey`, read beside `newRowId` and `mintId`. Neither
  exists any more. A new row's key is made by the edit session's key policy
  (`EntryKeys`, `east-ui-components/src/editing/keys.ts`), for the Sheet and
  for every schedule builder, or by the app's own `newKey`. A policy keys a
  String key or an Integer one. A composite's key is a variant, so as the
  code stood at the review no builder adds a row to one unless the app
  writes `newKey`. So:
  - **One policy, `caseKeys(keyType, source, keys)`, in `editing/keys.ts`.**
    It makes the keys of one case of a variant key by an inner rule. It gives
    the inner rule the known keys of that case alone, each as its value's id,
    with `from` and `taken` the same way, and answers the inner rule's key
    under the case, as East prints `variant(<source>, key)`. It reads and
    prints keys through East (`parseFor`, `printFor`), since every policy
    handles a key as its text.
  - **Bound by every builder's session** where the binding names the
    record's sources (G1). The inner rule is the one the builder binds today
    for the case's key type. So a composite whose solution source is keyed by
    a String or an Integer takes new rows in every builder, with nothing
    written by the app. With several solution sources the builder's `source`
    names the one. With none, inserts are off.
  - **Over paged rows**, the Integer rule's largest key is the last key of
    the source's run, read by key order within its case, where today it is
    the record's last key.
  - **The app's own `newKey`** is as today: it is given the keys taken and
    answers a key of the record's type, case and all.
  - **`SheetRootType.newRowKey` is not added**, and G4 goes: what is left of
    it, the `source` option, is L1's. No wire changes for a new row's key.
- **One lock.** The third revision gave the Sheet a row lock of its own
  (`SheetRowType.lock`, `keyLock`), and left the other editors to refuse an
  external entry at Apply. The Plan's design has a lock on one event or item,
  an option of the shared schedule events that every schedule builder takes,
  and has an external source's events locked by it. So:
  - **One check** says whether an entry is its load's: its key's case, looked
    up in the binding's sources. The Sheet's `keyLock` and the schedule
    builders' lock both ask it, and neither works it out alone.
  - **Refused at the gesture, in the source's words.** A typed value, a move,
    a resize, a removal, a paste or a fill over a locked entry, and a form's
    edit of one, are refused where they are made, and no draft is made.
    Nobody works on a change that Save then refuses.
  - **An optimiser's answer** that changes a locked entry is refused, naming
    the entry.
  - **Drawn locked** in each builder, by a data attribute its slot recipe
    styles, under an invariant measured in the DOM.
  - **Apply's refusal** (G2) and the server's (§7.4) stay behind it.

  Where the check and the policy sit is settled when the UI pull requests
  are cut, against the editing core as the Plan leaves it.

**The third revision's text, not yet audited:**

- **The binding names the sources.**
  - `Record.bind(record)` passes the record's sources, `[{ name, external }]`,
    as a literal second argument to `record_bind` (`bind/record.ts:303`). It is
    empty for a plain record.
  - `RecordRuntime.buildHandle` puts them in `binding.sources`
    (`RecordBindingType`, `:121`).
  - `deriveManifest` is unchanged; it reads the name alone.
  - `deriveUiAccess` reads them into `UiAccess.records[].sources`, so a host
    sees them before deploying the UI.
- **Apply never names an external entry.** `Record.onApply`
  (`applyToRecord`, `bind/record.ts:666`) reads each change's key from its id
  (`:789–791`), as it does today. A change of an external case — the key's
  case looked up in `binding.sources` — is answered `variant("rejected", [{
  entry, row: none, field: none, message }])`, "entry .erp "SO-1001" is
  source erp's, which only its load writes", before any commit is sent. The
  entry form (`:703–780`) rejects an entry key of an external case the same
  way. The server refuses either anyway (§7.4).
- **New rows are the solution's** (F30). *Superseded by the rule above:
  `newRowKey` is not added.* `SheetRootType` gains `newRowKey:
  Option<Function(String) -> String>` (`sheet/types.ts:1026`), and
  `SheetInternalOptions` (`sheet/root.ts:342`) its builder's side. The renderer
  (`e3-ui-components` `sheet/index.tsx`) reads it beside `newRowId` (`:723`),
  and each place that mints a new row's id — from `newRowId`, or `mintId`
  (`:299–304`) — passes the id through it: the new row's id is the answer, and
  the check that an id is not yet taken is made on the answer.
  `<Sheet record>` (`sheet/record.ts:125–135`) sets it when the record's key
  is a variant with one solution source keyed by String — or, with several,
  the one its new `source` prop names — to `($, id) =>
  East.print(variant(<source>, id))`: the `.east` text `Record.onApply` parses
  back to `variant('own', id)`. The refusal at `root.ts:704–709` accepts
  `newRowKey` as it accepts `newRowId`. A composite whose solution sources
  are keyed otherwise needs `newRowId` or `edits={{ insertRows: false }}`, as
  any key that is not a String does today; one with no solution source has no
  new rows (`insertRows` false).
- **The Sheet locks a source's rows** (F9).
  - `SheetRowType` gains `lock: Option<String>` (`sheet/types.ts:250`): the
    words that lock the row, or none.
  - `rowOf` (`root.ts:840`) takes the lock as a third argument. A new internal
    option, `keyLock: (key) => Option<String>`, gives it from the row's key in
    `makeKeyed` and `makeOrdered` (`:868–880`); a positional row has none.
  - `<Sheet record>` sets `keyLock` when `binding.sources` names an external
    source: a `match` over the key type's cases, each looking its case up in
    `binding.sources` at runtime, an external one answering `some("loaded from
    erp")`.
  - The renderer sets `data-locked` on a locked row's cells, and the sheet's
    slot recipe styles it: the renderer sets attributes and geometry, the
    recipe every style. A locked row takes no edit, and a delete, a paste or a
    fill over it is refused with the lock's words, as a read-only sheet refuses
    one; it is drawn as a read-only row is otherwise.
  - Covered by a DOM-measured invariant, not a screenshot.
  - `owned` (`root.ts:200`, `sheet/types.ts:244`) is unchanged: it says the
    upstream system owns a row's stamped columns, and a locked row takes no
    edit at all.
- **One entry's rows** (`sheet/record.ts:161–195`): read-only also when the
  entry's key is of an external case, `readOnly: held.hasTag("none") ||
  <external case>` (`:189`).
- **The terminal UI** (`e3-ui-cli` `tui/data/records.ts`, `tui/api.ts`,
  `tui/api.fake.ts`):
  - the records view shows a record's sources under its name: external or
    not, its feed, the last delivery and its as-of, and pending;
  - the workspace dashboard shows a load node as a step of the run after its
    feed, with its pieces, from the graph's `load`.
- The Plan and the other editors over a record write through
  `Record.onApply`, so they cannot write an external entry. *Superseded by
  "One lock" above: every builder draws those entries locked and refuses the
  gesture, in the fifth pull request.*
- **A view's start after a write is handed to the run in flight** (§7.8).
  `writeAndStart` and the record handle's start are unchanged: their start is
  answered `handed` where it was refused, and the view's results follow the
  edit as their tasks land. This one bullet is the first pull request's, and
  is audited: the store's start is `launchDataflow`
  (`e3-ui-components/src/platform/dataset-store.ts:198`, `:789`), which
  awaits the launch and ignores its answer.

### 7.16 e3-cloud (companion)

Nothing here was read from, or planned against, the hosted backend's code:
this lists what the shared code asks of any backend whose runs and jobs are
held by other processes, and §11.1 says which pull request asks for each and
which shared suite pins it. The companion issue builds:

- the two job stores, the load's with its end kept by a conditional write
  (§7.11), and the cancel it serves;
- the host's rule on who may load, through the seam the load routes ask
  (§7.11);
- the new lock names in its lease service (`<ws>#deploy`,
  `<ws>#load~<record>~<source>`), and its own lock takers routed through
  `acquireForDeploy` and `acquireWorkspaceShared` (§7.9);
- a load job's pieces on its orchestrator, as a split call's;
- in its dataflow orchestrator:
  - the run of §7.8 through the shared steps: results recorded with their
    launch vectors, due tasks, a task's commits, and catch-up runs as
    executions of its own;
  - `wake`, handing a start to its run in flight;
  - a probe of the deploy intent at least every second while a run is in
    flight, cancelling it (§7.9): one read of the intent's state each time,
    and a lock taken only when it shows a holder;
  - a load node's failure that leaves the run going (ruling 15, §7.8);
  - a load node: its units as a split task's, and its commit as a step of its
    own (`recordLoadCommit`) outside any shared state update, with no `base`
    across invocations (§7.6's run check) unless it keeps `H0` in its own step
    state;
- its stored graph (`graphHash`) gaining `load`, with its own upgrade step.

Everything else is shared e3-core logic.

## 8. Limits and timings (approved, ruling 17)

Approved as proposed on 13 November 2026. Each comes in with the pull request
that builds it: a run's and a deploy's in the first, a load's in the third.
The one change since the third revision is how the deploy check is made
(§7.9): a read of the intent's state, at the same interval.

| Limit | Approved | Today |
|---|---|---|
| How often a running load job probes the deploy intent | every 1 s | none |
| How often a run probes the deploy intent | every 1 s, every run in flight, loading or not | none |
| How long a deploy waits, for the intent and then the workspace lock | 30 s in all, then `workspace_locked` as today; a run in flight stops within about a second of the intent. This applies to every deploy | refused at once |
| How soon a run in flight takes in an edit | at once when a start reaches the process that runs it, as a view's does after each write; otherwise at the run's next completion | at its next completion; a start is refused |
| How long a run lasts | until no task is due, ready, in flight or catching up; under steady edits, until it is stopped or a deploy stops it | the same, its slow results thrown away |
| Catch-up runs | at most one of each task a task reads through, per run of that task, at commits the run has seen, and under steady edits about that many (§4.6); never written to the workspace | none: the task is deferred |
| A task deferred for consistency | while two of its inputs read a plain input at different values; while a fed record's delivery is forgotten; while two fed records carry different versions of one upstream; while it reads a fed record and the plain input that feeds it, and the input's new value loads. Each ends once a run or a load catches up | while any two of its inputs came from different commits |
| A shared taker while a deploy has announced itself | refused at once, naming the deploy | refused at once while the deploy holds the workspace |
| A load's wait for its source's queue, and for a deploy to finish | no bound; 30-s acquires in a loop, each turn checking the signal and re-referencing the delivery. Since ruling 37, of a lock service that queues its waiters the wait for the queue is one acquire with no bound, which keeps the load's place, the delivery re-referenced every 30 s meanwhile | n/a |
| A landed load's write of its `completed` status (ruling 38) | tried again once a second, with no bound, until the store takes it or the job's caller stops the job | n/a |
| A load's compare-and-swap loop | no attempt cap and no deadline; the existing backoff (`casBackoffMs`); retries ref conflicts alone, and checks the signal before each attempt | a mutation's retry window: 30 s |
| A load's run | no request deadline (a job, or a step of a run); each piece under the runner's limits, as a split task's | n/a |
| A load job's progress | throttled to 500 ms, as a split call's | n/a |
| How often a load job reads its own record for a cancel | every 1 s, where it already checks its signal, as a split call's job and a kept call's run do | n/a |
| gc and a delivery not yet in a job | held gc's age gate, a minute, and the window beside running work | the same |

## 9. Tests

Every requirement of §5 has a test in the spec it names, its title beginning
with the requirement's number. Every example of §4 is replayed by a test, as
9.1 says and 9.2 lists. Every backend runs the shared suites. Locally each
task runs the specs its change reaches; CI runs the rest.

### 9.1 How a test replays an example

**`GatedTaskRunner`** (`e3-core/src/execution/GatedTaskRunner.ts`, new,
exported beside `MockTaskRunner`) is a `TaskRunner` that wraps another and
holds each execution of a task the test names until the test lets it go: a
task's `execute`, and each unit's `executeUnit`, a load's pieces among them.
It knows a task by the name the run hands its runner
(`TaskExecuteOptions.taskName`, `execution/interfaces.ts:34`), so a catch-up
run is held as its task's. Every other member of `TaskRunner` — whether an
execution can still finish, a detached run, an intake and the largest
delivery it takes whole, the first wave — goes straight to the wrapped
runner. It is exported from `@elaraai/e3-core/test` with the contract
suites, which use it, so every backend that runs the loop's suite replays
the same interleavings over its own stores (§11.1).

- `await launched(task)` answers once an execution of the task is held, with
  the inputs it was launched on.
- `release(task)` lets the oldest held execution of the task run on, through
  the wrapped runner. `fail(task, message)` fails it.
- A task the test names nothing for runs straight through.

The wrapped runner is a `MockTaskRunner` for a task whose work the test stands
in for: a released task's output is then a String naming the task and the
inputs it ran on, so the workspace's value says which run made it. A load's
pieces run their real program on the local runner, released one at a time, so
their `[PART]` lines come as an example shows them.

**A test of an example is a list of steps.** Each step does one thing, then
waits until the run has settled — every execution it launched is held, or
nothing is due:

- commits an edit (`recordMutate`), and wakes the run or leaves it;
- releases, or fails, a held execution;
- starts a deploy, or a load job.

It then asserts:

- what launched, and on which commits (`launched`);
- what the workspace holds;
- the lines the step printed: in order, but for the lines of one pass of the
  run's loop, which it compares as a set (§4).

e3-core's specs assert the run's callbacks, which are the CLI's lines one for
one. e3-cli's `start.spec.ts` and `load.spec.ts` replay the same steps through
the command's own callbacks (§7.13), and assert the lines printed. Nothing
waits on a clock: a printed duration is the runner's, and is checked for its
form (§4).

### 9.2 The examples, and the tests that replay them

| Example | Replayed in | Requirements |
|---|---|---|
| §4.1 Declaring | `e3/src/record-composite.spec.ts` | R1 |
| §4.2 Reading and writing | `e3-core/src/records.spec.ts` | R4 |
| §4.3 Loading a delivery | `e3-core/src/record-load.spec.ts`, `e3-cli/src/commands/load.spec.ts`, `e3-cli/src/commands/history.spec.ts` | R6, R10, R11, R14, R33 |
| §4.4 Loading a task's output | `e3-core/src/dataflow-loads.spec.ts`, `e3-cli/src/commands/start.spec.ts`, `e3-cli/src/commands/load.spec.ts` | R10, R20, R44, R51, R52 |
| §4.5 A view over it | `e3-ui/test/sheet/sheet-record.spec.ts`, `e3-ui-components/test/sheet-record-rows.spec.ts`, `e3-ui-components/test/record-apply.spec.ts` | R74–R76 |
| §4.6 While people edit | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts` | R16, R34, R38, R39, R42 |
| §4.7 A change, one step at a time | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts` | R35–R37, R47, R49 |
| §4.8 An edit handed to the run | `e3-core/src/dataflow-follow.spec.ts`, `e3-api-tests/src/suites/dataflow.ts`, `e3-cli/src/commands/start.spec.ts` | R47, R48, R50 |
| §4.9 What a task reads | `e3-core/src/dataflow-follow.spec.ts` | R38, R42 |
| §4.10 When a task waits for its inputs to agree | `e3-core/src/dataflow-follow.spec.ts`, `e3-cli/src/commands/start.spec.ts` | R43–R45 |
| §4.11 A load's commit, worked | `e3-core/src/record-load-commit.spec.ts`, `e3-core/src/record-load.spec.ts`, `e3-core/src/dataflow-loads.spec.ts`, `e3-cli/src/commands/load.spec.ts` | R16–R18 |
| §4.12 The slots, step by step | `e3-core/src/record-composite.spec.ts`, `e3-core/src/record-deploy.spec.ts` | R12, R24, R27–R30 |
| §4.13 A deploy, while people work | `e3-core/src/dataflow-follow.spec.ts`, `e3-core/src/record-load.spec.ts`, `e3-core/src/deploy-lock.spec.ts`, `e3-cli/src/commands/start.spec.ts`, `e3-cli/src/commands/load.spec.ts` | R19, R36, R61–R64, R66 |
| §4.14 Two loads of one record | `e3-core/src/dataflow-loads.spec.ts` | R55 |
| §7.8's wake timeline | `e3-core/src/dataflow-follow.spec.ts` | R47 |

### 9.3 The other tests

Beside the replays, each package's specs cover the cases below, each titled
with the requirement it checks where it checks one.

- **e3**:
  - the declaration's refusals, a fed source's among them: a function whose
    delivery is not the feed's type, a source fed by its own record, a task
    named as a load node, a cycle through a load;
  - the built type and the types argument;
  - per-source `initial`;
  - export of the record object, its load objects and their task objects, a
    fed source's `feed`, and the record's `deps`;
  - the load and merge programs over pieces: full export, change export,
    `replace` confined to the piece, a key outside the piece or the source
    emitted as a `$conflict` entry naming it, summary totals summed across
    pieces, a shared key of another arm failing the merge.
- **e3-core**:
  - the planner cutting through a case, co-partitioned with a `K`-keyed input,
    as the primary and as the other input, refusing an entry of another case;
  - `applyDelta`'s `cases` refusal;
  - the commit (§7.6): over seeded random interleavings of mutations and other
    sources' loads (fixed seeds), the replayed result equal, target by target,
    to a straight apply of every commit in order, exactly; the run check
    committing over a system commit that left the entries, and restarting over
    one that changed them; a `$conflict` delta refused before any attempt; an
    apply error and a storage error thrown, not retried; a ref conflict
    retried; the signal stopping it before a write; a `$load:` of the same
    source forcing the run check; the slots and args it writes, as-of the
    later of two, and `.feed` for a fed source;
  - a load job end to end over the in-memory and local backends: pieces with
    `E3_TEST_PIECE_BYTES` small, resume after a stop, a repeat answered, a
    repeat after another commit, a repeat after a rollback applying again, a
    changed function applying again, two loads of one source in order, two
    sources side by side, a mutation committing mid-load, a system commit
    mid-load, a deploy stopping and restarting a load (from another
    `StorageBackend` client, for the cross-process path), pending until each
    source delivered (dependents waiting, then running);
  - as-of: an older delivery superseded with no commit, an equal one with other
    bytes loaded, one without an as-of leaving the slot, the same delivery
    answered `again` whatever its as-of;
  - the waits past 30 s: a load queued behind a load longer than 30 s, and one
    waiting out an intent held longer than 30 s, each going on;
  - gc: held gc refused while a load job is queued; gc beside running work
    keeping a queued delivery past its window through the touches; a job made
    for a delivery gone, failing with its words; a record object reaching its
    load objects, a load object its task object, and a struct of the load
    object's shape with another tag a leaf;
  - rollback and restore: a rollback past a load dropping its slots, past a
    first delivery reopening `$pending`, past a later one leaving it; a restore
    dropping every source's slots and reopening those with no entries; genesis
    by a system commit;
  - deploy: mint, reset, keep and migrate writing `$pending` and `$external`;
    a source added without a type change joining `$pending`; a source changed
    each way between `load` and `mutations`; a removed source's slots dropped;
    a migration dropping the delivery slots and keeping the as-of;
  - refusals for edit, reduce and patch, on the program path and the fast
    path;
  - the history args and describe's sources;
  - the deploy intent: `acquireForDeploy` announcing, waiting, refusing after
    30 s, releasing the workspace before the intent, and its handle's
    `report`; each shared taker refused while a deploy has announced itself;
    `--plan` taking the lock shared and stopping no run;
  - feed inputs at a deploy: `retained` under `reset`, `keep` under
    `keep-edited`, a changed type `reset` with the load named, and an input
    holding its package's value leaving the load waiting;
  - the graph: load nodes, a load node depending on its feed's task, no node
    depending on a load node, the record left a root input, `loadsOf`, a name
    clash and a cycle refused;
  - the upgrade step: a run stored before it rewritten with `load: none`, one
    already in the new form and one in neither form left as they are, in
    parts;
  - every result lands, each over a gated runner whose tasks finish when the
    test lets them, so "while it runs" is exact: a task whose input moves
    while it runs landing its result, its output written, and running once
    more, not once per edit; its dependents keeping their results while it
    runs again, and due once its next result lands; a change reaching a task
    two steps down only through the result between; a run ending once nothing
    is due;
  - a task's commits: a task reading a record and a result from an older
    commit reading the record there, from its history; a task reading two
    results from different commits reading the newer one's task at the older
    commit from the cache; a catch-up run where the cache has none (the
    workspace's output untouched, the cache filled, `onCatchUp` heard); a run
    in flight over the same inputs waited for, not run twice; a failed
    catch-up failing the task; carried versions: a task reading `orders` and
    `erpOrders` reading `erpOrders` as of the `.feed` slot, and as of the
    feed's vector when its hash is the delivery; a forgotten delivery
    deferring it until the reload; two fed records carrying different
    versions deferring; a plain input read at two values deferring; commit
    order across a resume, and past a compaction cut;
  - the wake: `wake` making a run look at once, an idle task starting on the
    new commit before anything in flight lands; `wake` answering false with
    no run, a filtered run, or a stopping one;
  - a fed load in `LocalOrchestrator`: after its task; its readers running on
    the record as it stands while it runs, and again after its commit;
    answered from the slots when nothing changed; waiting on a feed with no
    value, on a pending record feed, and on an input holding its package's
    value, its readers with it, before and after a first delivery, each with
    its reason; its feed changing mid-load and mid-commit (the commit stands,
    and it runs again); a failed load launching nothing more and skipping no
    reader; a mutation committing mid-load; a system commit mid-load;
    `--force` and `--filter`; reactive, an input change running the feed's
    task, then the load, then the readers again; a rollback mid-run making it
    due; two load nodes of one record;
  - the commit outside the mutex: another task completing, and another cache
    hit applied, while a load node commits; a yield waiting for a commit in
    flight; a cancel stopping one before its write;
  - `keepOf` naming a load node's execution by its slot;
  - a deploy cancelling a run in flight, loading or not, from another
    `StorageBackend` client: its landed results kept, and the next run served
    from the cached pieces.
- **e3-api-tests**:
  - the load routes (launch, poll, failures, a repeat, a superseded delivery,
    a fed source refused);
  - the object upload routes (dedup, parts, commit);
  - describe's sources;
  - a dataflow with a fed source over the routes: the graph's load node, its
    commit, its readers after it;
  - the run start handed to a run in flight (`handed`, with its cursor), and a
    filtered or forced start refused while one is;
  - a deploy over the routes stopping a load job, and a run in flight.
- **e3-cli**:
  - `e3 load` locally (each delivery form) and against a server, with and
    without `--as-of`, its superseded and repeat words, and its refusal of a
    fed source;
  - a run's lines for a load node and for a catch-up run, and each waiting
    reason's words; a remote start answered `handed` followed from its
    cursor;
  - `retained` plan lines from `e3 workspace deploy` and `e3 watch`;
  - history words;
  - `get -f beast2` equal to the stored splice and taken in again by a load in
    another workspace;
  - `seed` refusing a composite.
- **e3-web**: the two job stores and their sweep.
- **e3-ui**:
  - binding sources in the IR, the handle and `UiAccess`;
  - `Record.onApply` rejecting an external change before a commit, keyed and
    for one entry;
  - `newRowKey`: a row added to a Sheet over a composite applies to the
    solution source;
  - the Sheet's locked rows: no edit, delete, paste or fill, and the attribute
    set (DOM-measured);
  - the examples beside the specs (`docs/conventions/EXAMPLES_AUTHORING.md`).
- **e3-ui-cli**: the records view showing sources, and the dashboard showing a
  load node, against the fake API.

## 10. Out of scope, and follow-ups

The issue puts these out of scope: change data capture or streaming, parsing
CSV or JSON, ownership of fields within an entry, and querying a source where
it lives.

Two follow-ups of the third revision are now part of the work, by the review
of 13 November: every builder draws an external entry locked and refuses the
gesture (the fifth pull request, §7.15), and a caller stops its own load job
(the third, §7.5).

Follow-ups, to file once this lands:

- **An added or removed source as a built-in deploy step** (F11). Today it is a
  type change: a declared migration (`migration.rekey`), or a reset. e3 builds
  the type, so it can build that step itself.
- **A run's load counts in its lines and events.** They are in the record's
  history. Carrying them in the run adds an event, a new stored form of every
  run's events.
- **Waiting, deferral and stop reasons over the API.** A remote run says how
  many tasks wait, not why; it shows no `[DEFER]` line; and a run a deploy
  stopped ends `aborted` with no reason, though its stored
  `execution_cancelled` event holds one. The reasons reach a local run's
  caller alone (§7.8, §7.9). Serving them adds API events, and, for the
  waiting and deferral reasons, a stored form of the run's state or events.
- **`e3 watch` deploying a save while its run is in flight.** A save during a
  run waits for the run to end (`watch.ts:277–288`), which a run people keep
  editing under never does. A deploy now stops a run (ruling 13), so the
  watch could deploy each save at once.
- **Catch-up runs in the run's events.** A local run's caller hears them
  (`onCatchUp`); a remote one sees the task that waits on them start later.
  Carrying them adds an event, a new stored form of every run's events.
- **Waking a run in another process.** A start reaches a run only in its own
  process: a local `e3 dataflow run` beside a server's run is refused as
  today, and an edit made through `e3 mutate` reaches a run at its next
  completion. Waking across processes needs a signal every backend carries.

## 11. Development tasks

**Five pull requests, stacked** (ruling 18; the cut after the first is the
reviewer's call 8). The third revision had one. Each is a draft stacked on
the one before, and its description carries the checklist of what it lands,
its tasks by the letters below, each ticked with its commit once the checks
covering the change pass. A task is done when its **Done when** holds: the
requirements it names pass (§5), and the examples it names are replayed
(§9.2). Locally each task gates on the build, lint and type-check of the
packages it touches and the specs its change reaches; the whole matrix is
the pull request's CI.

**The order** (the product owner's, 17 November 2026). The first four start
now, in parallel with the Plan's pull requests. The first is based on
`elaraai/feat/index-readers`, the last of the functions' pull requests that
touches e3, or on main once that has merged, and is rebuilt on its base's new
tip whenever that moves. The fifth waits for the finished Plan.

1. **Runs follow people's edits, and a deploy stops a run.** For every
   workspace, composite or not: every result lands, a start is handed to the
   run in flight, and a deploy announces itself and stops a run (rulings 12
   to 14). Tasks C7, C12, C13, C15 and C18, the start's answer (A2's
   `DataflowStartResultType`, and its part of D2 to D4), the run's lines in
   F4, and the `GatedTaskRunner` the examples replay on (§9.1), with the
   deploy check as a read (§7.9). C7's requirement of a load job (R62) is met
   in the third. It changes how every run behaves, so it lands and is
   released by itself. No stored form changes in it (F36).
2. **Declaring a composite, and what waits.** The types and the SDK, the
   refusal of an external write, the planner's step, the slots at a deploy,
   and the waits before a first delivery: A1, A2, B1 to B4, C1, C2, C5, C9,
   C10, C20 and the `$pending` wait of C16. After it a composite deploys, is
   read, is edited through its own sources, and makes its readers and its
   functions wait. Nothing loads yet.
3. **`e3 load`.** The job, its commit, rollback and restore, the stores, the
   routes, the client, the CLI and e3-web: A3, C3, C4, C6, D1 to D4, E1 and
   F1 to F3.
4. **Fed sources.** The dataflow's load node: A4 with its repository upgrade
   step, A5, B5, C8, C11, C14, the rest of C16, C17, C19 and F5, a load
   node's lines in F4, and the graph's `load` and the plan's `retained` in D2
   to D4.
5. **The builders over a composite.** G1, G2, G3, G5, and the Plan's tasks L1
   to L3 and M3, as small pull requests. G4 goes. Not yet audited (§7.15).

Docs and skills (H1 to H4) land with the pull request that makes each thing
usable, and each adds its entries to `docs/conventions/WIRE_MIGRATION.md`
and regenerates the plugin index. Each limit ruling 17 approves comes in with
the pull request that builds it (§8).

### 11.1 What another backend implements, by pull request

e3 runs over the local backend, e3 in a page and a hosted backend
(`docs/conventions/E3_BACKEND_SEAMS.md`). Every mechanism here goes through
an interface a backend implements, the logic and its tests shared. A
backend's stores run the contract suites of `@elaraai/e3-core/test`, and
its server the suites of e3-api-tests. Each pull request's description says
this for what it lands, and adds it to the seams convention.

| Pull request | Mechanism | Shared, with nothing for a backend to write | What a backend implements | Pinned by |
|---|---|---|---|---|
| 1 | Every result lands; a task's commits; catch-up runs | The loop and its steps (`dataflow/orchestrator/LocalOrchestrator.ts`, `dataflow/steps.ts`), which every backend runs over its own stores; a run resumed in another process decides again, from the stored state and the execution cache (F36) | Nothing new. A host that runs its own loop in place of the shared class takes the same steps | `dataflowTests` (`contract/dataflow.ts`), on `GatedTaskRunner`: the examples' interleavings, and a run yielded and resumed in a second orchestrator |
| 1 | A start handed to the run in flight | The route's answer (`DataflowStartResult`), and what a woken loop does | `DataflowOrchestrator.wake`, for a run another process or instance holds, as it reaches one to cancel. Where it answers false the start is refused as today | `dataflowTests` for the shared class's wake; the `dataflow` suite of e3-api-tests for the route, which accepts `handed` or today's refusal where a server says its runs are held elsewhere |
| 1 | A deploy stops a run | `deploy-lock.ts` over `LockService`: the intent `<ws>#deploy`, its probe by a state read, `acquireForDeploy`, `acquireWorkspaceShared`; the loop's probe once a second | No new method: the lock service takes the lock name `<ws>#deploy`. A host that hands a deploy its own lock (`ProcessDeployDeps.lock`) takes it through `acquireForDeploy` | The lock service's contract suite, with the intent's name; `dataflowTests` (a run stopped by an intent, its reason recorded); the `workspaces` and `dataflow` suites of e3-api-tests |
| 2 | Declaring, the refusal of an external write, the waits before a first delivery | The SDK, e3-types, `record-apply.ts`, the planner, the slots at a deploy, a call's and a task's wait | Nothing: the forms are package-borne, and the slots are entries of a ref's version vector, which every store keeps whole | The record contract suites; the `records`, `calls` and `functionDrafts` suites of e3-api-tests |
| 3 | The load job | `recordLoad`, `recordLoadCommit`, `handleProcessRecordLoad`, the routes and the client | `TransferBackend.recordLoad` (create, get, an `updateStatus` that keeps an end in one atomic step, delete, execute) and where its jobs run; the lock name `<ws>#load~<record>~<source>`; its own capacity for a load's pieces | A contract suite for the store, new, beside the split call store's; `records-load.ts` of e3-api-tests |
| 3 | An upload that writes no ref | The protocol and its routes | `TransferBackend.objectUpload`: staging, and a commit that stores an object and writes no ref | A contract suite for the store, new; `object-upload.ts` of e3-api-tests |
| 3 | Who may load | The routes ask before they file a job | The host's rule, through the seam the routes are given; none allows what its mutate route allows | `records-load.ts`, as an admin and as a reader |
| 4 | Fed sources | Load nodes in the shared graph, steps and loop; the commit outside the run's mutex; ruling 15 | Nothing new for a backend that runs the shared loop. The stored run state's graph gains `load` through the shared upgrade step, which reads and rewrites each run through the backend's `runStates(repo).readStored` | `dataflowTests`; `repositoryRecordTests` for the upgrade step; the `dataflow` suite of e3-api-tests |
| 5 | The builders | — | Nothing: the builders are the page's | Not yet audited (§7.15) |

A backend's capacity is its own: where a load's pieces run, and how many at
once, is the host's, as a split call's is. The hosted backend's side is its
companion issue (§7.16).

### 11.2 Questions before building

Asked of the product owner, each before the pull request that builds it. The
answer is written into the issue before any code that depends on it.

1. **Where the cases a mutation may write are kept** (F41, §7.4; the second
   pull request). A draft's laying is handed the record's state and the
   mutation's object, and no record object. *Recommended:* the mutation
   object carries the cases it may write, so a Save, the patch door and a
   draft refuse through one check, and no stored form of a kept call
   changes. The other way adds the cases to what a kept call stores of each
   drafted record, with a repository upgrade step.
2. **The reviewer's call 2** (§7.7; the second pull request): a source
   changed from `mutations` to `load` while it holds rows counts as
   delivered. *Recommended:* as the review has it; the rows are there, and
   making their readers wait for a delivery of them is what ruling 16 ruled
   out for a migration.
3. **The reviewer's call 1** (§7.8, "Fail"; the fourth pull request): a run
   whose load failed and then loaded its feed's next output ends completed.
   *Recommended:* as the review has it; the failure is told as it happens
   and stays in the run's events, and a run that ended failed over a record
   that is loaded would send people looking for a fault that is gone.

4. **Ctrl-C of a remote `e3 load`** (§7.13; the third pull request). The
   review gives a load job a cancel, and does not say what the command does
   with it. *Recommended:* Ctrl-C cancels the job it follows, as Ctrl-C of a
   remote `e3 dataflow run` cancels the run it started and as a local load's
   stops the load; a cancel that came too late prints the load's own answer.

The third revision asked for a third-party review of this design before
anything is built, and none has been given on the pull request. Whether the
first pull request waits for one is the product owner's to say.

### 11.3 The tasks

**A. Wires and types (e3-types)**
- [ ] A1. *(PR 2)* `RecordObjectType.sources`; `RecordLoadObjectType`, tagged
  `$recordLoad`, with `feed`; decoders saying "re-export";
  `RecordLoadArgsType` (as-of, `first`, execution); `$load:` name helpers;
  `MutationObjectType.cases`, should question 1 be answered so (§11.2).
  **Done when** each type round-trips through beast2, a record object written
  before `sources` is refused with "re-export", and the helpers name a load
  commit and read its source back.
- [ ] A2. *(PR 2; the start's answer in 1)* `RecordSignatureType.sources`, with `feed` and the last delivery's
  as-of; `RecordLoadRequest/Status/Progress/Result` types, the request's
  `asOf`, the status's `cancelled`, the progress's `pieces.cached` and
  `restarted`, and the result's `outcome`; `PackageJobResponseType` reused;
  `DataflowStartResultType`.
  **Done when** each type round-trips through beast2.
- [ ] A3. *(PR 3)* `RecordLoadJobType`, `ObjectUploadJobType` (e3-core `transfer/types.ts`).
  **Done when** both round-trip through beast2.
- [ ] A4. *(PR 4)* `DataflowGraphTaskType.load`, and the repository upgrade step
  `dataflow-graph-loads`: frozen forms, spec, registered in
  `REPOSITORY_UPGRADES`.
  **Done when** R60 passes.
- [ ] A5. *(PR 4)* `InputPlanType.action.retained`, sorted last, with its TypeDoc.
  **Done when** `retained` round-trips and sorts after `reset`.

**B. SDK (e3)**
- [ ] B1. *(PR 2)* The `source` builder and `e3.recordComposite`; the built type;
  `RecordDef.sources`; `CompositeRecordDef`; refusals.
  **Done when** R1 and R2 pass, replaying §4.1.
- [ ] B2. *(PR 2)* The types argument handed to `indexes` / `mutations` / `migrations`
  (`e3.record` too); per-source `initial`.
  **Done when** R1 and R2 pass for the types argument and `initial`, and
  `e3.record`'s specs pass with the argument.
- [ ] B3. *(PR 2)* `buildLoadProgram` and `buildLoadMergeProgram` (`record-programs.ts`):
  a key outside the piece or the source as a `$conflict` entry, summary totals
  summed, any other shared key failing the merge; the merge program named by
  every keyed load's task object (F43).
  **Done when** R7 and R8 pass, with summary totals summed across pieces and
  a shared key of another arm failing the merge.
- [ ] B4. *(PR 2)* Export: each load's task object and load object, and `sources` in
  the record object (`export.ts`, `package.ts`).
  **Done when** `e3/src/export.spec.ts` finds, for a package with a
  composite, its record object's `sources`, each load object and its task
  object, a fed source's `feed`, and the record's `deps`.
- [ ] B5. *(PR 4)* Fed sources: a task, an input or a record as a load's delivery; the
  record's `deps`; `e3.package` refusing a task named as a load node, and a
  cycle through a load; the delivery contract in `source.load`'s TypeDoc.
  **Done when** R3 passes.

**C. e3-core**
- [ ] C1. *(PR 2)* The planner's case step (`execution/pieces.ts` `cutOf`).
  **Done when** `e3-core/src/execution/pieces.spec.ts` cuts a delivery keyed
  `K` and a source's run keyed `Variant{…}` at the same keys, as the primary
  and as the other input, refuses an entry of another case, and decodes no
  segment to find a boundary of a lone case step (R88).
- [ ] C2. *(PR 2)* `applyDelta` / `applyDeltaEntries` `cases`, `ExternalEntryError`;
  `writeDelta` / `patchDelta` refusing as `invalid`; `resolveRecord` sources;
  the refusal as the op is taken (F42); a draft's laying refusing the same
  way and ending its call `invalid` (F41); the whole-state write refused for
  a record with sources.
  **Done when** R4 passes on the program path and the fast path, replaying
  §4.2, and R84 passes for a kept call and one no store keeps.
- [ ] C3. *(PR 3)* `recordLoadCommit` (`record-load.ts`): the `$conflict` refusal, the
  replay, the run check, ref conflicts alone retried, the signal, the slots
  and args, the args a tuple of one value.
  **Done when** R7, R9, R12, R16–R18, R28, R29 and R92 pass, replaying
  §4.11's attempts and checks.
- [ ] C4. *(PR 3)* `recordLoad` and `recordSourceRun`: running work and the delivery
  re-referenced, the queue and intent waits in loops, the repeat and
  superseded answers, intake, the stored run, pieces on any runtime, the
  restart, its progress; its look at its own record for a cancel.
  **Done when** R6, R9–R15, R17, R19, R20, R22, R23, R62, R63, R69, R85, R87
  and R91 pass, replaying §4.3 and §4.13's load job.
- [ ] C5. *(PR 2)* Slots at a deploy (`commitDeployRecords`, `RecordDeployment`):
  `$pending` and `$external` at mint, reset, keep and migrate; a migration's
  delivery slots; a reset's slots named; compaction emptying `.commit`; a
  source that holds rows in the state the deploy commits not waiting (ruling
  16), a source changed from `mutations` to `load` among them should
  question 2 be answered so; a composite reset, never unassigned (F46).
  **Done when** R24–R26, R32, R78 and R79 pass.
- [ ] C6. *(PR 3)* Rollback and restore forgetting the deliveries they undo
  (`systemCommitState`, `recordSystemCommit`); a restore's and a genesis's
  `$pending`; a source leaving `$pending` when a rollback's state holds its
  rows.
  **Done when** R30, R31 and R80 pass, replaying §4.12.
- [ ] C7. *(PR 1)* The deploy intent (`deploy-lock.ts`, exported from the
  portable entry): `deployAnnounced` by a read of the intent's state,
  `acquireForDeploy` in `workspaceDeployWith`, the lock's TypeDocs, `--plan`
  shared; `acquireWorkspaceShared` at every shared taker; `WorkspaceLockError`
  naming a deploy.
  **Done when** R62 and R64–R67 pass, with §4.13's refusal words.
- [ ] C8. *(PR 4)* Feed inputs at a deploy: `planInputDeployments`'s `feeds` and
  `retained`, `refsKeepingInputs`, the reset reason.
  **Done when** R68 passes.
- [ ] C9. *(PR 2)* History args, `recordDescribe` sources (feed, as-of), seed refusal.
  **Done when** R5 and R33 pass.
- [ ] C10. *(PR 2)* gc: the record object's load objects; the load object's kind.
  **Done when** R69 and R70 pass.
- [ ] C11. *(PR 4)* The graph: load nodes, `loadsOf` for waiting, a load node's
  `dependsOn` on its feed's task, no node depending on one, `taskOutputPaths`
  without them, a clash and a cycle refused.
  **Done when** R58 passes.
- [ ] C12. *(PR 1)* Every result lands: `stepTaskResultStale` removed, results recorded
  with their launch vectors, `stepTasksDue` by direct inputs, results kept
  while a task runs again, readiness on results, a task starting in the pass
  that made it ready (F35), the run's end; `GatedTaskRunner`.
  **Done when** R34–R37 pass, replaying §4.6's one-reader timeline and §4.7
  on the gated runner, in the loop's contract suite, a run yielded and
  resumed in a second orchestrator among its cases (F36).
- [ ] C13. *(PR 1)* A task's commits: `stepTaskCommits`, `dataflowResolveInputs`
  reading a record at a commit from its history, `recordCommitOrder`,
  catch-up runs (`behind`, their tracking, the prepare again, failure,
  `onCatchUp`), a plain input deferred; `DeferReason`, the `onTaskDeferred`
  cutover, a deferral told once; an index input read at its record's commit
  (F40); reserved slots left out of every comparison of two vectors (F44).
  **Done when** R38–R46 pass, replaying §4.6's two-reader timeline, §4.9 and
  §4.10.
- [ ] C14. *(PR 4)* What a record's version carries: `$load.<source>.feed` written by a
  fed load's commit and dropped with its delivery slots, the feed's vector
  when its hash is the delivery, `$unknown` after a forgotten delivery; a
  workspace's bundle naming a load node's current execution by its slot
  (F45).
  **Done when** R29, R42, R44 and R45 pass, the `.feed` slot printed and read
  through East, and a workspace made from a bundle answers its fed loads
  `[CACHED]`.
- [ ] C15. *(PR 1)* `wake`: `DataflowOrchestrator.wake`, and `LocalOrchestrator`'s runs
  by workspace with the wake in their race.
  **Done when** R47–R49 pass, replaying §4.7's wake at 10:01:30 and §7.8's
  wake timeline.
- [ ] C16. *(PR 4; its `$pending` wait in 2)* `stepPrepareLoad` (wait, answer, prepare) and the waiting reasons:
  `InputWait`, `stepTasksWaiting` and `waitsOnDependency` through `loadsOf`,
  `$pending` read before an index is looked for (F39), the `onTaskWaiting`
  cutover.
  **Done when** R10, R27, R28, R51 and R52 pass, replaying §4.4's waiting
  listing.
- [ ] C17. *(PR 4)* The commit outside the mutex in `LocalOrchestrator`:
  `completeLoad`, `launchLoadCommit`, `loadCommits`, a yield waiting for
  commits in flight, force, and a failure that leaves the run going and runs
  again when its feed moves (ruling 15).
  **Done when** R17, R51 and R53–R57 pass, replaying §4.4's runs, §4.11's
  restart lines and §4.14.
- [ ] C18. *(PR 1)* A deploy stops any run: every run's intent probe, its landed
  results kept; the reason in `execution_cancelled` and
  `DataflowAbortedError.reason`; `buildPartialResults` counting results.
  **Done when** R61 passes, replaying §4.13's stopped run and the one after
  it.
- [ ] C19. *(PR 4)* `keepOf` naming a load node's execution by its slot.
  **Done when** R59 passes.
- [ ] C20. *(PR 2)* A call and an index input while a record waits for its
  first delivery: `pinCallArguments` reading each input's ref with its
  versions and ending the call `invalid`; a dataset argument read as it
  stands; a task whose input is an index of such a record waiting.
  **Done when** R81–R83 pass.

**D. Transfer, server, client**
- [ ] D1. *(PR 3)* `RecordLoadStore` and `ObjectUploadStore` in the interfaces and
  `InMemoryTransferBackend`; `handleProcessRecordLoad`; the object upload's
  processing; the load store's end, kept in one atomic step, and a contract
  suite for each store that every backend runs.
  **Done when** R14, R21 and R85 pass on the in-memory backend.
- [ ] D2. *(PR 3; the start's answer and the deploy route's lock in 1, the graph's `load` in 4)* e3-api-server routes and handlers, the cancel route among them; the
  host's rule on who may load, through its seam (R86); the actor; a fed source
  refused; the graph's `load` in the dataflow answers; the run start handing
  over through `wake`, and its `DataflowStartResult`; the deploy route's lock
  through `acquireForDeploy`.
  **Done when** R20, R21, R47, R48, R58, R85 and R86 pass over the routes.
- [ ] D3. *(PR 3; the start's answer in 1, the graph's `load` and the plan's `retained` in 4)* e3-api-client functions (the request's `asOf`, the result's
  `outcome`, the cancel), the graph's `load`, the plan's `retained`, the run
  start's answer.
  **Done when** R21 and R47 pass through the client, replaying §4.3's and
  §4.8's code.
- [ ] D4. *(PR 3; the start's handover and a deploy stopping a run in 1, a fed source's dataflow in 4)* e3-api-tests suites (`records-load.ts`, `object-upload.ts`, a fed
  source's dataflow, the start's handover, a deploy stopping a load job and a
  run).
  **Done when** the suites' cases of R20, R21, R47, R48, R58, R61 and R62 run
  on every backend that runs the suites.

**E. e3-web**
- [ ] E1. *(PR 3)* `WebTransferBackend` stores, record types, transfer kinds, sweep.
  **Done when** R72 passes.

**F. CLI**
- [ ] F1. *(PR 3)* `e3 load`, local and remote, `--as-of`, its answers' words and its
  progress lines, and its refusal of a fed source; its callbacks factored out
  for its spec.
  **Done when** R6, R11, R14, R17, R20, R21 and R62 pass, `load.spec.ts`
  replaying §4.3, §4.11's job and §4.13's job line for line.
- [ ] F2. *(PR 3)* `e3 history` words (with the as-of) and `--delta` for a load commit.
  **Done when** R33 passes, replaying §4.3's and §4.11's history lines.
- [ ] F3. *(PR 3)* `e3 dataset get -f beast2` streaming the stored segments, locally and
  remotely.
  **Done when** R71 passes.
- [ ] F4. *(PR 1; a load node's lines in 4)* A run's lines for a load node and a catch-up run; `describeWaits`
  and the summary lines (`start.ts`, `watch.ts`); `describeDeferral`; the stop
  words; a remote start answered `handed` followed from its cursor, and its
  Ctrl-C; the callbacks factored out of `startCommand` for its spec.
  **Done when** R27, R39, R43, R50, R52 and R61 pass, `start.spec.ts`
  replaying §4.4, §4.6, §4.7, §4.8, §4.10 and §4.13's listings line for line.
- [ ] F5. *(PR 4)* `retained` input plan lines (`inputPlanLine`, deploy and watch).
  **Done when** R68's plan lines pass, from `e3 workspace deploy` and
  `e3 watch`.

**G. UI** — not yet audited (§7.15). The Plan's tasks L1 to L3 and M3, in
the pull request's description, land with these.
- [ ] G1. *(PR 5)* `record_bind` sources, `RecordBindingType.sources`, `UiAccess` sources.
  **Done when** R73 passes.
- [ ] G2. *(PR 5)* `Record.onApply` rejecting external changes, keyed and for one entry;
  the entry form read-only over an external entry.
  **Done when** R74 passes, with §4.5's words.
- [ ] G3. *(PR 5)* The Sheet's locked rows: `SheetRowType.lock`, `keyLock`, the
  renderer's attribute and refusals, the recipe, the record form's wiring, the
  DOM invariant.
  **Done when** R75 passes, its DOM invariant among the responsive specs.
- G4. *Removed by the review:* `SheetRootType.newRowKey` is not added. A new
  row's key is the edit session's (L1, R89), and R76 is met there.
- [ ] G5. *(PR 5)* The terminal UI: the records view's sources, and the dashboard's
  load nodes.
  **Done when** R77 passes.

**H. Docs and skills**
- [ ] H1. *(PR each)* `libs/e3/SKILL.md` (composite records, fed sources in the dataflow,
  the delivery contract, `e3 load` and `--as-of`, what a rollback does, feed
  inputs at a deploy, the slots in words, and how a run follows edits: every
  result lands, a task's commits, catch-up runs, the wake, a deploy stopping a
  run); `libs/east-ui/packages/e3-ui/SKILL.md` (locked rows, new rows);
  `libs/e3/USAGE.md` / CLI docs.
  **Done when** the skills and docs say each behaviour §4 shows, with its
  commands and words.
- [ ] H2. *(PR each)* Examples beside the specs; the plugin index regenerated
  (`make -C libs/east-plugin index`).
  **Done when** the examples build and the regenerated index holds them.
- [ ] H3. *(PR the last e3 one)* File the follow-ups of §10; note the e3-cloud companion's scope.
  **Done when** each follow-up of §10 is an issue, and the companion issue
  names §7.16's scope.
- [ ] H4. *(PR each)* `docs/conventions/WIRE_MIGRATION.md`: a "Changes" entry for each
  wire §6 changes, with its kind; `docs/conventions/E3_BACKEND_SEAMS.md`:
  each seam of §11.1, in the pull request that adds it.
  **Done when** every row of §6's table and of §11.1's has its entry.
