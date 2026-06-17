# Record storage — rationale, current model, and growth roadmap

Status: decision record (2026-06-14). Companion to [`e3-records.md`](./e3-records.md)
(the records spec). This doc captures *why* records retain history, what the
current storage model is and where it breaks, and the considered-and-deferred
roadmap for large records. It is a decision record, not an implementation plan —
nothing here is built beyond what `e3-records.md` already describes.

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

## Current storage model

A record's state is a single content-addressed BEAST2 blob in the object store,
pointed at by the per-dataset `.ref`. A mutation (`recordMutate`):

1. takes a shared workspace lock (coexists with dataflow, fenced out by deploy);
2. reads the current versioned state and runs the reducer via the graph-free
   `runDetached` kernel — the reducer returns the **whole new state value**;
3. writes the new state blob and a `RecordCommit { parent, state, mutation, args,
   actor, at }`, then CAS-swings the `.ref` to `{ hash: newState, versions: {
   self: commitHash } }`;
4. retries the whole step against fresher state on a CAS conflict (deadline-
   bounded), recomputing the reducer each attempt.

Crash-safe by construction: objects written before the CAS swing are invisible
until the ref references them, so a crash only orphans unreferenced blobs.

The version-vector self-entry holds the **commit hash**, not the state hash, so an
identical-state mutation still advances the version and downstream reactive tasks
still re-run (no ABA).

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
unsafe — content-addressing means a dropped state blob may be shared with another
reachable object, so only the reachability mark-sweep can safely reclaim it.
Auto-compaction is therefore really *two coupled policies*: when to collapse a
record's history, and when to run GC to reclaim it. See open questions.

## Considered and deferred: patch (delta) storage per commit

Idea: store `diffFor(prev, new)` per commit instead of the whole value, using the
mature `libs/east/src/patch` system (`diffFor`/`applyFor`/`composeFor`/`invertFor`,
typed `PatchType`, `validatePatchFor`, 3-way merge). Verdict: **defer; keep whole-
value commits as the source of truth.** Reasons:

- **The safe version saves little.** The only fidelity-safe design keeps the full
  `state` blob on every commit (so the system-of-record value is never
  reconstructed from a fold), making the patch additive audit metadata — which
  doesn't relieve owning the history.
- **The win is narrow and self-defeating on the obvious cases.** A `replace` op
  stores *both* before and after, so primitives, whole-value replaces, and dense-
  touch mutations make the patch ~2x the value. `RecursiveType` (trees, graphs,
  the ontology) uses replace-only semantics, so a deep edit replaces the whole
  subtree — the "large container" case patches were meant to win.
- **Patch chains break reads.** Reconstruct = replay the chain. Wrong trade for a
  queryable system of record.
- **Content-addressing already dedups identical states; compaction already bounds
  growth.** The residual patches address (long histories of large, sparsely-
  mutated, non-recursive states) is exactly the keyed-collection case below, which
  has a better answer.
- **"Just add an optional field" is not free.** BEAST2 typed decode is schema-
  positional; appending a `RecordCommit` field needs a real dual-decode (try-old-
  then-new), mirroring the existing 3-tier package decode — not a zero-cost add.

If ever pursued, the only sound shape is: keep `state` mandatory, add a trailing
optional `delta`, gate on a measured size test (store the delta only when it is
meaningfully smaller than the state), and force periodic full snapshots to bound
reconstruction cost and corruption blast radius. Not worth it until telemetry
shows a record that is a long history of a large, non-recursive value.

## The real growth problem: large keyed-collection records

A record typed as a large keyed collection (`DictType(K, V)` / `SortedMap`) with
small per-key mutations is where the monolithic-blob model fails: changing one row
of a 200K-row, ~100MB roster rewrites and re-stores the **entire blob** — roughly
**10,000x write amplification** measured per mutation. Content-addressing gives
zero help (the changed blob is byte-different). The cloud backend can't even hold
it: DynamoDB items cap at 400KB, so a monolithic large record has no cloud mapping.

### Answer: content-addressed prolly-tree, inside the existing object store

Store a large keyed record's state as a Merkle search tree (content-defined-chunked
B-tree of key→value) whose chunks are ordinary content-addressed objects:

- **Single-key write is O(log n)** — one leaf chunk + the interior chunks on its
  spine + a new root, a few objects / tens of KB, not the whole table.
- **History is nearly free** — adjacent commits share every unchanged chunk by
  content address (automatic, no diff, no patch). The commit chain shape is
  unchanged; `state` simply holds a chunk-tree root hash.
- **Queryable** — the tree is order-preserving, so point-get and range-scan are
  O(log n) descents with no reconstruction.
- **Backend fit is the decisive advantage** — chunks are objects, so they ride the
  existing `ObjectStore` (S3 in cloud, files locally), each well under the 400KB
  item cap; only the tiny root-hash ref goes through `DatasetRefStore.writeIf`.
  No new backend interface.

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

For pure per-key access the prolly-tree-on-S3 is also simply cheaper (S3 storage,
free structural-sharing history). A real DB only earns its keep if first-class
ad-hoc relational *query* becomes a hard product requirement; if so, the least-bad
form is SQLite on both sides (one dialect, killing the parity tax), accepting the
schema-mapping and separate-history costs.

### The two real obstacles (and their fixes)

Adversarial review killed the *naive* prolly design twice, both on real e3
assumptions:

- **GC would silently delete it.** `extractChildren` is shape-dispatched and marks
  `commit.state` as a non-traversed leaf, so a tree-root-through-commit gets its
  chunks swept on the first `repoGc`; and a bare interior chunk (a Dict of hashes)
  is indistinguishable from a user `Dict(K, String)` record. **Fix:** a self-
  describing `$chunk`-tagged envelope (leaf vs interior) so GC has an exact shape
  to recognize, flipping `state` to non-leaf only for chunk envelopes. Mandatory;
  it makes chunks a new on-wire object kind needing a GC recognizer + decoder.
- **BEAST2 interns strings per-blob**, so naively slicing the encoded blob breaks
  chunk byte-identity and structural sharing fails. **Fix:** chunk at the entry
  level with self-contained encoding, deterministic via `compareFor`-sorted order
  and pinned content-defined-chunking constants (parity-fixtured local↔cloud).

Reducers stay whole-value `(State, …) => State`; re-chunk the output below the
mutation API. Durable writes are O(log n), but runner CPU/memory stays O(n) (it
re-encodes/re-chunks the full reducer output) until a future, additive partial-key
reducer signature `(State[K], …) => State[K]`. That is not needed to capture the
I/O win and must not block the engine.

## Roadmap

The model is forward-compatible: the upgrade is additive (a `layout: blob | tree`
discriminant on the record), not a rewrite. Scalar/small records keep the blob
path forever; large keyed ones opt into the tree.

**Now — ship as-is plus two cheap guardrails (no new machinery, parity-trivial):**

- **Hard size cap** — pre-write reject a record state too large to map to the cloud
  (400KB-derived budget), so a record that can't deploy fails loud and early
  instead of silently at scale. Soft-warn well below the cap.
- **Auto-compaction + retention policy** — bound history growth by collapsing a
  record's chain on a length/bytes/age trigger, reusing `recordCompact`. Must be
  configurable and must emit telemetry on fire (a system-of-record user must not be
  silently de-audited), and must be designed together with a GC cadence (compaction
  only orphans; GC reclaims — see open questions).

**Later — the collection-record type (scoped when a real workload appears):**

- Introduce `layout: blob | tree`, chosen by state type + size threshold.
- Land the `$chunk` envelope, the `isChunkShape` GC recognizer, and the conditional
  non-leaf flip **first**, behind a flag, with GC-survival fixtures — GC correctness
  is a gate, not an optimization.
- Add keyed-collection fixtures to `records.spec.ts` and the shared compliance suite
  (today's scalar-counter suite catches none of this).

**Trigger to build the prolly engine:** a real, fixtured workload of a record whose
state exceeds the cap *and* receives frequent localized mutations (the roster case).
Until that exists, the deferral stands — don't pay the logic-heaviest storage path
speculatively.

## Open questions

- **Auto-compaction ↔ GC cadence.** Compaction orphans; only the full-repo mark-
  sweep safely reclaims. Does auto-compaction imply a GC schedule/threshold, an
  idle-triggered GC, or eventually a scoped/incremental GC? Decide together.
- **Partial-key reducer signature** `(State[K], …) => State[K]` — the only path to
  also kill the O(n) runner-CPU term; additive, deferred.
- **Reactive granularity** — a record is one reactive input today (one version-
  vector entry per record). Per-key invalidation (so a one-row mutation doesn't
  invalidate every task reading the record) is a separate, larger change.
