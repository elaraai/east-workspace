# Record storage — decisions and the current model

Status: decision record (2026-06-14), revised 2026-09-25 to describe the model
as built. The storage format is specified in
[`e3-records-schema.md`](./e3-records-schema.md) and the records API in
[`e3-records.md`](./e3-records.md). This document keeps the storage decisions
and their reasons. Record operations run on the one execution engine, as
[`e3-data-architecture.md`](./e3-data-architecture.md) §3.7 describes.

## Why records retain history at all

An `e3.input` is *sourced from outside* the solution — an integration writes raw
data and the provenance ("who/when/why") lives in the upstream system. You blind-
overwrite it because it is a cache of someone else's truth.

A record is *mutated from inside* the solution by decisions and actions. Nothing
outside owns that state, so e3 must be its system of record. Everything else
follows:

- **Attribution (CQRS).** A record is written only through typed mutations, never
  a blind set. Each commit captures which mutation ran, with what args, by whom,
  when.
- **Auditability.** The platform exists to show the evidence behind a decision;
  the commit chain is that evidence for operational state.
- **Event log / reproducibility.** Mutations are pure reducers over args, so the
  chain is an event-sourced log — reconstruct any past state, diff, debug.

Two things are bundled, and only one is load-bearing. **Versioning + attribution
of the current state** (the head commit hash drives CAS and reactive change
detection; its actor/when attribute the latest change) is cheap and required.
**Retaining the entire chain to genesis** (full audit/time-travel) is a product
choice and is opt-out via `recordCompact`. The default keeps it because that is
the value-add over a plain input.

## The current model

- **State.**
  - A collection-typed record is stored like every collection dataset: a
    segment manifest (`$segments`) over standalone beast2 v5 segment objects,
    cut by the content-defined rule.
  - A record with secondary indexes stores a `$record` object instead, naming
    the primary's manifest and one manifest per index. The door that resolves a
    record's state accepts either.
  - Any other record's state is one blob.
- **Commits.** Each mutation appends a
  `RecordCommit { parent, state, mutation, args, actor, at, delta }`. `state`
  names the new state object, and `delta` what the mutation changed, by key,
  for the primary and for each index. Deploy writes a `$init` commit from the
  package's initial value; `recordCompact` writes a `$compact` root.
- **Writes.** A mutation takes a shared workspace lock (it coexists with a
  dataflow and is fenced out by deploy) and runs in a compare-and-swap loop:
  retried against fresher state on a conflict, with jittered backoff, an
  idempotency key in a reserved `$idem` version-vector slot, and a deadline.
  - A keyed record (a Dict or a Set) is written by delta.
    - Every form — a reducer, an `edit` body, a client's patch — runs as a
      generated program that emits the delta, in any order; the runner sorts
      it.
    - e3-core reads the delta in order and applies it a target segment at a
      time: the ops that fall in one segment are applied to that segment
      alone, which is re-cut with beast2's Recut. Every segment the edit
      leaves standing is carried over unread, and re-cutting runs outward only
      until the new cuts agree with the old.
    - A `patch` on a record with no index applies the patch without running a
      program at all.
  - Any other record is written whole: the reducer's output becomes the new
    state.
  - A program runs as one unit through the task executor, with an execution
    record, logs, cancellation and a timeout. It receives the record as its
    manifest with the segments linked, which the runner opens lazily past its
    lazy-open threshold, so an `edit` body reads the segments of the keys it
    touches. A reducer's result is diffed against the whole state, so a
    reducer reads every segment.
  - A mutation whose view of the record is stale — an edit of a key the record
    no longer holds, or a patch whose `before` no longer matches — is a
    conflict naming the key, and writes nothing. The program says so with a
    `$conflict` entry, which sorts first in the delta, and the apply says so
    of an op that disagrees with the segment it lands on.
- **Indexes.** An index is a second canonical collection keyed `{ik, k}`,
  maintained by the same delta, in the same commit. Deploy builds, drops or
  keeps each index to match the package, and records the change as a
  `$reindex` commit.
- **Versioning.** The version-vector self-entry holds the **commit hash**, not
  the state hash, so an identical-state mutation still advances the version and
  downstream reactive tasks still re-run (no ABA).

Crash-safe by construction: objects written before the CAS swing are invisible
until the ref references them, so a crash only orphans unreferenced objects.

### How compaction and GC interact

`recordCompact` writes a `$compact` root (`parent: none`, state = current) and
swings the ref to it, making the prior chain **unreachable**. It does not delete
anything.

GC (`gc.ts`) is **on-demand mark-and-sweep, never automatic** — invoked by
`e3 repo gc` or the repo GC API; "objects remain until repoGc is run." It collects
roots (packages, workspaces, executions — a record's head commit is rooted via the
workspace ref's version-vector self-entry), marks the reachable set in memory by
schema-aware DFS, and sweeps the rest, skipping any object younger than `minAge`
(default 60s) to avoid racing concurrent writes. It is a full-repo O(repo-size)
pass.

Consequence for any auto-compaction policy: **compaction only orphans history;
reclamation needs GC to actually run.** Targeted deletion of the dropped chain is
unsafe — content-addressing means a dropped state object or segment may be shared
with another reachable object, so only the reachability mark-sweep can safely
reclaim it. Auto-compaction is therefore really *two coupled policies*: when to
collapse a record's history, and when to run GC to reclaim it. See Still open.

## Decided: segment objects, not one blob and not a database

A large keyed record with small per-key mutations is where a single-blob state
fails: changing one row of a 200K-row, ~100 MB roster rewrote and re-stored the
**entire blob** — roughly **10,000x write amplification** measured per mutation —
and content addressing gave no help, because the changed blob is byte-different.

The layout taken is content-defined and content-addressed, inside the existing
object store:

- **A single-key write re-cuts O(1) segments.** A segment starts where a key's
  hash says so, within pinned bounds, so an edit moves only the cuts around it.
- **History is nearly free.** Adjacent commits share every unchanged segment by
  content address, automatically, with no diff and no patch. The commit chain's
  shape is unchanged: `state` names a manifest.
- **Queryable.** A manifest's fences give point reads and range reads that
  decode one segment each, with no reconstruction.
- **Backend fit.** Segments are ordinary objects (S3 in the cloud, files
  locally), and only the small ref goes through the conditional ref write. No
  new backend interface was needed.

The manifest is one level today (`level` 0). Nesting is reserved for a
manifest too large to hold whole.

### Why not a SQL/row database (SQLite local, DynamoDB/serverless-SQL cloud)

Ruled out — on correctness and parity, not cost:

- **Dual-store atomicity gap.** Mutable rows live outside the content-addressed
  store, destroying the "objects invisible until one conditional ref-swing" crash-
  safety invariant. A lost CAS retry leaves durable, un-rolled-back row writes; the
  table diverges from every committed commit hash.
- **DynamoDB `TransactWriteItems` caps at 100 items**, so a mutation touching many
  keys is non-atomic in the cloud.
- **Worst parity surface** — two genuinely different engines (serializable SQLite
  vs conditional DynamoDB, plus an order-preserving key codec for negative ints /
  Float ±0/NaN / composite keys) re-implemented across an open and a closed repo,
  guarded by the shared compliance suite.

For pure per-key access the segment layout is also simply cheaper (S3 storage,
free structural-sharing history). A real DB only earns its keep if first-class
ad-hoc relational *query* becomes a hard product requirement; if so, the least-bad
form is SQLite on both sides (one dialect, killing the parity tax), accepting the
schema-mapping and separate-history costs.

### The two obstacles, and how they were resolved

- **GC would have deleted the segments.** GC recognizes objects by their shape,
  and a commit's `state` was a leaf it did not traverse. A bare object naming
  other objects also could not be told apart from a user value holding hashes.
  Resolved by self-describing kind tags — `$segments` manifests and `$record`
  states — which GC recognizes exactly and traverses.
- **Slicing an encoded blob broke byte identity.** v4 interned strings per blob.
  v5 has no string table, and a self-contained v5 segment is a standalone blob
  whose bytes are fixed by the canonical encoding and the cut rule.

## Considered and deferred: patch storage instead of state

Idea: store `diffFor(prev, new)` per commit instead of the whole value, using the
mature `libs/east/src/patch` system (`diffFor`/`applyFor`/`composeFor`/`invertFor`,
typed `PatchType`, `validatePatchFor`, 3-way merge). Verdict: **keep the state as
the source of truth.** Reasons:

- **The safe version saves little.** The only fidelity-safe design keeps the full
  `state` on every commit (so the system-of-record value is never reconstructed
  from a fold), making the patch additive audit metadata — which doesn't relieve
  owning the history.
- **The win is narrow and self-defeating on the obvious cases.** A `replace` op
  stores *both* before and after, so primitives, whole-value replaces, and dense-
  touch mutations make the patch ~2x the value. `RecursiveType` (trees, graphs,
  the ontology) uses replace-only semantics, so a deep edit replaces the whole
  subtree — the "large container" case patches were meant to win.
- **Patch chains break reads.** Reconstruct = replay the chain. Wrong trade for a
  queryable system of record.
- **Content-addressing already dedups identical states; compaction already bounds
  growth**, and the segment layout shares every unchanged segment between commits.

That is the shape commits took: `state` stays mandatory, and the mutation delta
rides beside it as the record of what changed, so a write costs O(touched
segments) and `e3 history --delta` can report it.

## Still open

- **Auto-compaction ↔ GC cadence.** Compaction orphans; only the full-repo mark-
  sweep safely reclaims. Does auto-compaction imply a GC schedule/threshold, an
  idle-triggered GC, or eventually a scoped/incremental GC? Decide together.
- **Reactive granularity.** A record is one reactive input (one version-vector
  entry per record), so a one-row mutation invalidates every task reading it.
  - A `streamTask` partitioned over the record re-runs only the pieces whose
    segments changed, and the merges they reach. Pieces are content-defined,
    so an insertion re-runs only the pieces around it.
  - Per-key invalidation is a separate, larger change.
