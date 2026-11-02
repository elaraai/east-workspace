# Design: composite records — one record over several systems of record

> **Status:** design for review, revised 2 November 2026 after a review of
> the first draft (1 November), and again that day for runs while people keep
> editing (rulings 11–14). Nothing here is built yet.
> Issue: [elaraai/east-workspace#1465](https://github.com/elaraai/east-workspace/issues/1465).
> It builds on records declared whole, the branch this one is stacked on.

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
editing all day found F31–F34, which rulings 11–14 settle.

## 3. What exists, audited

The audit was made against the code on the stacked branch at `79a84cdc4`.
Its one later commit, `a85dae667`, touches only the Studio. The review of the
first draft read the same tree.

### 3.1 What the design builds on

- **A record's parts are built by builders, where the record is declared.**
  `record()` (`e3/src/record.ts:131`) builds each index, mutation and
  migration through `builderOf(…).build(rec, key)` (`:243`) and checks it
  there; the accepted keys are `CONFIG_KEYS` (`:196`). A source is one more
  part.
- **Every write of a Dict record is a delta.** The delta is `Dict<Variant{
  $conflict, primary, <index>… }, ops>`, generated by the SDK
  (`e3/src/record-programs.ts`: `deltaTargets`, `dictPatchOps`, `dictApply`,
  `indexesChanges`; the type is `mutationDeltaType`, `e3-types/src/record.ts:773`).
  e3-core applies it a segment at a time, reusing every run of segments it
  does not touch (`e3-core/src/record-apply.ts:139` `applyDelta`, `:269`
  `applyTarget`). An entry index's keys carry the record row's key, and a
  summary's op is `add` of totals (`RecordSummaryOpType`, `record.ts:719`): a
  key whose count reaches 0 goes, and an absent key is inserted.
- **A mutation stores its delta in its commit** (`delta: some(…)`,
  `records.ts:640–700`); a system commit stores none (`delta: none`,
  `records.ts:1880–1888`, and every deploy commit, `:1364–1450`).
- **Split execution.** Pieces are cut over the heaviest partitioned input, the
  other partitioned inputs at the same keys. Each piece's inputs are stored by
  reference, each piece's unit is cached, and a stopped run resumes from the
  pieces it finished (`e3-core/src/execution/pieces.ts:217` `planPieces`;
  `execution/engine.ts` `executeSplitTask`, its `$plan` stages). A task is
  split when one of its inputs is partitioned (`isSplitTask`, `engine.ts:112`).
  A Dict output's equal keys fold with a `merge` program.
- **A delivery is taken in by reference.** `deliveryAdoptStored`
  (`e3-core/src/dataset-adopt.ts:462`) takes a stored object in as a
  collection, in memoized pieces (`delivery-intake.ts`), under running work.
- **Jobs a caller polls.** These are the `TransferBackend` stores
  (`e3-core/src/transfer/interfaces.ts:289–295`). The split call is the nearest
  precedent: a task object over inputs given by hash (`path: []`,
  `splitCall.ts:299–307`), run through `runner.execute` under
  `withRunningWork`, its progress throttled (`transfer/process.ts:551`
  `handleProcessSplitCall`). The client polls 100 ms apart, backing off to a
  second (`e3-api-client/src/functions.ts`).
- **Reserved version-vector slots**, carried verbatim by every commit that does
  not own them (`e3-core/src/records.ts:730` `nextVersions`; the slots at
  `:98–120`). A writer drops a slot only by naming it, as `undefined`.
- **System commits**: `$init`, `$deploy`, `$reset`, `$reindex`, `$compact`, and
  a deploy's `$migrate:<name>` (`records.ts:1715–1718`, `:1819`
  `recordSystemCommit`). A rollback walks the chain from the head to its
  target, and is refused past a `$reset` or `$migrate:` commit
  (`systemCommitState`, `:1976`); a restore names a state. Both write the ref
  with `nextVersions(current.versions, …)` (`:1897`), carrying every slot.
- **The dataflow.** A run builds its graph from the package's tasks
  (`buildDependencyGraph`, `e3-core/src/dataflow.ts:236`; `dataflowGetGraph`,
  `:316`) and keeps it in its stored state (`DataflowExecutionStateType.graph`,
  `e3-types/src/dataflow.ts:504`). It holds the workspace's lock shared, and
  `<ws>#dataflow` exclusively, for its whole length
  (`dataflow/orchestrator/LocalOrchestrator.ts:470–496`). Each ready task is
  prepared (`stepPrepareTask`, `dataflow/steps.ts:675`), served from the
  execution cache or launched — as a split task when an input is partitioned
  (`launchSplit`, `LocalOrchestrator.ts:1642`) — and completed
  (`completeTask`, `:1442`, under the run's mutex), which writes its output to
  the workspace (`stepApplyTreeUpdate`, `steps.ts:1356`). A root input that
  changes mid-run invalidates the tasks that read it and every task that
  depends on them (`findAffectedTasks`, `dataflow.ts:397`): each completed one
  goes back to pending, and a task is ready only once every task it depends on
  is `completed`. A task in flight is not reset, but its result is checked at
  its end against the version vector it was given (`stepTaskResultStale`,
  `steps.ts:633`), and dropped when an input moved and the run has looked
  since. A run looks for changed inputs after each completion and cache hit
  (`handleInputChanges`, `:1407`), and `completeTask` checks before it looks.
  A stop request cancels the run (`cancel`, `LocalOrchestrator.ts:782`). Once a
  task fails, the run launches nothing more (`hasFailure`, `:911`). A start
  while a run holds `<ws>#dataflow` is refused `workspace_locked`
  (`startDataflow`, `e3-api-server/src/handlers/dataflow.ts:224`).
- **Version vectors.** A root input's vector is itself (`inputVersionVector`,
  `dataset-refs.ts:78`), set at the run's start (`steps.ts:134`) and when it
  changes (`:470`); a task's output gets the merge of its inputs' vectors
  (`stepTaskCompleted`, `:1075`); a task whose inputs' vectors disagree is
  deferred until they agree (`stepCheckVersionConsistency`, `:586`).
- **A view writes, then starts a run.** e3-ui's dataset store commits a write
  and then launches the dataflow (`writeAndStart`,
  `e3-ui-components/src/platform/dataset-store.ts:682`), as a record's handle
  does after a mutation (`record-runtime.ts:548`).
- **Locks.** `LockService.acquire` answers null for a holder, or waits up to a
  timeout, 30 s by default, polling about every 100 ms
  (`storage/interfaces.ts:991–1018`, `storage/local/LocalLockService.ts:488–540`).
  It has no writer preference: a shared taker wins whenever no exclusive holder
  is in place. Every shared taker of a workspace is refused at once while a
  deploy holds it (`trees.ts:412`, `records.ts:286`, `workspace-bundle.ts:159`,
  `workspaces.ts:358`, `LocalOrchestrator.ts:485`, `:567`).
- **Deploy inputs.** A deploy gives an input someone set the new package's
  value under the default policy, `reset` (`input-deploy.ts:204`;
  `workspaces.ts`: `options.inputs ?? 'reset'`), and `e3 watch` deploys under
  it on every save (`e3-cli/src/commands/watch.ts:172`).
- **gc.** Held gc sweeps unreachable objects older than a minute
  (`gc.ts:127`) and is refused while running work is held; gc beside running
  work deletes an object only once it has been unreachable, and untouched, for
  its retention window. A call naming an object by hash re-references it
  (`ObjectStore.touch`, `storage/interfaces.ts:180–210`).

### 3.2 Findings

The issue's plan holds, with these corrections and gaps. F1–F13 are the first
draft's; F14–F30 are the review's; F31–F34 are those of a review of the
revision for people editing all day.

- **F1 — Co-partitioning across key types.** `planPieces` cuts co-partitioned
  inputs at the same keys, and refuses inputs whose cut types differ
  (`pieces.ts:300–312`). A delivery is keyed by the source's key `K`, but the
  record is keyed by `Variant{…}`. The source's entries are a run of the
  record, not a collection of their own. So the review's "split execution cuts
  several inputs at the same keys" holds only once the planner can cut through
  a variant key's case. → §7.3
- **F2 — A mutation runs its program inside its compare-and-swap loop.**
  `recordMutate` calls `writeDelta` on every attempt (`records.ts:629–697`),
  under the workspace's shared lock for the whole call (`:272`). A load must
  run its pieces once, outside the race, and only apply inside it. → §7.5
- **F3 — Each lost race re-applies the whole delta.** `applyDelta` applies
  every op of the delta to the latest head on each attempt, reusing only that
  head's untouched segments. A large delivery would rewrite its segments again
  for every commit that lands first (the review's change 4). → §7.6
- **F4 — `$idem` is one slot, and every mutation rewrites it**
  (`records.ts:640–687`). Confirmed. Each source needs slots of its own. → §7.7
- **F5 — Nothing lets a deploy tell a holder to let go.** A deploy takes the
  workspace lock exclusively, and is refused at once while it is held
  (`workspaces.ts:798–804`). A load may hold it for hours, in another
  process. Ruling 2 needs a stop signal that crosses processes. → §7.9
- **F6 — The dataflow waits only on an unassigned ref**
  (`e3-core/src/dataflow.ts:580` `dataflowResolveInputHashes`). Ruling 1 needs
  a record that holds a state and that its dependents still wait on. → §7.7
- **F7 — `e3 dataset get -f beast2` re-encodes whole.** Locally it reads with
  `datasetRead` and writes `encodeBeast2For(type)(value)`
  (`e3-cli/src/commands/get.ts:69`, `:102`). Remotely, `datasetGet` holds and
  decodes the whole splice before the format is chosen. A value encoded whole
  is one run, which intake refuses past 64 MiB (`RUN_MAX_BYTES`,
  `east/src/serialization/beast2/v5/runs.ts:45`). The server already streams
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
  (`dataflow.ts:236`), and a record is a root input
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
  (`records.ts:1897`). After a rollback past a load the slots still name its
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
  `dependsOn` from `outputToTask` alone (`dataflow.ts:349–358`), and
  `stepTasksWaiting` maps each output to one producer (`steps.ts:819`), as
  `buildOutputVersions` does (`LocalOrchestrator.ts:2029`), while a record may
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

## 4. Authoring and use, by example

Command output below is illustrative.

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
  [PART] orders.erp 1/37 #0 [140ms]
  …
  [PART] orders.erp 37/37 #36 [212ms]
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
  [PART] orders.erp 1/37 #0 (cached) [2ms]
  …
  [DONE] forecast [930ms]
  [DONE] orders.erp [380ms]
  [START] forecast
  [START] reconcile                                     # deferred until the load: nothing said which erpOrders orders held
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
the other's result at that commit from the execution cache (§7.8). Here the
head moves every 15 seconds:

```
time   head  forecast (3 min)          capacity (1 min)           plan (1 min)
-----  ----  ------------------------  -------------------------  ---------------------------------------
10:00  c0    starts on c0              starts on c0
10:01  c4    |                         c0 lands; starts on c4
10:02  c8    |                         c4 lands; starts on c8
10:03  c12   c0 lands; starts on c12   c8 lands; starts on c12    starts on c0: capacity's c0 from the cache
10:04  c16   |                         c12 lands; starts on c16   c0 lands
10:05  c20   |                         c16 lands; starts on c20
10:06  c24   c12 lands; starts on c24  c20 lands; starts on c24   starts on c12: capacity's c12 from the cache
10:07  c28   |                         c24 lands; starts on c28   c12 lands
```

Had `capacity` never run on c12, `plan` would run it there once, a catch-up
run beside `capacity`'s own, and start a minute later. Neither input waits for
the other, and `plan` never computes on a mix.

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

## 5. Behaviour

| Situation | What happens |
|---|---|
| Deploy mints a composite | Genesis `$init`: the solution sources' `initial` entries, or none. `$pending` names every external source, fed or not, and `$external` names them all. |
| A later deploy keeps or migrates a composite | `$pending` is reconciled (§7.7): a source new to the external set joins it — one changed from `mutations` to `load` too — and one no longer external leaves it, its slots dropped. A migration also drops each external source's delivery slots, so a fed source loads again on the next run. |
| A task reads a record whose `$pending` is set | The task waits, as on an unset input, naming the sources yet to deliver. The run goes on without it. |
| A source's first delivery commits | Its name leaves `$pending`. Once `$pending` is empty the slot is dropped, and the dependents run: in the same run for a fed source; for a delivered one, in a run in flight once it next looks for changes, or in the next run. |
| A mutation edits, reduces or patches an entry of an external source | Refused as `invalid`, naming the key and the source. Nothing is written. |
| A load's patch names a key outside its source, or outside its piece's keys | The load fails, naming the key. Nothing is committed. |
| A load's function replaces (`replace`) | It replaces the piece's entries of its source, never the record. |
| A new delivery that changes nothing | It commits once, `0 set, 0 deleted`, so the history and the slots record it. |
| The same delivery again, under the same load declaration | Answered "already loaded" (`again`) by the commit that applied it, whatever committed since, unless a rollback or restore undid it. Nothing runs. In a run, the load is `[CACHED]`. |
| A delivery whose as-of is older than the source's | Answered `superseded`, naming the source's as-of. Nothing runs or commits. |
| A delivery whose as-of is the source's or later, or that has none | Loaded. The source's as-of becomes the later of the two; a delivery without one leaves it. |
| The same delivery after the load's function changed (a redeploy) | It applies again under the new function. |
| Two loads of one source | One at a time, in the order asked. The second waits for the first, however long it takes. A fed source has one load at a time, its workspace's one run. |
| Loads of two sources | Side by side, each committing its own run. |
| A mutation, or another source's load, commits while a load runs | It commits as it does today, and the record's readers run on it (ruling 11). The load's commit folds it in from its stored delta, and never applies its own delta again for it (§7.6). |
| A rollback, restore, migration or reset lands while a load runs | At its commit, the load reads the source's entries again. As they were, it commits over the new head; changed, it starts again, reusing every piece still valid. |
| A rollback or restore undoes a delivery | The source forgets it: its delivery slots are dropped, and it is pending again if its first delivery is undone. A fed source is loaded again by the next run; a delivered one, when it is sent again. |
| A run reaches a fed load whose feed changed | The load runs after the feed's task and commits once. Its commit is a change of the record: the readers run again after it, in the same run. Meanwhile they run on the record as it stands. |
| A fed load's feed has no value, or is an input holding its package's value | The load waits, saying why, and the record's readers wait with it, before the first delivery and after it. |
| A fed load's feed changes while it runs or commits | Its commit stands, as any result does, and the load runs again on the new output (ruling 12). |
| A fed load fails | The record keeps its last commit, and the run launches nothing more, as after any failed task. No task depends on the load, so none is skipped: its readers' results stand. |
| People edit a record while a task that reads it runs | Each edit commits at once. The task's result lands as it finishes, and it runs once more, on the newest commit, for every edit that arrived meanwhile (ruling 12). Its dependents keep their results, and run again once its next result lands. |
| A task reads results made from different commits of a record | It runs as of the oldest: the record from its history, and each other result from the execution cache, or its task run there once, never written to the workspace (§7.8). It never waits for its inputs to agree. |
| A view starts a run while one is in flight | The start is handed to the run, which looks for changed inputs at once, and answered `handed` (ruling 14). A filtered or forced start, or one while the run is stopping, is refused as today. |
| A task reads a fed record and its feed's upstream while the record's load runs | It reads the upstream as of the delivery the record holds, from its history, and runs again once the load commits (§4.6). |
| A rollback, restore or migration forgets a fed delivery | Until the next load commits, a task that reads the record and its feed's upstream is deferred, since nothing says which upstream the record holds. A task that reads the record alone runs on it. |
| Two inputs of a task read a plain input at different values | The task is deferred until they agree, as today: a plain input keeps no earlier value to read. |
| A deploy over an input that feeds a load | A value someone set is kept, whatever `--inputs` says, while its type is unchanged; the plan says it is retained, naming the load. A changed type resets it, and the load waits until it is set. |
| `e3 load` names a fed source | Refused, naming the feed and the run that loads it. |
| A task feeds a load and reads its record | The package is refused at build, naming the cycle. |
| A deploy starts while a load job runs | The load stops within about a second and lets the workspace go, then starts again once the deploy is done (§7.9). |
| A deploy starts while a run is in flight, loading or not | The run is cancelled within about a second, saying a deploy started (ruling 13). Every result it landed stands, and finished pieces stay cached. The first run after the deploy runs as of the deployed package, its loads from the pieces still valid (§7.9). |
| A workspace's removal or export while a run is in flight | Refused, naming the run, as today: stop the run first. |
| A mutation, set, export, copy or run start while a deploy has announced itself | Refused at once, naming the deploy, as it is while a deploy holds the workspace today. |
| `e3 workspace deploy --plan` | Plans under the workspace's lock taken shared: it announces nothing, and stops nothing. |
| The deploy removes the record or the source, or changes its key or delivery type | The stopped load fails, naming what changed. |
| A load is stopped (a deploy, Ctrl-C, a crash) | Asked again, it resumes: finished pieces are answered from the execution cache. |
| `$reset` (deploy with `--schema reset`) | The record goes back to genesis. Every `$load.` slot is dropped, and `$pending` names every external source again. |
| `$compact` cuts a load's commit from the chain | The slot's commit is emptied, as `$migrations` does. A retry of that delivery is answered "already loaded", with no commit. |
| gc while a load job is queued or stopped | Its delivery is kept: the job holds running work from its creation, and re-references the delivery at each turn of its waits. |
| A load job whose delivery gc swept before the job was made | It fails: "delivery <hash> is not in the repository: upload it again". |
| `e3 seed` of a composite | Refused, naming `e3 load` and the record's mutations. |
| A view's Apply names an external entry | Rejected before any commit, naming the entry and its source. |
| A Sheet over a composite | External rows draw locked, saying whose they are. A new row is the solution source's. |

## 6. Wires

Package-borne wires change by hard cutover (`docs/conventions/WIRE_MIGRATION.md`):
a package exported before this is re-exported. A stored form changes through
a repository upgrade step. A case added to an existing stored or API variant
is named to sort last, as `LockOperationType`'s `workspace_copy` and
`ApiExecutionStatusType`'s `stopping` were: `InputPlanType`'s `retained` sorts
after `reset`.

| Wire | Change | Kind |
|---|---|---|
| `RecordObjectType` (e3-types `record.ts:562`) | `+ sources: Dict<String, Variant{ load: String, mutations: Null }>`: each source by name, an external one naming its load object. A record object an earlier SDK exported does not decode: a read through it is refused, naming the fix, and gc, which knows a record object by its shape, no longer walks it, as for the index object's `form`. A deploy reads no record object of the deployed package: what it needs of the prior sources is in the ref's `$external` slot | package-borne; re-export |
| `RecordLoadObjectType` (new) | `{ kind: '$recordLoad', key: EastType, delivery: EastType, feed: Option<TreePath>, task: String }`: the source's key and delivery types, the dataset that feeds it, and the load's task object | package-borne; a new kind that names an object, so tagged, with a GC test |
| The load's task object | A `TaskObjectType`, as a split call's is built: inputs and output at `path: []` | package-borne; existing type |
| `DataflowGraphTaskType` (e3-types `dataflow.ts:113`) | `+ load: Option<{ record: String, source: String }>`, after `dependsOn`: `some` on a load node | stored state, each run's graph: a repository upgrade step, `dataflow-graph-loads`, writes `load: none` on every node of every stored run. And the API's graph and run answers: client and server ship together |
| `DataflowStartResultType` (new, e3-types `api.ts`) | `Variant{ handed: { since: Integer }, started: Null }`: the run start's answer, in place of `Null`. `started` began a run; `handed` gave the start to the run in flight, `since` its next event | API; client and server ship together |
| `RecordSignatureType` (e3-types `api.ts:1469`) | `+ sources: Array<{ name, key: EastType, external: Boolean, delivery: Option<EastType>, feed: Option<TreePath>, last: Option<{ delivery: String, commit: Option<String>, asOf: Option<DateTime> }>, pending: Boolean }>` | API; client and server ship together |
| `InputPlanType.action` (e3-types `api.ts:465`) | `+ retained: { load: String }`: an input someone set, kept whatever the policy because it feeds the load named | API; a case named to sort last |
| `RecordLoadRequestType` (new) | `{ delivery: String, actor: Option<String>, asOf: Option<DateTime> }`: a stored object's hash. A delivery never travels by value | API |
| `RecordLoadStatusType` (new) | `Variant{ completed: RecordLoadResult, failed: { message }, processing: Option<RecordLoadProgress> }` | API |
| `RecordLoadProgressType` (new) | `Variant{ commit, intake: IntakeFile, pieces: { done, total }, queued, stopped }`: `queued` behind an earlier load of the source, `stopped` while a deploy holds the workspace | API |
| `RecordLoadResultType` (new) | `{ commit: Option<String>, state: Option<String>, delivery: String, set, deleted, unchanged: Integer, outcome: Variant{ again: Null, loaded: Null, superseded: DateTime } }`: `superseded` carries the source's as-of; `again` and `superseded` carry no counts (0) | API |
| `RecordLoadArgsType` (new) | `{ delivery: String, load: String, asOf: Option<DateTime>, first: Boolean, execution: { inputsHash: String, executionId: String }, set, deleted, unchanged: Integer }`: a load commit's `args`. `first` is true when the commit took the source out of `$pending`, which a rollback reads | stored in commits; new |
| `RecordLoadJobType` (new, e3-core `transfer/types.ts`) | the load's job: repo, workspace, record, source, delivery, actor, asOf, status, createdAt | job store; new kind |
| `ObjectUploadJobType` (new) | an upload that writes no ref (F8) | job store; new kind |
| `RecordBindingType` (e3-ui `bind/record.ts:121`) | `+ sources: Array<{ name: String, external: Boolean }>` | UI IR; re-export |
| `record_bind` platform function (e3-ui `bind/record.ts:303`) | `+` a literal argument: the record's sources | UI IR; re-export |
| `UiAccessType.records[]` (e3-ui `derive.ts`) | `+ sources` | derived; no store |
| `SheetRowType` (e3-ui `sheet/types.ts:250`) | `+ lock: Option<String>`: the words that lock the row, or none | UI IR; re-export |
| `SheetRootType` (e3-ui `sheet/types.ts:1026`) | `+ newRowKey: Option<Function(String) -> String>`: an id the renderer mints, to the new row's key as its `.east` text | UI IR; re-export |

Unchanged wires:

- `TaskPartitionType`: a `by` that steps through a variant's case is accepted
  (§7.3). Nothing exported has one, because the SDK and the planner refuse it
  today.
- `TaskObjectType`: a load's task object is an ordinary one.
- `ExecutionEventType` and `TaskStateType`: a load node's events and state are
  a task's, and a task due again goes back to `pending`, as an invalidated one
  does today. No event carries a load's counts (§10), no event says why a task
  waits — the reasons go to the run's caller (§7.8) — and no event records a
  catch-up run (§10).
- `DataflowExecutionStateType`: a task's output vector is the one it was
  launched with, and a record's is its commit and what its fed sources carry,
  entries of the run's `versionVectors` as today (§7.8). The order of a
  record's commits, and the catch-up runs, are the run's, in memory.
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
  (`e3-ui`'s `Record.bind`, `package.ts:146`). The record's `deps` gain each
  fed source's feed, so `e3.package` collects the feed with the record.
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
  (ruling 4).
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
  second argument to `indexes`, `mutations` and `migrations`. TypeScript infers
  the sources before the parts after them, because the object's properties are
  inferred in order; that is why `sources` comes first.
- **`initial`, per source.** e3 puts each source's case on its entries, and
  refuses an external source named in `initial`.
- **The load program** (`record-programs.ts`: `buildLoadProgram(rec,
  source)`, generated at export as a mutation's program is). It is the patch
  door's program over the source's entries, with the author's function in
  front:
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
     `e3-types/src/record.ts:752`). The commit refuses a delta that holds one
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
  guess. It is `none` for a record with no summary.
- **Export** (`export.ts`). For each external source it writes:
  - **the load's task object**, built as a split call's is
    (`splitCall.ts:299–307`): the load program as its body, the source's
    runner, role `data`. Its inputs are `[delivery, run]` at `path: []`,
    partitioned `by: []` and `by: [<source>]` when the delivery is keyed and
    unpartitioned otherwise. Its output, at `path: []`, is a `dict` folded by
    the merge program when keyed, and a `value` otherwise. The author's
    function is linked into the program as a mutation's body is, under the
    owner `load "orders.erp"`.
  - **the load object** (`$recordLoad`): the key and delivery types, the
    feed's path for a fed source, and the task object's hash.

  The record object's `sources` names each load object, and a solution source
  as `mutations`.

### 7.2 e3-types

The wires of §6, with their TypeDoc and decoders. `decodeRecordObject` says
"re-export" for a record object written before `sources`. The load object's
tag, `RECORD_LOAD_KIND = '$recordLoad'`, sits beside `RECORD_STATE_KIND`
(`record.ts:605`), and the `$load:` commit-name helpers beside the system
commit names. The graph node's `load` documents what a load node is
(`dataflow.ts:113`). `InputPlanType`'s TypeDoc gains `retained` beside `keep`
(`api.ts:443–464`).

### 7.3 e3-core: the planner cuts through a variant's case (F1)

`cutOf` (`execution/pieces.ts:166`) learns one step: a `by` entry that names a
**case** of a variant key cuts by that case's value. A load's two inputs are:

- the delivery, keyed `K`, with `by: []`;
- the source's entries, keyed `Variant{…}`, every key of case `erp`, with
  `by: ['erp']`.

Both cut as `[K]`, so the type check at `pieces.ts:307` passes unchanged, and
the cut is otherwise the existing one. A case step adds no group (a key is its
own group), so it costs no extra reads at a boundary. An entry of another case
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

`applyDelta` and `applyDeltaEntries` (`record-apply.ts`) take the cases the
write may touch: `{ cases: ReadonlySet<string> }`. A `primary` op on a key of
any other case throws `ExternalEntryError(key, source)` before the target is
written. This is a check of the op's tag that reads no state.

- `writeDelta` (`records.ts`) passes the record's solution sources, for both
  the program path and the patch door's fast path (`patchDelta`). The error
  becomes `{ kind: 'invalid', message }`, naming the mutation, the key (as
  East prints it) and the source.
- A load, run as a job or by the dataflow, passes its own case alone.
- A replay of commits under a load (§7.6) passes no restriction: each was
  checked when it committed.
- A plain record has no sources, and passes no restriction.

`resolveRecord` (`records.ts:495`) reads the record object's `sources` into the
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
   loads run one at a time, reporting `queued` while it waits. The wait is a
   loop of `acquire(…, { wait: true, timeout: 30_000 })`: each time it answers
   null, the load checks its signal, re-references the delivery, and asks
   again. It has no bound: the load ahead may take hours. A job store runs one
   source's jobs in the order they were made, so within a server they also run
   in the order asked. Across processes, the lock is the order.
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
5. **Write the ref** (`writeIf` at `Hn`'s revision) with `nextVersions(Vn,
   self, commit, owned)`, owning:
   - `$load.<source>` = `delivery`, `$load.<source>.load` = `load`,
     `$load.<source>.commit` = the commit,
     `$load.<source>.execution` = `<inputsHash>/<executionId>`;
   - `$load.<source>.asOf` = the later of `Vn`'s and `asOf`, printed through
     East; no `asOf` leaves the slot as it is;
   - `$load.<source>.feed` = `feed`, printed through East, for a fed source;
   - `$pending` = `Vn`'s without the source, `undefined` once empty.
6. **A ref conflict** (`DatasetRefConflictError`) is the only failure retried:
   wait `casBackoffMs(n)` (`records.ts:304`) and go back to 1. An apply error
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
writer touches.

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

### 7.7 e3-core: slots, pending, rollback, restore, deploy (F4, F6, F15, F21)

- **Pending, read by the dataflow.** `dataflowResolveInputs` (§7.8, in place
  of `dataflowResolveInputHashes`, `dataflow.ts:580`) reads each record
  input's ref with its version vector, and answers `null` for a ref whose
  versions hold `$pending`, as for an unassigned one. So `stepPrepareTask`
  leaves its dependents `waiting`, and the run goes on without them; the
  reason words name the sources (§7.8). A load node does not read its record
  as an input, so a pending record never holds up its own load. The first
  load's commit moves the record's commit, so change detection finds it, and
  the waiting dependents are decided again and run.
- **At every deploy** (`commitDeployRecords`, `records.ts:1364`; the plan's
  `RecordDeployment` gains each composite's external sources, read from the
  new package's record object). The prior external sources are the ref's
  `$external` slot: a deploy reads no record object of the package it
  replaces, which an earlier SDK may have written (§6).
  - **mint** (`:1385`): `$pending` and `$external` name every external
    source.
  - **reset** (`:1426`): every `$load.*` slot is dropped, each named, since
    `nextVersions` drops only what a writer names; `$pending` and `$external`
    name every external source.
  - **keep, with a `$deploy` commit** (`:1396`), and **migrate** (`:1404`):
    - `$pending` = (the prior `$pending` ∩ the new external sources) ∪ (the
      new external sources not in the prior `$external`): a source new to the
      set joins it, whether added with a type change or changed from
      `mutations` to `load`;
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
- **Rollback** (ruling 7). `systemCommitState`'s walk (`records.ts:1997`)
  already decodes each commit it passes on its way from the head to the target.
  For each `$load:<source>` commit passed — each one the rollback undoes — it
  reads the commit's args (`RecordLoadArgsType`) and records the source as
  undone, and as reopened when `first` is true. `recordSystemCommit` then
  writes the ref with `nextVersions(current.versions, self, commit, owned)`
  (`:1897`), owning, for each undone source, `$load.<source>`, `.load`,
  `.commit`, `.execution`, `.feed` and `.asOf` as `undefined`, and `$pending`
  with each reopened source added. A source forgets the delivery it undid,
  as-of included, since the record no longer holds what it sent; it waits for
  a first delivery again only if its first was undone. A run in flight finds
  the record changed and its load node due, and the next run's prepare finds
  no slot naming its feed; either loads it (§7.8).
- **Restore.** A restored state comes from outside the history, so nothing
  says what it holds of each source. A restore drops every external source's
  `$load.*` slots, and sets `$pending` to the external sources with no entries
  in the restored state, found by bisecting its fences on each case, as
  `recordSourceRun` bounds a run. A source whose last delivery was empty is
  read as pending, so a restore errs toward waiting. A first state a system
  commit gives a record that holds none (`$init` over an unassigned record)
  sets `$pending` and `$external` the same way.
- **Compaction.** `recordCompact` (`records.ts:1652`) empties a
  `$load.<source>.commit` it cuts from the chain, as it rewrites
  `$migrations` (`records.ts:113–120`).
- **History.** `recordCommitArgs` and `recordHistory` decode a `$load:`
  commit's `args` as `RecordLoadArgsType`, and the CLI says it in words (§4.3).
- **Describe.** `recordDescribe` (`records.ts:1566`) answers `sources`: each
  source's key type, whether it is external, its delivery type, its feed, its
  last delivery, commit and as-of from the slots, and whether it is pending.
- **Seed.** `e3 seed` refuses a composite (`commands/seed.ts`).

### 7.8 e3-core: runs that follow their records, and a fed load (rulings 5, 10–12 and 14, F12, F17, F20, F28, F29, F31–F33)

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
results                commit                                result read there from the cache
an edit                found at the run's next completion;   the view's start hands it to the run, which
                       the view's start is refused           looks at once
a record's readers     (no loads today)                      run on the record as it stands, and again
while its load runs                                          after the load's commit
```

#### Every result lands (F32, ruling 12)

- **A result lands as its task finishes.** `completeTask`
  (`LocalOrchestrator.ts:1442`) and the cache hit (`:987–1033`) no longer ask
  `stepTaskResultStale` (`steps.ts:633`), which is removed. `stepTaskCompleted`
  records for the task's output the version vector the task was launched with,
  in place of the merge of the run's vectors at its end (`steps.ts:1065–1076`),
  and the output is written to the workspace (`stepApplyTreeUpdate`), as today.
- **A task is due when an input it reads directly changes.**
  `stepTasksDue(state, changed)` (`steps.ts`, new) takes the place of
  `stepInvalidateTasks` and its transitive `findAffectedTasks`
  (`dataflow.ts:397`). `changed` is a root whose snapshot moved
  (`handleInputChanges`, `LocalOrchestrator.ts:1407`), or a task whose result
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
  `dataflowGetReadyTasks`, `dataflow.ts:443`, takes the tasks with a result
  apart from those completed). So a change travels a step at a time: a task's
  dependents are due once its next result lands, not when the root moves, and
  none of them is reset to wait for it.
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
(`LocalOrchestrator.ts:942`):

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
deferred.

**Reading the inputs at the task's commits.** `dataflowResolveInputs(storage,
state, task, commits)` (`dataflow.ts`, new) takes the place of
`dataflowResolveInputHashes` (`:580`), which reads the refs as they stand. It
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
- `onCatchUp(task, forTask, phase)` tells the run's caller. No event records it
  (§10).

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
  its own.
- A catch-up is rare: the faster input usually ran on that commit itself, as
  its run before. It costs at most one more run of each task the combining
  task reads through, per run of that task, at commits the run has seen.

#### An edit wakes the run (F33, ruling 14)

A view writes, then starts a run (`writeAndStart`,
`e3-ui-components/src/platform/dataset-store.ts:682`; `record-runtime.ts:548`).
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
  `LocalOrchestrator.ts:1069`). A wake runs `handleInputChanges` (`:1407`)
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

**The graph.** `buildDependencyGraph` (`dataflow.ts:236`) reads each record
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
`dataflowGetGraph`'s `dependsOn` (`:316`, `:349–358`) and
`buildOutputVersions` (`LocalOrchestrator.ts:2029`) are unchanged, and
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
(`LocalOrchestrator.ts:965`) calls it for a node whose `load` is `some`:

1. **Wait** (rulings 9 and 10), as on an unassigned input, when the feed:
   - has no value (`unset`);
   - is a record whose `$pending` is set (`pending`);
   - is an input that holds the deployed package's value for it (`package`,
     ruling 9).

   For `package`, the feed's ref is compared with the package's
   (`pkg.data.refs`) as a deploy compares them (`sameValue`,
   `input-deploy.ts:84`, exported). The loop reads the package's refs once,
   with its structure (`readStructure`, `LocalOrchestrator.ts:2046`). A value
   someone set equal to the package's is read as the package's.
2. **Answer** from the slots. When the run does not force the node
   (`stepTaskForced`), and `$load.<source>` names the feed's hash and
   `$load.<source>.load` the node's load object, the node completes at once,
   `[CACHED]`. Its execution is the one `$load.<source>.execution` names, and
   its output is the record's head. Nothing commits.
3. **Prepare.** Read the record's head `H0`, and store the source's run
   (`recordSourceRun`, §7.5 step 6). The inputs are `[feed, run]`.
   - The execution cache is asked unless the node is forced
     (`dataflowCheckCache`, `dataflow.ts:506`).
   - It skips the check that the workspace's output ref matches
     (`steps.ts:714–728`): a load's output is a commit, not a ref.
   - The prepared node carries `base: H0`, held with its launch in memory.

**Launch.**

- A node the cache answers launches its commit alone (`launchLoadCommit`). It
  is tracked in `runningTasks` under its name, as `launchTask` tracks a task
  (`LocalOrchestrator.ts:1613`). The cache key holds the run, so a cached delta
  was made from the entries as they stand, and its commit never applies a
  delivery twice.
- Any other node launches as a task does. A keyed load launches as a split
  task (`launchSplit`, `:1642`), its pieces reported as `[PART]` lines. A load
  of one piece launches as one execution (`launchTask`).

**The commit, outside the run's mutex (F20).** A load node's success goes to
`completeLoad` (`LocalOrchestrator.ts`, new) in place of `completeTask`'s
success arm (`:1458–1526`). Failure and cancel go through `completeTask` as any
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
   - thrown: the node fails as any task does (`hasFailure`, `stepTaskFailed`,
     `stepTasksSkipped`, `:1543–1575`).

A cancel and a stop wait for a commit already in flight, as for anything in
`runningTasks` (`:1088–1090`, `stopLaunched`, `:1268`). A yield does not
(`:1059–1065`). So `checkpointYield` (`:1373`) first fires every commit's
abort in `loadCommits` and waits for each to settle, before it takes the
mutex: no commit lands after the run lets the workspace go. A commit that had
written its ref is answered by the slots when the run resumes.

Two load nodes of one record commit side by side, each a change of the
record. A reader runs once for both when both land while it runs.

**Fail.** A failed piece, a refused delta, or an apply error fails the node
with the load's message (`stepTaskFailed`, `steps.ts:1124`). The record keeps
its last commit, and the run launches nothing more (`hasFailure`,
`LocalOrchestrator.ts:911`), as after any failed task. No node depends on a
load node, so none is skipped: the readers' results stand.

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
(`dataflow/types.ts:116`) becomes `waits: InputWait[]`, a hard cutover:

```ts
type InputWait =
  | { input: string; kind: 'unset' }                          // no value: today's case
  | { input: string; kind: 'pending'; sources: string[] }     // a record yet to hear from these sources
  | { input: string; kind: 'package' }                        // a feed input holding its package's value
  | { input: string; kind: 'upstream'; task: string };        // a record whose load node waits
```

- `stepPrepareTask` classifies a `null` from `dataflowResolveInputs` by the
  input's ref: `$pending` set, or not.
- `stepPrepareLoad` gives its own.
- `stepTasksWaiting` gives a waiting node's dependents `unset` for a task's
  output, as today, and a record's readers `upstream` for its load node that
  waits.
- `onTaskWaiting(taskName, waits)` replaces `(taskName, inputs)`
  (`dataflow.ts:205`, `orchestrator/interfaces.ts:153`,
  `LocalOrchestrator.ts:975`, `execution/local-orchestrator.ts:125`). So do its
  callers: `e3-cli` `start.ts:209` and `watch.ts:248`,
  `record-deploy.spec.ts:902`, and `contract/dataflow.ts:399` and `:449`.

The CLI says each (§7.13). No event carries the reasons: a run's events are a
stored form (`steps.ts:782–784`).

**History's prune (F29).** `keepOf` (`history.ts:441`) names a load node's
current execution by the record's `$load.<source>.execution` slot,
`${node.hash}/${inputsHash}`, read with the record's ref. This replaces the
inputs hash over the graph's inputs (`:477–481`). A node whose slot is gone
has no current execution.

**The upgrade step.** `e3-core/src/upgrades/dataflow-graph-loads.ts` carries
every stored run into the form whose graph nodes carry `load`, with `none` on
each. It follows `dataflow-force-tasks.ts`:

- both forms frozen;
- every run read through `StorageBackend.runStates`;
- a run already in the new form, or in neither, left as it is;
- a workspace a unit, in parts.

It is registered after `dataflow-force-tasks` in `REPOSITORY_UPGRADES`
(`repository-record.ts`).

### 7.9 e3-core: the deploy intent, locks and feed inputs (rulings 2, 6, 9 and 13, F5, F13, F16, F22–F25, F34)

The stop signal uses only the lock service, which every backend implements
(`LockService.acquire`), so it crosses processes and machines with no new
store. The functions below live in `e3-core/src/deploy-lock.ts` (new), over
`LockService` alone, so e3-cloud and e3-web share them.

- **The probe.** `deployAnnounced(storage, repo, ws)` takes `<ws>#deploy`
  shared, without waiting, and lets it go at once: a null answers that a
  deploy has announced itself. It asks `acquire` rather than `getState`, so a
  holder is judged as the lock service judges every holder.
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

  `workspaceDeployWith` (`workspaces.ts:781`) takes its lock through it in
  place of its acquire at `:800`. A caller that hands a deploy its own lock —
  `ProcessDeployDeps.lock` (`transfer/process.ts:348`), the deploy options'
  `lock`, e3-cloud — must take it through `acquireForDeploy`, which both
  TypeDocs say. A new workspace's bundle import (`workspace-bundle.ts:373`)
  takes its lock as today: no load or run holds a workspace that does not yet
  exist.
- **A plan announces nothing** (F24). `workspaceDeployWith` with `plan: true`
  takes the workspace's lock shared, through `acquireWorkspaceShared`, and
  stops nothing.
- **Writer preference** (F25). `acquireWorkspaceShared(storage, repo, ws,
  operation)` probes the intent first: once a deploy has announced itself it
  answers null at once, which its caller reports as `WorkspaceLockError`
  naming the deploy (`getState(repo, '<ws>#deploy')`); otherwise it takes the
  lock shared, as today. Every shared taker uses it: `trees.ts:412`
  (`dataset_write`), `records.ts:286` (`withSharedWorkspaceLock`: mutations and
  system commits), `workspace-bundle.ts:159` (export), `workspaces.ts:358` (a
  copy's source) and `LocalOrchestrator.ts:485`, `:567` (a run's start and
  resume). A load job waits on the intent instead (§7.5 step 4). A shared taker
  that took the lock just before the deploy announced finishes, and the deploy
  waits for it.
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
  `LocalOrchestrator.ts:782`; `endCancelled`, `:1280`), with the reason "a
  deploy of <ws> started":
  - running units and catch-up runs stop through the runner's signal;
  - a load's commit in flight stops before its next write;
  - the run lets the workspace go.

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
  with create, get, updateStatus, delete and execute, as `SplitCallStore` has.
  `InMemoryTransferBackend` runs each job in the background, and runs one
  source's jobs in the order they were made (a chain per source).
  `handleProcessRecordLoad` (`transfer/process.ts`) calls `recordLoad`, its
  progress throttled to 500 ms as a split call's is. A job stopped by its
  signal hands over as a split call's does, left `processing`.
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
  - `POST /repos/:repo/workspaces/:ws/objects` (init), `GET
    …/objects/upload/:id/parts/:n`, and `POST …/objects/upload/:id` (commit;
    then poll with GET).

  A load is a write, granted as a mutation is. The actor is resolved as a
  mutation's (`resolveActor`). A load of a fed source is refused `invalid`,
  naming its feed.
- **The dataflow's answers.** The graph and run-state answers carry each
  node's `load`, and the run start answers `DataflowStartResult`, handing a
  start to the run in flight through `wake` (§7.8). Client and server ship
  together.
- **The deploy route** takes its lock through `acquireForDeploy` (§7.9).

### 7.12 e3-api-client

`workspaceRecordLoadLaunch`, `workspaceRecordLoadStatus`, and
`workspaceRecordLoad` (launch, then poll as `splitCall` does, with
`onProgress` and a `signal` that stops polling while the job runs on). Its
arguments are `(url, repo, ws, record, source, request, requestOptions, {
onProgress, signal })`, `request` a `RecordLoadRequest` with its `asOf`. Also
`objectUpload` (init, parts, commit, poll), `workspaceRecordDescribe`'s
`sources`, the graph nodes' `load`, the input plan's `retained`, and
`dataflowExecuteLaunch` answering `DataflowStartResult`.

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
    `workspaceRecordLoad` is polled.
  - A fed source is refused, naming its feed and `e3 dataflow run <repo> <ws>
    --filter <record>.<source>`.

  It answers as §4.3 does: `Loaded …` with the counts and the as-of,
  `already holds this delivery`, or `… nothing loaded (superseded)`. A
  superseded delivery exits 0: nothing went wrong.
- **`e3 dataflow run`** prints a load node's lines as a task's (§4.4):
  `[START]`, `[PART]` for its pieces, `[DONE]`, `[CACHED]` when the slots or
  the cache answer it, and `[FAIL]` or `[ERR]` with the load's message.
  - A local run prints a catch-up run (`onCatchUp`) as `[CATCH-UP] capacity
    for plan`, and its end as `[DONE] capacity for plan [61200ms]`. The
    summary's counts are per task, as today, and count no catch-up run.
  - A remote start answered `handed` prints "A run is in flight on <ws>: it
    takes your changes in now.", and follows the run from `since`
    (`followRemoteRun`, `start.ts:374`), not from its first event.
- **Waiting words.** `describeUnset` (`commands/start.ts:464`) becomes
  `describeWaits(waits)`, which `start.ts:209` and `watch.ts:248` print after
  `[WAIT] <task>:`:
  - `unset`: `input 'x' not set`, as today;
  - `pending`: `record 'orders' waits for the first delivery of erp`, the
    sources joined with commas;
  - `package`: `input 'erp_extract' holds its package's value: set it, and
    orders.erp loads it`;
  - `upstream`: `record 'orders' waits on its load orders.erp`.

  The summary line (`start.ts:479`) becomes "N tasks wait on an input that is
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

  Other formats are unchanged.
- **`e3 seed`** refuses a composite.

### 7.14 e3-web

`WebTransferBackend` gains `recordLoad` and `objectUpload` stores. Each is a
`JobStore` with its record type (`{ job, owner, finishedAt }`), and the
`TransferKind`s go in `WebStorage`'s `transferKeys` / `stagedKeys`, which the
sweep covers. Pieces run on the page's worker runner as a split call's do.
Routes come from the shared factories. Its runs follow their records through
the shared steps and `LocalOrchestrator`, a load node among them, and its run
start hands over through `wake` (§7.8). Its locks go through the shared
functions of §7.9.

### 7.15 e3-ui, e3-ui-components, e3-ui-cli (F9, F30)

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
- **New rows are the solution's** (F30). `SheetRootType` gains `newRowKey:
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
  `Record.onApply`, so they cannot write an external entry. Drawing those
  entries locked there is a follow-up (§10).
- **A view's start after a write is handed to the run in flight** (§7.8).
  `writeAndStart` and the record handle's start are unchanged: their start is
  answered `handed` where it was refused, and the view's results follow the
  edit as their tasks land.

### 7.16 e3-cloud (companion)

The companion issue builds:

- the two job stores;
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
    flight, cancelling it (§7.9);
  - a load node: its units as a split task's, and its commit as a step of its
    own (`recordLoadCommit`) outside any shared state update, with no `base`
    across invocations (§7.6's run check) unless it keeps `H0` in its own step
    state;
- its stored graph (`graphHash`) gaining `load`, with its own upgrade step.

Everything else is shared e3-core logic.

## 8. Limits and timings (proposed, for review)

| Limit | Proposed | Today |
|---|---|---|
| How often a running load job probes the deploy intent | every 1 s | none |
| How often a run probes the deploy intent | every 1 s, every run in flight, loading or not | none |
| How long a deploy waits, for the intent and then the workspace lock | 30 s in all, then `workspace_locked` as today; a run in flight stops within about a second of the intent. This applies to every deploy | refused at once |
| How soon a run in flight takes in an edit | at once when a start reaches the process that runs it, as a view's does after each write; otherwise at the run's next completion | at its next completion; a start is refused |
| How long a run lasts | until no task is due, ready, in flight or catching up; under steady edits, until it is stopped or a deploy stops it | the same, its slow results thrown away |
| Catch-up runs | at most one of each task a task reads through, per run of that task, at commits the run has seen; never written to the workspace | none: the task is deferred |
| A task deferred for consistency | while two of its inputs read a plain input at different values; while a fed record's delivery is forgotten; while two fed records carry different versions of one upstream; while it reads a fed record and the plain input that feeds it, and the input's new value loads. Each ends once a run or a load catches up | while any two of its inputs came from different commits |
| A shared taker while a deploy has announced itself | refused at once, naming the deploy | refused at once while the deploy holds the workspace |
| A load's wait for its source's queue, and for a deploy to finish | no bound; 30-s acquires in a loop, each turn checking the signal and re-referencing the delivery | n/a |
| A load's compare-and-swap loop | no attempt cap and no deadline; the existing backoff (`casBackoffMs`); retries ref conflicts alone, and checks the signal before each attempt | a mutation's retry window: 30 s |
| A load's run | no request deadline (a job, or a step of a run); each piece under the runner's limits, as a split task's | n/a |
| A load job's progress | throttled to 500 ms, as a split call's | n/a |
| gc and a delivery not yet in a job | held gc's age gate, a minute, and the window beside running work | the same |

## 9. Tests

Every backend runs the shared suites. Locally each task runs the specs its
change reaches; CI runs the rest.

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

Follow-ups, to file once this lands:

- **An added or removed source as a built-in deploy step** (F11). Today it is a
  type change: a declared migration (`migration.rekey`), or a reset. e3 builds
  the type, so it can build that step itself.
- **The Plan and the other record editors drawing external entries locked**
  (§7.15). Until then, their Apply refuses them.
- **A caller stopping its own load job** (a job cancel route). Today a load
  job is stopped by its process's signal, or by a deploy.
- **A run's load counts in its lines and events.** They are in the record's
  history. Carrying them in the run adds an event, a new stored form of every
  run's events.
- **Waiting reasons over the API.** A remote run says how many tasks wait, not
  why: the reasons reach a local run's caller alone (§7.8). Carrying them adds
  a stored form of the run's state or events.
- **Catch-up runs in the run's events.** A local run's caller hears them
  (`onCatchUp`); a remote one sees the task that waits on them start later.
  Carrying them adds an event, a new stored form of every run's events.
- **Waking a run in another process.** A start reaches a run only in its own
  process: a local `e3 dataflow run` beside a server's run is refused as
  today, and an edit made through `e3 mutate` reaches a run at its next
  completion. Waking across processes needs a signal every backend carries.

## 11. Development tasks

One PR. Each task is ticked with its commit once it lands. Locally each task
gates on build, lint and the specs its change reaches; CI runs the union.

**A. Wires and types (e3-types)**
- [ ] A1. `RecordObjectType.sources`; `RecordLoadObjectType`, tagged
  `$recordLoad`, with `feed`; decoders saying "re-export";
  `RecordLoadArgsType` (as-of, `first`, execution); `$load:` name helpers.
- [ ] A2. `RecordSignatureType.sources`, with `feed` and the last delivery's
  as-of; `RecordLoadRequest/Status/Progress/Result` types, the request's
  `asOf` and the result's `outcome`; `PackageJobResponseType` reused;
  `DataflowStartResultType`.
- [ ] A3. `RecordLoadJobType`, `ObjectUploadJobType` (e3-core `transfer/types.ts`).
- [ ] A4. `DataflowGraphTaskType.load`, and the repository upgrade step
  `dataflow-graph-loads`: frozen forms, spec, registered in
  `REPOSITORY_UPGRADES`.
- [ ] A5. `InputPlanType.action.retained`, sorted last, with its TypeDoc.

**B. SDK (e3)**
- [ ] B1. The `source` builder and `e3.recordComposite`; the built type;
  `RecordDef.sources`; `CompositeRecordDef`; refusals.
- [ ] B2. The types argument handed to `indexes` / `mutations` / `migrations`
  (`e3.record` too); per-source `initial`.
- [ ] B3. `buildLoadProgram` and `buildLoadMergeProgram` (`record-programs.ts`):
  a key outside the piece or the source as a `$conflict` entry, summary totals
  summed, any other shared key failing the merge.
- [ ] B4. Export: each load's task object and load object, and `sources` in
  the record object (`export.ts`, `package.ts`).
- [ ] B5. Fed sources: a task, an input or a record as a load's delivery; the
  record's `deps`; `e3.package` refusing a task named as a load node, and a
  cycle through a load; the delivery contract in `source.load`'s TypeDoc.

**C. e3-core**
- [ ] C1. The planner's case step (`execution/pieces.ts` `cutOf`).
- [ ] C2. `applyDelta` / `applyDeltaEntries` `cases`, `ExternalEntryError`;
  `writeDelta` / `patchDelta` refusing as `invalid`; `resolveRecord` sources.
- [ ] C3. `recordLoadCommit` (`record-load.ts`): the `$conflict` refusal, the
  replay, the run check, ref conflicts alone retried, the signal, the slots
  and args.
- [ ] C4. `recordLoad` and `recordSourceRun`: running work and the delivery
  re-referenced, the queue and intent waits in loops, the repeat and
  superseded answers, intake, the stored run, pieces, the restart.
- [ ] C5. Slots at a deploy (`commitDeployRecords`, `RecordDeployment`):
  `$pending` and `$external` at mint, reset, keep and migrate; a migration's
  delivery slots; a reset's slots named; compaction emptying `.commit`.
- [ ] C6. Rollback and restore forgetting the deliveries they undo
  (`systemCommitState`, `recordSystemCommit`); a restore's and a genesis's
  `$pending`.
- [ ] C7. The deploy intent (`deploy-lock.ts`): `deployAnnounced`,
  `acquireForDeploy` in `workspaceDeployWith`, the lock's TypeDocs, `--plan`
  shared; `acquireWorkspaceShared` at every shared taker.
- [ ] C8. Feed inputs at a deploy: `planInputDeployments`'s `feeds` and
  `retained`, `refsKeepingInputs`, the reset reason.
- [ ] C9. History args, `recordDescribe` sources (feed, as-of), seed refusal.
- [ ] C10. gc: the record object's load objects; the load object's kind.
- [ ] C11. The graph: load nodes, `loadsOf` for waiting, a load node's
  `dependsOn` on its feed's task, no node depending on one, `taskOutputPaths`
  without them, a clash and a cycle refused.
- [ ] C12. Every result lands: `stepTaskResultStale` removed, results recorded
  with their launch vectors, `stepTasksDue` by direct inputs, results kept
  while a task runs again, readiness on results, the run's end.
- [ ] C13. A task's commits: `stepTaskCommits`, `dataflowResolveInputs`
  reading a record at a commit from its history, `recordCommitOrder`,
  catch-up runs (`behind`, their tracking, the prepare again, failure,
  `onCatchUp`), a plain input deferred.
- [ ] C14. What a record's version carries: `$load.<source>.feed` written by a
  fed load's commit and dropped with its delivery slots, the feed's vector
  when its hash is the delivery, `$unknown` after a forgotten delivery.
- [ ] C15. `wake`: `DataflowOrchestrator.wake`, and `LocalOrchestrator`'s runs
  by workspace with the wake in their race.
- [ ] C16. `stepPrepareLoad` (wait, answer, prepare) and the waiting reasons:
  `InputWait`, `stepTasksWaiting` and `waitsOnDependency` through `loadsOf`,
  `$pending` read, the `onTaskWaiting` cutover.
- [ ] C17. The commit outside the mutex in `LocalOrchestrator`:
  `completeLoad`, `launchLoadCommit`, `loadCommits`, a yield waiting for
  commits in flight, failure and force.
- [ ] C18. A deploy stops any run: every run's intent probe, its landed
  results kept.
- [ ] C19. `keepOf` naming a load node's execution by its slot.

**D. Transfer, server, client**
- [ ] D1. `RecordLoadStore` and `ObjectUploadStore` in the interfaces and
  `InMemoryTransferBackend`; `handleProcessRecordLoad`; the object upload's
  processing.
- [ ] D2. e3-api-server routes and handlers; grants and actor; a fed source
  refused; the graph's `load` in the dataflow answers; the run start handing
  over through `wake`, and its `DataflowStartResult`; the deploy route's lock
  through `acquireForDeploy`.
- [ ] D3. e3-api-client functions (the request's `asOf`, the result's
  `outcome`), the graph's `load`, the plan's `retained`, the run start's
  answer.
- [ ] D4. e3-api-tests suites (`records-load.ts`, `object-upload.ts`, a fed
  source's dataflow, the start's handover, a deploy stopping a load job and a
  run).

**E. e3-web**
- [ ] E1. `WebTransferBackend` stores, record types, transfer kinds, sweep.

**F. CLI**
- [ ] F1. `e3 load`, local and remote, `--as-of`, its answers' words, and its
  refusal of a fed source.
- [ ] F2. `e3 history` words (with the as-of) and `--delta` for a load commit.
- [ ] F3. `e3 dataset get -f beast2` streaming the stored segments, locally and
  remotely.
- [ ] F4. A run's lines for a load node and a catch-up run; `describeWaits`
  and the summary lines (`start.ts`, `watch.ts`); a remote start answered
  `handed` followed from its cursor.
- [ ] F5. `retained` input plan lines (`inputPlanLine`, deploy and watch).

**G. UI**
- [ ] G1. `record_bind` sources, `RecordBindingType.sources`, `UiAccess` sources.
- [ ] G2. `Record.onApply` rejecting external changes, keyed and for one entry;
  the entry form read-only over an external entry.
- [ ] G3. The Sheet's locked rows: `SheetRowType.lock`, `keyLock`, the
  renderer's attribute and refusals, the recipe, the record form's wiring, the
  DOM invariant.
- [ ] G4. New rows' keys: `SheetRootType.newRowKey`, the renderer's minting,
  `<Sheet record>`'s `source` prop, the refusal at `root.ts:704`.
- [ ] G5. The terminal UI: the records view's sources, and the dashboard's
  load nodes.

**H. Docs and skills**
- [ ] H1. `libs/e3/SKILL.md` (composite records, fed sources in the dataflow,
  the delivery contract, `e3 load` and `--as-of`, what a rollback does, feed
  inputs at a deploy, the slots in words, and how a run follows edits: every
  result lands, a task's commits, catch-up runs, the wake, a deploy stopping a
  run); `libs/east-ui/packages/e3-ui/SKILL.md` (locked rows, new rows);
  `libs/e3/USAGE.md` / CLI docs.
- [ ] H2. Examples beside the specs; the plugin index regenerated
  (`make -C libs/east-plugin index`).
- [ ] H3. File the follow-ups of §10; note the e3-cloud companion's scope.
- [ ] H4. `docs/conventions/WIRE_MIGRATION.md`: a "Changes" entry for each
  wire §6 changes, with its kind.
