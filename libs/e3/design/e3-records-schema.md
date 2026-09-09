# Design: record schema versioning, migrations, and paged mutation

> Status: **proposal** · 2026-09-04
> Audience: e3 maintainers. Companion to [`e3-records.md`](./e3-records.md)
> (the records spec) and [`e3-records-storage.md`](./e3-records-storage.md)
> (the storage decision record). Resolves the §13 open question *"Redeploy
> onto live record state — keep-if-type-unchanged vs always-reset vs explicit
> migration mutations (`$migrate`)"*, and folds it together with the paged
> read/write story so one mechanism serves both.
> Related issues: #413 (scale large keyed-collection records), #635 (composable
> content addressing), e3-cloud#175/#176/#181.

## 1. Summary

Three problems that look separate are the same problem:

1. **A record's East type is frozen for life.** A redeploy whose record type
   changed is rejected outright (`assertRecordTypesCompatible`,
   `e3-core/src/workspaces.ts:386`). The only escape is `e3 workspace remove`
   — deleting the state *and* the audit chain of a system of record.
2. **Every write rewrites the whole state.** `recordMutate`
   (`e3-core/src/records.ts:196`) reads the whole blob, hands it whole to the
   reducer, and stores the reducer's whole output. Measured at 120k rows: 3.5 s
   of decode+encode CPU for a one-row edit (#413).
3. **Reads page; writes do not.** `getDatasetPage`
   (`e3-api-server/src/handlers/datasets.ts:255`) already serves any window of
   any collection dataset — records included — in O(window) through beast2 v5
   segment geometry. Nothing on the write side uses that geometry.

All three are "the state blob is an opaque monolith". This design makes the
segment the unit of work on the write side too, and expresses schema change in
exactly the same terms:

- **Schema identity is derived, not declared** (§4). A record's schema *is* the
  content hash of its `EastTypeValue`. No new persisted field: the workspace's
  current schema is already recoverable from the prior package's structure, and
  every stored blob is self-describing.
- **A migration is an East function that deploy runs as a mutation** (§5). Same
  `runDetached` kernel, same purity guard, same commit chain, same version
  vector, same GC reachability. A schema change becomes a `$migrate` commit in
  the record's audit history rather than an event that destroys it.
- **Deploy plans the migration path before it touches anything, and is
  all-or-nothing** (§6), with `--plan` for a dry run.
- **One write door, `e3.mutateByPatch`, paged automatically when the record's
  root is a collection** (§7). `PatchType(T)` already addresses what changed —
  keys for Dict/Set, `{key, offset}` for Array — so the engine resolves the
  touched segments and rewrites only those, on the
  `carveBeast2`/`rebuildBeast2`/`spliceBeast2` geometry
  `execution/partitionIo.ts` already wraps. A one-row edit costs one segment,
  and — being generic — needs no reducer process at all.
- **The write is emitted as a composition plan, not a byte stream** (§8), so
  e3-cloud executes it as ranged reads in and `UploadPartCopy` ranges out — the
  unchanged segments never leave S3. This needs a new `ObjectStore.composeFrom`
  and has a hard dependency on #635 for naming a result we never read.
  Superseded by the segment-object layout of §8.7 once that is adopted (see
  the note there).
- **Every content-addressed object lives in S3; DynamoDB holds only pointers,
  revision tokens, leases and the GC catalogue** (§8.6). The ≤ 4 KB
  DynamoDB-inline rule is withdrawn so the platform has one data-at-rest
  surface, and it lands first (S0, §12) so nothing in this design is written
  against a placement branch.

The wire cost is one appended field on `RecordObjectType` and two new object
types (`MigrationObjectType`, `RecordMigrationArgsType`). `RecordCommitType`,
`DatasetRefType`, `PackageObjectType` and the structure encoding are all
unchanged.

## 2. What exists today (audited)

**Schema.** A record's type lives in exactly one place: the `value` leaf of
`PackageObject.data.structure` (`e3-types/src/structure.ts`). `workspaceDeploy`
captures the prior deployment's leaf type (`capturePriorRecords`,
`workspaces.ts:353`), compares it structurally against the new one
(`equalFor(EastTypeType)`), and throws on any difference *before* any
destructive write. Same-type redeploys restore the prior ref verbatim — state
and full history preserved, no marker commit.

**Inputs are not preserved at all.** `workspaceDeploy` does
`datasets.removeAll` then `writeRefsFromPackage` from the *package's* refs, and
`export_` writes each input's declared **default** into those refs
(`e3/src/export.ts:251`). So redeploying a rebuilt source package silently
resets every `e3.input` to its default. Only records survive a redeploy.

**Mutation.** Pure, sync East reducer `(State, ...Args) => State`, platform
calls rejected by a `walkIR` guard (`e3/src/mutation.ts`). `recordMutate` runs
a deadline-bounded CAS loop: read versioned ref → `objects.read` the whole
state → `runDetached` with the state as arg 0 → `objects.write` the whole new
state → write a `RecordCommit` → `datasets.writeIf`. Crash-safe by
construction; objects are invisible until the ref swings.

**Storage.** `encodeDatasetBlob` (`e3-types/src/dataset-blob.ts`) is the single
door: Array/Set/Dict roots are **always** stored segmented + indexed
(`encodeBeast2PagedFor`), at every size; everything else whole. Segments are
self-contained, canonically ordered, byte-addressable, with per-segment fences.

**Geometry.** `libs/east/.../beast2/v5/geometry.ts` supplies
`readBeast2Extents{,Ranged}`, `carveBeast2{,Ranged}`, `spliceBeast2`,
`spliceBeast2Tail`, `rebuildBeast2`. `e3-core/src/execution/partitionIo.ts`
wraps them as `PartitionBlob` (ranged open, fence probe, single-segment decode,
span parts) and `spliceChunks` (streamed splice, O(chunk) memory). Both
`LocalObjectStore` and `InMemoryStorage` implement `objects.readRange`.

**GC.** `extractChildren` (`storage/local/gc.ts:272`) recognizes object kinds by
*exact* decoded field set — `isRecordObjectShape` (`gc.ts:215`),
`isMutationObjectShape`, `isRecordCommitShape`. A record commit pushes `state`
and `args` as leaves and `parent` as non-leaf.

## 3. The gaps

| Gap | Consequence today |
|---|---|
| No schema version anywhere | A type change is unrecoverable except by destroying the record |
| No migration mechanism | The `$migrate` open question in `e3-records.md` §13 is unanswered |
| Redeploy leaves no audit trace | Even a *successful* keep-state redeploy appends no commit |
| Dropped record is silent | A record absent from the new package loses state + history with no error |
| Inputs reset on redeploy | Operator-set input values silently revert to package defaults |
| Whole-value write path | O(n) CPU and O(n) transport per mutation (#413) |
| No paged write | The v5 geometry is used by partitioned execution, never by records |
| No compose primitive | `ObjectStore` offers `write`/`writeStream`/`read`/`readRange?` only, so every byte of an unchanged segment must transit the process — fatal to ranged copies in cloud (§8.1). Composition alternative only — not needed under §8.7, where unchanged segments are never rewritten at all |
| History spans schemas untyped | Nothing marks where in a chain the state type changed |
| Two data-at-rest surfaces in cloud | Objects ≤ 4 KB live in DynamoDB, the rest in S3 — two encryption, audit and retention scopes for one dataset, and a size branch in the object store (§8.6) |

## 4. Schema identity — derived, not declared

```
schemaHash(T) = sha256( encodeBeast2For(EastTypeType)(toEastTypeValue(T)) )
```

The record's schema *is* its type. Nothing new is persisted:

- The **workspace's current schema** is `recordLeafType(priorPkg.data.structure,
  path)` — already read by `capturePriorRecords`.
- The **package's target schema** is the same leaf in the new package.
- The **schema of any historical state blob** is its own beast2 type section:
  `decodeBeast2(data)` returns `{ type, value }`. Blobs are self-describing, so
  a state written under a superseded schema still decodes correctly, forever,
  with no metadata beside it. This is why history survives a migration.

Two notes on the hash:

- Hash equality is *stricter* than `isTypeValueEqual`, which treats a recursive
  `ref(N)` and a `wrapper({id: N, …})` as equal. Keep `equalFor(EastTypeType)`
  as the authority for the "unchanged?" decision — preserving today's exact
  semantics — and use the hash only as a map key, a display token, and the
  migration graph's edge label, with an equality fallback when a lookup misses.
- The hash is stable because `EastTypeValueType` is a v5 well-known schema
  (id 2) and East type values are canonically ordered.

**Type identity is a guard, not a version.** It answers "may this state be read
under this type?" and nothing else. It cannot *order* two changes, and it cannot
express the most common migration in a mature system — the **type-preserving**
one (backfill a field added as `Optional`, normalize casing, drop orphan rows),
where `from` and `to` hash identically. Sequencing therefore needs its own
mechanism (§5.2), and the type hash stays what it is good at: refusing to decode
a state under a type it was not written under.


## 5. Migrations are East functions that deploy runs as commits

### 5.1 Authoring surface

```ts
// packages/e3/src/migration.ts (new)
const roster = e3.record('roster', RosterV3Type, new Map());

const m1 = e3.migration('add_shift_id', roster,
  East.function([RosterV1Type], RosterV2Type, ($, old) => …));

const m2 = e3.migration('split_name', roster,
  East.function([RosterV2Type], RosterV3Type, ($, old) => …),
  { after: m1 });

// Type-preserving repair — no type change at all, so nothing but `after`
// can place it in the sequence.
const m3 = e3.migration('backfill_shift_id', roster,
  East.function([RosterV3Type], RosterV3Type, ($, old) => …),
  { after: m2 });

const pkg = e3.package('planning', '3.0.0', roster, m1, m2, m3, …);
```

`e3.migration(name, record, fn)` mirrors `e3.mutation` exactly: it is collected
by `package_()` onto its owning record (the existing `item.kind === 'mutation'`
branch gains a sibling), and the reducer is subject to the **same guards** —
sync only, no platform calls (`walkIR` for `Platform` nodes). A migration is
run once per deploy rather than retried against fresher state, but purity is
still required: it is what makes a migration replayable, segment-parallel, and
identical local vs cloud.

Unlike a mutation, a migration's input and output types differ, and both are
read off `Expr.type(fn)` — the author never restates a type. There is no
version number to declare.

**Order is declared, never inferred.** Each migration names its predecessor with
`after`, so the sequence is a linked list in the source: refactor-safe (rename
the const and TypeScript follows), diff-legible, and — unlike declaration order
inside `e3.package(...)` — impossible to reorder by accident while tidying
arguments. The first migration omits `after`.

Declaration order is what sequences; types are what *check* it. Both at
`package_()` time, as definition-time errors rather than deploy failures:

- Exactly one migration has no `after`; every other `after` names a migration on
  the same record; no cycles; every migration reachable from the root. Any
  violation is a build error.
- Each step's `from` equals its predecessor's `to`, and the first step's `from`
  is the schema the chain starts at.
- The terminal `to` equals `record.type`. A chain that does not end at the
  record's declared type is a build error naming both types through
  `renderTypeDiff` (`east/src/type_diff.ts`).

A type-preserving step (`from` ≡ `to`) is ordinary and passes every check —
which is precisely what the type-linked scheme could not express.

### 5.2 The applied frontier — what has already run

Declared order says what the sequence *is*. Deploy also needs to know where a
given workspace *is in* it, and that cannot be derived:

- **Not from the type.** A type-preserving step leaves the schema hash
  unchanged, so "did it run?" is unanswerable from the type.
- **Not from the commit chain.** `$migrate` commits do record what ran, but
  `recordCompact` writes a `parent: none` root and drops the chain. Deriving the
  frontier from history would make compaction silently re-run every migration.

So it is persisted, in the one place that already holds this kind of reserved
bookkeeping: a `$`-prefixed slot in the record ref's version vector, exactly
like the `$idem` slot (`e3-core/src/records.ts`). The `$`-prefix keeps it out of
the structural keypath space, so `snapshotInputVersions` never reads it and
dataflow staleness is unaffected. **No wire change** — the version vector is
already `DictType(String, String)`.

The slot holds a rolling chain hash rather than a counter:

```
frontier₀    = ""                                        // genesis, nothing applied
frontierₖ    = sha256( frontierₖ₋₁ ‖ <MigrationObject hash of step k> )
```

Deploy walks the package's declared chain, folding the same rolling hash, and
finds the prefix whose value equals the workspace's stored frontier; the
remainder is the plan. Three properties fall out that a plain ordinal does not
give:

- **Already-applied steps are skipped exactly**, type-preserving ones included.
- **An edited already-applied migration is detected**, not silently ignored: its
  object hash changed, so no prefix matches and deploy fails with "the workspace
  applied a different `split_name` than this package declares" rather than
  drifting. For a system of record this is the difference between an audit trail
  and a story about one.
- **A reordered or removed step is detected** for the same reason.

An ordinal (`schema: 3`) is derived from the matched prefix length for messages
and `--plan` output; it is never the identity, so it cannot be reused or
renumbered into a false match.

`$reset` sets the frontier to the *full* chain hash (the record is now at the
package's schema by definition).

**Every commit path must carry the slot forward — this is not automatic.**
`recordMutate` builds its version vector fresh on each attempt
(`new Map([[selfKeypath, commitHash]])`, plus `$idem` when keyed), and
`recordCompact` does the same. As written, **the first ordinary mutation after a
deploy would erase `$schema`**, and a compaction would erase it too — after
which the next deploy sees an absent slot, classifies the record as legacy, and
refuses. The rule is therefore explicit and must be a test, not a convention:

| Slot | On mutation / compact / `$deploy` |
|---|---|
| self-entry (`.records.<name>`) | rewritten to the new commit hash (today's behaviour) |
| `$idem` | rewritten when keyed, dropped otherwise (today's behaviour) |
| `$schema` | **preserved verbatim** — only deploy ever writes it |

The general form — *reserved `$` slots are preserved unless the writer owns
them* — is worth encoding once in a helper both `recordMutate` and
`recordCompact` call, because the next reserved slot will hit the same trap.

### 5.3 A migration is a mutation deploy happens to run

This is the load-bearing simplification. A migration:

- runs on `runDetached` with the same `DetachedSpec` shape as a mutation
  (`bodyIr`, one arg, runner, limits);
- writes its output with `datasetWrite` / `encodeDatasetBlob`, so a collection
  result is segmented + indexed like any other;
- appends an ordinary `RecordCommit`:

```
parent:   <prior head commit>
state:    <migrated state hash>
mutation: "$migrate:add_shift_id"
args:     some(<hash of RecordMigrationArgs>)
actor:    "system:deploy"
at:       <deploy time>
```

- swings the ref with `datasets.writeIf`, exactly as `recordMutate` does.

Everything downstream therefore works with **no change**: the version-vector
self-entry advances (so downstream tasks recompute), `recordHistory` walks
through it, `snapshotInputVersions` sees a normal root change, `repoGc` roots
the head and walks `parent`, `e3 history` prints it, and the UI's
`Record.bind(...).history` shows it.

The args blob is the only new stored *object*:

```ts
// packages/e3-types/src/record.ts
export const RecordMigrationArgsType = StructType({
  migration: StringType,   // migration name
  from:      EastTypeType, // schema this step read
  to:        EastTypeType, // schema it produced
});
```

It carries no hashes, so GC's existing "args is a leaf" rule stays correct. Its
purpose is to mark **schema boundaries in the chain** without reading a state
blob per commit: a history reader walking backwards knows exactly where the
type changed and what it changed from, so `e3 get --at <commit>` and a
diff/time-travel UI can decode a historical state against the right type
without guessing. (They *could* rely on the blob's self-describing header, but
that is an object read per commit; the boundary markers make it O(boundaries).)

### 5.4 Idempotency slot

`recordMutate` stores the last idempotency key in the reserved `$idem` version
slot. It refers to a state that no longer exists at the head after a migration,
so a post-migration retry would answer `committed` with a stale `stateHash`.
**A migration clears `$idem`.** One line, but the kind of thing that only shows
up under a production retry storm.

## 6. Deploy integration

### 6.1 The plan

`workspaceDeploy` (`workspaces.ts:268`) gains a pure planning phase between
`capturePriorRecords` and the first destructive write — replacing
`assertRecordTypesCompatible`, and preserving its guarantee that a doomed
deploy leaves the workspace untouched.

For each record in the new package, the plan is decided by **two** facts: the
frontier (§5.2) and the type. Neither suffices alone — a type-preserving
migration is invisible to a type comparison, and a type change with no declared
migration is invisible to a frontier comparison.

| Prior | Frontier vs package chain | Plan |
|---|---|---|
| absent | — | `mint` — genesis `$init` from the package's initial value (today's behaviour), frontier set to the **full** chain: a new record's initial value is declared in the record's current type, so every migration is vacuously applied |
| present | equals the full chain, **and** prior type ≡ package type | `keep` — restore prior ref verbatim (today's behaviour) |
| present | equals the full chain, prior type **differs** | typed failure — the type changed with no migration declared (below) |
| present | matches a proper prefix | `migrate` — apply the remaining steps in order |
| present | matches no prefix | typed failure (below) |
| present, record absent from package | — | `drop` — refused unless `--allow-drop-records` |

**The type check does not disappear, and it is not merely a post-condition.**
The frontier answers "which declared steps have run", which is not the same
question as "does the stored state match the declared type" — and with an empty
chain (or a fully-applied one) the two diverge exactly where it hurts: an author
who edits `record.type` and declares no migration has a frontier that still
equals the full chain, so a frontier-only plan would `keep` a state that no
longer matches its declared type. That is precisely the corruption today's
`assertRecordTypesCompatible` prevents, and it must survive. So `keep` requires
**both** conditions, and the type comparison stays `equalFor(EastTypeType)`
against the prior package's structure leaf, exactly as today.

Four typed failures, each naming the fix:

- **frontier complete but the type changed** — the author changed `record.type`
  without declaring a migration for it. This is the common case and deserves the
  best message: render `diffTypes(prior, declared)`, and state that the fix is an
  `e3.migration` whose `after` is the current last step (or `--schema=reset` for
  a scratch workspace).
- **the `$schema` slot is absent** — the record was deployed before this feature
  existed. Note the distinction from a *present* empty frontier, which is a real
  value meaning "nothing applied yet" and legitimately replays the whole chain;
  since `mint` always writes a frontier (table above), absence is unambiguously
  "legacy". Refused, because replaying a chain over state that is already at the
  target shape is silent corruption. Message states the two exits:
  `--schema=adopt` (assert the state already matches, record the full frontier,
  run nothing) or `--schema=reset`.
- **slot present, no matching prefix** — an already-applied migration was
  edited, reordered or removed. Message names the first step that diverges and
  its two object hashes. This is a build/release mistake, never something to
  paper over; there is no flag to force it.
- **workspace ahead of package** — the frontier is longer than the package's
  chain. Rolling a package back over a migrated record is data loss, and is
  refused; the message names the down-migration as the missing piece.

### 6.2 Policy

```bash
e3 workspace deploy <repo> <ws> <pkg> [--schema=migrate|fail|reset|adopt] [--plan]
                                       [--allow-drop-records]
```

- `migrate` (**default**) — apply the plan; fail on any of §6.1's four typed
  failures.
- `fail` — refuse to run any migration (today's behaviour, for locked-down
  environments where migrations go through separate change control).
- `adopt` — record the package's full frontier without running anything. The
  one-time bridge for records deployed before this feature existed, and an
  operator assertion that the live state already matches the declared type. It
  verifies that assertion as far as it cheaply can (decode the state's beast2
  type section and compare against the declared type) and refuses if it does
  not hold.
- `reset` — records that cannot be migrated are reset to the package's initial
  value with a `$reset` root commit (`parent: none`, `actor: system:deploy`) so the
  reset is *itself* audited. Never silent.
- `--plan` — print the plan and exit, running nothing. Per record: current
  schema → target schema, the migration steps, element count and blob size of
  the current state, and the estimated work (segments to rewrite). This is the
  operator's pre-flight; a system of record must not discover its migration
  plan by running it.

### 6.3 All-or-nothing

Deploy holds the **exclusive** workspace lock, so migrations run without CAS
contention. Each step still writes objects before swinging the ref, so a crash
is never torn. But a multi-record, multi-step plan can fail halfway, leaving
some records migrated and some not — while the workspace state file (written
last) still names the old package.

**On any migration failure, restore every touched record's captured prior ref
and abort the deploy.** The prior refs are already in hand from
`capturePriorRecords`; restoring is one ref write per record, and the orphaned
migrated blobs are reclaimed by GC. The workspace is then exactly as it was —
same guarantee the type-change guard gives today, extended over a plan that
actually executes.

### 6.4 A `$deploy` marker for keeps

`e3-records.md` §6.4 flags this gap already: a same-type redeploy appends no
commit, so nothing in the audit chain records that the package under a record
changed — even though a redeploy can change every mutation body and every task
reading it. Append a `$deploy` commit (`state` unchanged, `parent` = prior head)
on every keep; ~300 bytes, and it gives history one vocabulary — `$init`,
`$deploy`, `$migrate:<name>`, `$reset`, `$compact`, `<mutation>`. Like every
commit path, it must preserve `$schema` (§5.2). On by default; see §13 for the
watch-loop volume question.

### 6.5 `e3 watch`

`e3 watch` redeploys on every source save, so under `--schema=migrate` a
type-changing edit to a record fails the loop until a migration exists — the
correct behaviour for a shared workspace, the wrong ergonomics for a scratch
one. `watch` should take the same `--schema` flag and the scaffold's dev script
should pass `--schema=reset`, so the dev loop resets a scratch record loudly
and a shared workspace still refuses. See §12.

## 7. Paged mutation and streamed migration

Reads already page (`getDatasetPage`). This section makes writes page, using
the same geometry, and then reuses that machinery for migrations of large
records — which is what turns migration from "possible" into "possible on a
1.2 GB record".

### 7.1 No new layout flag

`e3-records-storage.md` and #413 work-item D propose a `layout: blob | tree`
discriminant on the record. **It is not needed.** `isCollectionRoot`
(`e3-types/src/dataset-blob.ts`) already decides segmentation for every value
entering the store, at every size, through one door — so "is this record
paged-writable?" is answered by its root type and nothing else. No per-record
configuration, no wire field, and the write path cannot disagree with the
encoder about a given blob. (#413's own comment reaches this conclusion for the
leaf *format*; this design drops the discriminant as well.) The same door
decides the §8.7 layout: a collection root is stored as a manifest over
segment objects at every size, still with no flag.

### 7.2 `e3.mutateByPatch` — one door, paged when it can be

Today's authored surface is `e3.mutation(name, record, fn, config?)` with
`fn: (State, ...Args) => State` (`e3/src/mutation.ts`). It stays exactly as it
is, for logic and invariants. Beside it:

```ts
// any record, any type — no reducer body
const editRoster = e3.mutateByPatch(roster);   // arg: PatchType(RosterType)
```

**`PatchType` already carries the address.** This is the key point, and it makes
a separate keyed/entry surface unnecessary — `PatchType`
(`east/src/patch/type_of_patch.ts`) is a pure type constructor whose collection
arms are *sparse and addressed by construction*:

| Record root | `patch` arm of `PatchType(T)` | What it addresses |
|---|---|---|
| `Dict(K, V)` | `Dict(K, {delete: V \| insert: V \| update: PatchType(V)})` | the touched keys, with insert/delete/update already distinguished |
| `Set(K)` | `Dict(K, {delete \| insert})` | the touched elements |
| `Array(T)` | `Array({key: Integer, offset: Integer, operation: {delete \| insert \| update}})` | the touched rows — **including** the index-shift bookkeeping that makes mid-array inserts and deletes well-defined |
| `Struct` / `Variant` | per-field / per-case `PatchType` | the touched fields |
| scalars | — (`unchanged \| replace` only) | whole value |

So there is no key argument to invent and no per-root-kind reducer shape to
define. Arrays in particular are handled natively, inserts and deletes included,
by a representation East already fuzz-tests (`east/src/patch/fuzz.ts`) — which is
strictly better than the replace-only compromise a hand-rolled index address
would have forced.

**Paging is an implementation detail, not an API split.** `mutateByPatch` is
declared once for any record type; the engine picks the write strategy from the
record's root type (§7.1):

- **collection root, `patch` arm** — walk the patch's touched keys (or row
  indices), bisect the segment fences, group by owning segment, and decode /
  apply / rebuild **only those segments**, byte-copying the rest. O(touched
  segments).
- **collection root, `replace` arm** — a `replace` carries the whole before and
  after, so there is nothing sparse to exploit; falls back to whole-value. (A
  reason for clients to send structural diffs, which `Data.bind`'s `diff()`
  already does.)
- **non-collection root** — whole-value apply. No worse than today.
- **`unchanged`** — still commits, preserving the deliberate no-ABA rule
  (`e3-records-storage.md`): an identical-state write must still advance the
  commit hash so downstream tasks re-run.

Append falls out with no special surface: an `Array` patch whose insert ops all
sit at the tail touches only the final segment, so the engine takes the cheapest
possible path (emit existing bytes to `segmentsEnd`, one new frame, fresh
`spliceBeast2Tail`) without anyone declaring an "append mutation".

**Why splitting a patch across segments is sound — and where it is not
trivial.** The whole design rests on being able to apply *part* of a patch to
*part* of the collection and get the same answer as applying all of it to all of
it. That holds for different reasons per root kind, and the Array case needs
real care:

- **Dict / Set — per-key independent.** The `patch` arm is a map from key to
  op, and no op reads another key. A patch therefore decomposes over *any*
  partition of its key set, so bucketing keys by owning segment and applying
  each bucket to its segment is exactly equivalent to the whole-value apply.
  This is the property that makes the whole scheme work, and it is worth a
  property test (whole-apply ≡ segment-wise apply, over generated patches)
  rather than an assumption.
- **Array — positions must be resolved first.** Entries carry `{key, offset,
  operation}`, where `offset` accounts for the net inserts and deletes *before*
  that entry. Bucketing by `key` naively is wrong. The engine must first walk
  the patch in order, running the offset accumulator to resolve each entry's
  **absolute source row**, and only then bucket those rows by segment. Inserts
  and deletes then change segment element counts — which shifts every later
  segment's row range but not its bytes, and the rebuilt index section records
  exactly that. Cheap (the patch is small), but a step that must exist; omitting
  it silently corrupts.

**No reducer means no process spawn.** Because the operation is generic, e3-core
applies the patch **in-process** with `applyFor(type)` per touched segment —
there is no `runDetached`, no runner selection, no scratch dir, no spawn. For an
interactive row edit that removes the dominant fixed cost outright: the write is
one segment decode, one segment encode, and a byte-copy splice.

(The authored path keeps full generality: `East.applyPatch` is a real builtin on
**all three runtimes** — TypeScript `compile.ts:1366`, east-c
`builtins/patch.c:1473`, east-py through the C bridge `namespace.py:1888` —
alongside `Diff` / `ComposePatch` / `InvertPatch`. So an `e3.mutation` may take
`PatchType(T)` as an ordinary argument and apply it itself when it wants to
validate first.)

**Conflict detection, for free.** `applyFor` raises `ConflictError` when the base
does not match a `replace` op's `before` (`east/src/patch/apply.ts:49`). Under
the CAS retry loop that means a **stale patch is rejected rather than clobbering
a concurrent edit** — records go from last-writer-wins to detectable-conflict on
exactly the surface where two planners edit the same row. `validatePatchFor`
gives the non-throwing, per-leaf form for a preview endpoint before commit.
(`RecursiveType` is replace-only in the patch system, so a patch over a recursive
row degenerates to whole-subtree replace — bounded by the row.)

**The audit trail gets strictly better.** `RecordCommit.args` already points at
an encoded args blob, so the commit stores **the patch itself**: history records
what changed, not merely which mutation ran. For a system of record that is a
real upgrade at zero wire cost. The `replace`-op doubling (before *and* after) is
the price, bounded by what actually changed.

**Opt-in, not universal.** `mutateByPatch` is declared per record and passed to
`e3.package` like any mutation, rather than being an implicit verb on every
record. A record whose whole point is that writes go through validated
mutations must be able to *not* offer a generic patch door — "mutations are the
only door, and the author chooses the doors" is the property that makes records
a system of record.

**This does not relitigate `e3-records-storage.md`.** That decision rejected
patches as *storage* (replay-to-read; `replace` storing both sides). Here the
commit still stores the whole new state; the patch is the argument and the
segment write is a byte splice. Orthogonal.

**Execution, per CAS attempt.** Note there is no step that materializes the
state and no step that spawns anything:

1. `PartitionBlob.open(storage, repo, stateHash)` — head + tail reads only.
2. Read the patch's touched keys / row indices; bisect the segment fences
   (`Beast2Pages.get`'s fence bisect, `PartitionBlob.fence`) and group them by
   owning segment. A patch **is** the batch — a save touching 50 scattered rows
   of a 741-segment blob resolves to at most 50 segments, usually far fewer, and
   costs one commit, not fifty.
3. Per touched segment: ranged-read and decode **that segment only**, then
   `applyFor(type)` its sub-patch in-process.
4. Rebuild the edited segments under the source's *exact header bytes*, so the
   result splices byte-compatibly. Note this is the **ranged** rebuild of §8.4,
   not today's `rebuildBeast2`, which takes the whole source blob.
5. Emit a **composition plan** — alternating `copy` ranges of the source object
   and `bytes` for the rebuilt segments and the tail (§8.1). A local backend
   streams it through `writeStream`; an S3 backend executes the `copy` parts as
   `UploadPartCopy`, so untouched segments never transit the process at all.
   Nothing is decoded or re-encoded either way.
6. One `RecordCommit` (args = the patch) + one `writeIf`. A batch is never
   observable half-applied.

Under the §8.7 layout steps 1, 4 and 5 read differently: open the **manifest**
(one small object read) instead of head + tail ranges; rebuild each touched
segment as a standalone **segment object** under the manifest's pinned header;
write those objects plus a new manifest. There is no composition plan and no
ranged rebuild. §8.7 gives the step-by-step form and §8.8 the costs.

The state never enters a runner payload and is never held whole in the API
process, which subsumes #413 work-item A's `{ objectHash }` arg form for this
path — there is nothing large left to pass by reference.

Measured shape (#413 comment, 120k-row `Dict<String, deep Struct>`): **47 ms vs
3,481 ms** for the whole-value cycle, before removing the process spawn. The
whole-value term grows with row count (~20 s at 729k rows); the segment term
does not.

**Segment split/merge.** Inserts grow a segment, deletes shrink it. Split a
rebuilt segment exceeding 2× `BEAST2_PAGED_TARGET_BYTES_DEFAULT` (2 MiB) or 2×
`BEAST2_PAGED_BATCH_DEFAULT` (1000 elements) at its median key — free, since
`rebuildBeast2` already takes an *iterable of batches*; merge with the follower
below ½. Constants pinned and parity-fixtured local↔cloud (inherited from #413
D2). The result is a self-balancing one-level index over segments — the prolly
tree of the storage decision record, on a format that already exists and is
already compliance-tested in all three runtimes. Under §8.7 rule 3 the boundary
is content-defined: split and merge are simply what re-running the rule over the
edited segment's keys yields, and the pinned minimum and maximum bounds play the
role of the ½ and 2× limits above — so segmentation stays a pure function of the
value, never of edit history.

**Canonical-order safety.** `Beast2Writer` validates strict ascent within and
across batches, `spliceBeast2`/`spliceChunks` require byte-identical headers and
self-contained segments, and paging readers verify fences before trusting them.
The write path must additionally verify the boundary fences of the segments
adjacent to an edit — two element decodes — turning a latent corruption into an
immediate typed failure.

### 7.3 Streamed migrations

The same geometry answers "how do you migrate a 1.2 GB record without
materializing it".

```ts
e3.elementMigration('widen_row', roster,
  East.function([RowV1Type], RowV2Type, ($, row) => …));
```

A `Dict(K, V1) → Dict(K, V2)` migration whose **keys are unchanged** is an
element-wise map, so deploy can walk it segment by segment: decode a segment,
map it, `Beast2Writer.write` the batch, stream on. Memory is O(segment), and the
writer's ascent validation is satisfied by construction because key order is
preserved — the output is canonical without a sort. Under the §8.7 layout each
mapped segment is written as its own segment object and the new manifest is
assembled last, so segments can be mapped in parallel and a migration that dies
halfway resumes by skipping segments whose output object already exists.

**The spawn cost is the trap here, and it is not small.** `runDetached` is
one-shot — marshal args, spawn, read the output file — so the naive reading of
"segment by segment" is *one process per segment*. A 1.2 GB record is 741
segments (#635's measurement); at even 30 ms of spawn and marshalling each,
that is ~22 s of pure overhead before any work, and it grows with the record.
Three ways out, and the choice matters:

- **Lift the element function into a batch program (recommended).** The author
  declares `(V1) => V2`; deploy wraps that IR in a generated
  `(Dict(K,V1)) => Dict(K,V2)` that maps over the batch — an ordinary East
  expression built from the author's own IR at plan time. Then it is *N segments
  per spawn*, on the author's declared runner, with the batch size chosen
  against a memory budget. No new machinery, spawn cost amortized to nothing.
- **Compile and run it in e3-core, in-process.** Migrations are guarded pure, so
  no platform calls exist and any runtime is *semantically* equivalent — zero
  spawns. **Rejected as a silent default**: cross-runtime semantic parity is
  asserted but not currently airtight (see the open east-c ↔ TypeScript
  divergences #675, #676, #677), and a migration is a one-time, irreversible
  transformation of a system of record. Running it on a runtime the author never
  tested against is the wrong place to spend that risk.
- **A streaming "map mode" runner entry point.** Fastest and cleanest in the
  limit; needs a new runner protocol in all three runtimes. Not worth it before
  the batched form is measured.

A migration that **changes keys** (`Dict(K1,V1) → Dict(K2,V2)`) cannot stream —
the output must be re-sorted, which is an external sort. Rule: key-changing
migrations take the whole-value path, and are refused above a configured state
size with a message pointing at the honest alternative (rebuild the record from
a task, deploy it as the new record's initial value). Stating the boundary beats
discovering it at 20 s of reducer CPU.

The whole-value form (`e3.migration`) stays the default for scalar, struct and
small-collection records — the overwhelmingly common case.

### 7.4 Ordering and atomicity, stated

Neither `e3-records.md` nor the code states these plainly, and the paged write
path makes them load-bearing:

- **Within one record, mutations are totally ordered by the CAS, not by arrival.**
  `recordMutate` reads `{ref, revision}`, reduces against exactly that state, and
  `writeIf`s on that revision. A loser re-reads the new head and re-runs the
  reducer against it. The winner order is whoever's conditional write lands
  first — serializable, but not FIFO and not fair: under sustained contention a
  writer can lose until its deadline and return `conflict`. The `parent` chain is
  the durable record of the order that actually happened.
- **Across records there is no order and no atomicity.** Mutations on different
  records never contend and never commit together. Multi-record transactions
  remain the v2 item in `e3-records.md` §11.
- **Client launch order is not commit order.** `Record.bind` exposes one shared
  latest-wins mutate channel per record; a superseding call cancels the client's
  wait, not the server's in-flight reducer.
- **A migration plan is sequential per record under the exclusive deploy lock**,
  so its steps cannot interleave with mutations or with each other.

### 7.5 What the reducer sees

`e3.mutateByPatch` runs no reducer at all — e3-core applies the patch
in-process — so it introduces no runtime concept anywhere. Authored
`e3.mutation` bodies and element migrations still receive a *value*, not a
handle, so the frozen-task-input contract (#539) and the copy-first rule apply
unchanged; the runner still receives beast2 files and writes a beast2 file. Only
the orchestration around it changed.

## 8. Cloud mapping — ranged reads and ranged copies

§7.2 describes the *what*; this section is the *how* for e3-cloud, because the
cloud constraint (ranged reads in, ranged copies out) is what the abstraction
has to be shaped around — and today's abstraction is the wrong shape. §8.1–§8.4
develop the **composition alternative** (one blob per state, spliced with
server-side copies); §8.6–§8.8 are the **target state**, under which §8.1–§8.4
are not needed.

### 8.1 The abstraction is wrong: a byte stream cannot express a ranged copy

`spliceChunks` (`execution/partitionIo.ts`) yields an `AsyncIterable<Uint8Array>`
into `objects.writeStream`. Locally that is fine: untouched segments are read
from disk and written back without decoding — no CPU, but O(N) IO. In cloud it
is fatal to the whole point: every untouched byte would be `GetObject`'d into
the Lambda and `UploadPart`'d back, paying egress, ingress, time and memory for
data that never changed.

The cloud primitive is `UploadPartCopy`: an S3 multipart part sourced from a
byte range of another S3 object, copied **server-side**, never transiting the
caller. So the write path must produce a *declarative plan* the backend
executes, not a stream the backend consumes:

```ts
// e3-core/src/storage/interfaces.ts
export type ComposePart =
  /** Bytes copied from an existing object, server-side where the backend can. */
  | { kind: 'copy'; hash: string; offset: number; length: number }
  /** Literal bytes supplied by the caller. */
  | { kind: 'bytes'; data: Uint8Array };

export interface ObjectStore {
  // … existing write / writeStream / read / readRange? / exists / stat …

  /** Compose a new object from ranges of existing objects plus literal bytes.
   *  Returns the new object's address. Optional: backends without it fall
   *  back to materializing the parts through `writeStream`. */
  composeFrom?(repo: string, parts: ComposePart[]): Promise<string>;
}
```

`LocalObjectStore` implements it by reading each `copy` range and writing it
through (identical bytes, identical address — so the compliance suite pins both
backends to one result); an S3 store maps `copy` → `UploadPartCopy` and `bytes`
→ `UploadPart`. This is the `composeFrom?()` that #635's "To build" list
already names, given a concrete first consumer.

A `mutateByPatch` write therefore emits, for a patch touching segments *i* and
*k*:

```
copy   [0, offsets[i])                 header + tag + untouched segments
bytes  rebuilt segment i
copy   [segEnd(i), offsets[k])         untouched run
bytes  rebuilt segment k
copy   [segEnd(k), segmentsEnd)        untouched tail run
bytes  spliceBeast2Tail(...)           terminator + rebuilt index + footer
```

Every `offset` comes from the extents the tail read already gave us. Nothing
else is known about the copied bytes, and nothing else needs to be.

### 8.2 Naming the result without reading it (#635, sharpened)

e3 addresses an object by the SHA-256 of its bytes, so composing bytes we never
see means we cannot name the result — we would `UploadPartCopy` server-side and
then download the whole object to hash it, defeating the exercise. #635's
structural-leaf address is the answer, and this design composes under it
exactly:

- leaves are `[header+tag]`, one per segment frame, `[tail]` — precisely our
  part boundaries;
- the address is `H(DOMAIN ‖ leafCount ‖ H(leaf₀) ‖ … ‖ H(leafₙ))`, over leaf
  **contents and count**, not offsets — which is why a splice that shifts every
  segment leaves each unchanged segment's leaf digest intact;
- so the new address needs: the source's per-leaf digests (inherited for every
  copied segment), plus digests we compute ourselves for the rebuilt segments
  and the tail — which we have in hand, because we built those bytes.

**Zero copied bytes are read to name the result.** Without #635 the cloud half
of §7 is not buildable at all; the local half is unaffected.

**This design votes for the in-container form of #635's open decision.** #635
asks whether the leaf digests live beside the object or inside the v5 index
section, noting the two changes are "cheaper together than apart". For this
workload the answer is clear: a paged write **already reads the blob's tail**
(footer + index) to get the segment geometry. If the digests are in the index
section they arrive in that same ranged read, at zero extra requests, for both
the read side and the compose side. Beside-the-object costs one additional GET
per write, per read, and per compose, forever, on the hottest path in the
system.

### 8.3 The 5 MiB floor is the real engineering constraint

S3 requires every multipart part except the last to be ≥ 5 MiB (max 10,000
parts). Segments target 2 MiB (`BEAST2_PAGED_TARGET_BYTES_DEFAULT`) and are
frequently *far* smaller — #635 measured a ~12 KB mean frame at 400k rows,
because the 1000-element batch cap binds long before the byte target for narrow
rows. So **one segment cannot be one part**, and the plan must be coalesced:

1. Merge adjacent `copy` parts into single ranges (always sound — they are
   contiguous ranges of the same object).
2. A coalesced `copy` run ≥ 5 MiB becomes an `UploadPartCopy`.
3. A coalesced `copy` run **< 5 MiB** cannot be a non-final part. It degrades:
   ranged-`GetObject` those bytes and fold them into the adjacent literal part.
   The transfer is bounded by the *gap*, not the object.
4. If the whole object is below the multipart floor, skip multipart entirely —
   a plain ranged read + `PutObject` is fewer round trips than
   `CreateMultipartUpload` + parts + `Complete`.

The degradation in (3) is why the *shape* of an edit matters, and here the
format works in our favour: **segments are canonically key-ordered, and real
edit sets are contiguous in key order** — a UI saves a page of rows, an
integration writes a key range, a planner edits one team's roster. Those
produce one touched run and two large copy runs, the best case for
`UploadPartCopy`. Pathologically scattered edits (one row in each of 50
segments spread across the object) degrade toward transferring the gaps, which
is still bounded by the gaps and never worse than today's whole-blob rewrite.

### 8.4 Ranged rebuild — a concrete gap in the geometry API

`rebuildBeast2(headerSource, batches, options)` takes the **whole source blob**
and, without pre-read extents, calls `readBeast2Extents` on it — which needs the
whole blob. A cloud writer has no whole blob, only `Beast2RangedExtents`
(head bytes + geometry from two ranged reads).

The pieces exist: `Beast2Writer` already accepts a `headerPrefix` and verifies
its wire type, and `Beast2RangedExtents.head` is exactly that prefix. What is
missing is the **source map**: `rebuildBeast2` re-parses it from the header so
re-encoded function values resolve their stacks against the header the result
carries verbatim, and `readBeast2ExtentsRanged` *parses the map and then throws
it away*, returning only `sourceMapEmpty` (`geometry.ts`, the
`readSourceMapSectionV5(headReader)` call whose result reaches the return object
only as a boolean).

So: **return the parsed `SourceMap` from `readBeast2ExtentsRanged`** and add a
ranged rebuild built on `Beast2Writer({ headerPrefix: extents.head, sourceMap })`.
Both are small and local to `east`. Until then the safe subset is
`sourceMapEmpty` blobs — which is every record whose state holds no function
values, i.e. effectively all of them — but relying on that silently would be
exactly the kind of latent constraint that surfaces as a corrupt blob later.

### 8.5 Retry, crash-safety, and what the Lambda holds

- **CAS retry is cheap.** A conflict means the head is a different object, so
  the plan is recomputed — but that is one head + tail ranged read plus the
  touched segments, not a whole re-read. The patch argument is unchanged, and
  `applyFor` now raises `ConflictError` if the concurrent writer touched the
  same entries: the retry surfaces a real conflict instead of silently winning.
- **Crash-safety is unchanged.** An incomplete multipart upload is invisible;
  the ref never swings; nothing is torn. It does need an
  `AbortIncompleteMultipartUpload` lifecycle rule so abandoned uploads do not
  accrue storage — an operational item, not a design one.
- **The Lambda never holds the state.** Payload in is the patch; work is ranged
  reads of the touched segments; output is a composed object plus a commit. This
  removes the 6 MB synchronous-invoke cap that #413 identifies as an outright
  production failure at ~100–130k rows, rather than merely raising it.
- **Placement never gates the path (§8.6).** Every object lives in S3 at every
  size, so the write strategy is chosen by the root type alone (§7.1):
  non-collection roots take the whole-value path, collection roots take the
  segment path. Whether a given write uses server-side copies or a plain put is
  the backend's decision under §8.3, not a consequence of where the object is
  stored.

The rest of the cloud mapping is unchanged from `e3-records.md` §10: the CAS is
a DynamoDB conditional `PutItem` on the ref, and commits (~300 B) are ordinary
S3 objects like every other object — the DynamoDB-inline placement is withdrawn
in §8.6.

### 8.6 Placement policy — DynamoDB holds pointers, S3 holds every object

**Normative.** Applies to every e3-cloud backend from the round of changes that
ships S1, and supersedes the "objects ≤ 4 KB are inlined in DynamoDB" rule in
`e3-records.md` §10.

| Store | Holds | Never holds |
|---|---|---|
| **S3** | every content-addressed object `objects.write` / `writeStream` produces, at every size: states, segment and manifest objects, commits, args and patches, mutation and migration bodies, package and tree objects, execution logs | mutable state of any kind |
| **DynamoDB** | dataset refs (`hash`, `revision`, version vector); package refs, workspace state, execution status, dataflow runs; lock leases; the object catalogue (`hash`, `size`, `lastModified`) that GC scans | object bytes, or any field that can quote customer data |

The line is *content-addressed → S3; keyed and mutable → DynamoDB*. It is a
security-scoping decision first and a simplicity decision second:

- **One data-at-rest surface.** Customer data lives in one bucket under one KMS
  key, one bucket policy, one CloudTrail data-event stream, one replication and
  retention story. A security evaluation scopes one service, and DynamoDB is
  assessed as a pointer-and-lease table rather than as a data store.
- **One object-store code path.** No size branch, so no "small states take the
  whole-value path because they live in DynamoDB" special case (§8.5 as first
  drafted). Placement can never influence encoding, paging or GC.
- **WORM for the audit chain becomes possible.** S3 Object Lock can make commit
  and state objects undeletable for a retention period — a real
  system-of-record property no DynamoDB item offers. It is an option to design
  for (GC below), not one to switch on blindly.
- **The historical reason is gone.** Inlining kept the hot path off S3 when S3
  read-after-write was eventually consistent. S3 has been strongly consistent
  for new-object reads since December 2020; the remaining argument was latency
  alone, priced below.

**Cost, stated.** Typical in-region figures, not measurements:

| Operation | With inlining | S3 only |
|---|---|---|
| Collection save under the segment path | 100–250 ms | unchanged — the commit put runs in parallel with the state puts |
| Small-record mutation (counter, workflow state) | 30–60 ms + reduce | 80–150 ms + reduce |
| History page of 50 commits | ~0.5 s | 1–2 s: a sequential parent walk. Commits are immutable, so an in-process cache keyed by hash removes most of it |
| A million small objects | ~$1 of DynamoDB writes | ~$5 of S3 puts |

Human-driven writes absorb this. A machine-hammered counter is the one workload
that notices, and `e3-records.md` §10 already tells such writers to keep records
small. If small-object latency ever becomes binding, S3 Express One Zone offers
single-digit-millisecond reads inside the same S3 surface — as a single-AZ cache
tier in front of the durable bucket, never as the store of record.

**Metadata that can quote data moves too.** The rule is applied to what remains
in DynamoDB: execution status (diagnostics, stderr excerpts), dataflow run
records, the encoded workspace state, and lock holder info. Any payload that can
carry user-supplied text is written as an object and the item keeps its hash.
The log store is S3-backed under the same rule.

**GC and restore.** Three requirements follow:

1. `gcDeleteObjects` treats an Object Lock retention refusal as *skip*, not
   failure, so a locked audit chain and a running GC coexist.
2. GC gains a **retention window** distinct from `minAge` (which only protects
   in-flight writes): an object unreferenced for less than the window is not
   swept, using the `lastReferencedAt` the concurrent-GC design already tracks.
3. The retention window is ≥ the DynamoDB point-in-time-recovery window the
   deployment relies on. A ref restored to time *T* resolves only if every
   object it names still exists; objects are never mutated, so this is the
   single invariant a restore needs.

**Code changes.** None in this monorepo beyond documentation: e3-core's
`ObjectStore` is placement-agnostic and the compliance suite pins behaviour, not
placement. In e3-cloud:

- the S3+DynamoDB object store writes every object to S3 and drops the inline
  branch; the catalogue item per object stays, because GC scans it;
- a one-off, idempotent backfill copies existing inlined objects to S3 (same
  bytes, same hash), with reads falling back to the inline column until the
  backfill completes, after which the column is removed;
- a test asserts that no DynamoDB write made by the object store carries object
  bytes — the property the evaluation depends on, checked in CI rather than by
  review.

**Staging.** S0 in §12 — independent of S1–S4 and lands first, so the paged
write path is never written against a size branch that is about to disappear.

### 8.7 Target-state flow — one row of a 200k-row record (segment-object layout)

**Normative target state for the collection write path**, stated end to end so
the roles of Lambda, DynamoDB and S3 are unambiguous. It assumes the
**segment-object layout** below — the prolly tree `e3-records-storage.md`
decided on, realised on the v5 segment format that now exists. Where this layout
is adopted, §8.1–§8.4 (the composition plan, `UploadPartCopy`, the 5 MiB
coalescing, the ranged rebuild) are not needed and the first bullet of §10 no
longer applies; they stay in this document as the considered alternative until
§7–§8 are rewritten against the layout.

**The layout, in five rules.**

1. **A collection state is a manifest object naming N segment objects.** The
   ref's `value.hash` names the manifest. Every reader resolves it through one
   opener door beside `encodeDatasetBlob` — dataset get, paging, task-input
   marshalling, export, the UI read path — which is the whole footprint of the
   change in this monorepo.
2. **A segment object is a standalone v5 blob**: header, one frame of ~1,000
   rows, terminator, index, footer — exactly what `carveBeast2` produces. Any
   existing reader in any runtime opens it, and materialising a whole value for
   a runner is `spliceBeast2` over the segments.
3. **Boundaries are content-defined.** A segment ends where a pinned hash of the
   encoded key matches a pinned pattern, within pinned minimum and maximum
   bounds, identically in all three runtimes. Segmentation is then a pure
   function of the value, never of edit history: equal values produce equal
   manifests, and two states diff in O(changed segments).
4. **The manifest carries now what a second index level and a changed boundary
   rule will need** — BEAST2 is positional, so adding these later is another
   dual-decode tier:

```ts
// packages/e3-types/src/collection-manifest.ts (new)
export const CollectionManifestType = StructType({
  kind:    StringType,      // "$segments" — GC recognizer tag (the $chunk envelope of e3-records-storage.md)
  level:   IntegerType,     // 0: entries are segment objects; n: entries are level n-1 manifests
  type:    EastTypeType,    // root collection type — self-describing, as a blob's type section is
  rule:    StringType,      // boundary-rule id + constants version the segments were cut under
  header:  StringType,      // hash of the canonical header bytes every segment is written under
  entries: ArrayType(StructType({
    hash:  StringType,      // segment (or child manifest) object hash
    fence: BlobType,        // first key, beast2-encoded; empty for Array roots
    count: IntegerType,     // elements (pairs) in the segment / subtree
    bytes: IntegerType,     // object size, so a reader budgets without stat()
  })),
});
```

5. **GC lands with the layout or not at all.** `isCollectionManifestShape`
   pushes every `entries[].hash` (leaf at level 0, non-leaf above) and `header`;
   `isRecordCommitShape` flips `state` to **non-leaf**; every dataset ref's
   `value.hash` is walked the same way. Survival fixtures in the same change, as
   §9.2 demands.

**Sizes used below** were measured with the v5 paged encoder (deflate, the
default) on a 12-field plan row: 53 B/row, so 200k rows ≈ 10 MiB in ~200
segments of ~52 KiB, and a manifest of ~60 B per entry ≈ 12 KiB. Latencies are
typical in-region figures, not measurements.

**The flow.** One planner updates one row of `records/plan`. `M_n` is the current
manifest, `C_n` the head commit, `r_n` the ref's revision, `F` the `$schema`
frontier (§5.2), `P` the patch.

```
WHO      STEP  ACTION                                                    BYTES
-------  ----  --------------------------------------------------------  -------
CLIENT    1    POST patch P: one key, one update op                      ~200 B
LAMBDA    2    authn -> actor; decode P as PatchType(Plan); $idem check
DYNAMO    3    acquire workspace lock, shared mode (lease item)
DYNAMO    4    GetItem ref "records/plan", consistent read               <1 KiB
               -> hash M_n, versions {self C_n, $schema F}, revision r_n
S3        5    GET manifest M_n                                          ~12 KiB
               -> 200 entries {segment hash, fence key, count, bytes}
LAMBDA    6    bisect fences for key PLN-0123456 -> segment 123
S3        7    GET segment S123                                          ~52 KiB
LAMBDA    8    sha256(bytes) == S123; decode one frame -> 1,000 rows
LAMBDA    9    applyFor(Dict)(rows, sub-patch); stale replace -> conflict
LAMBDA   10    re-encode under pinned header -> S123'; sha256            ~52 KiB
LAMBDA   11    M_n+1 = M_n with entry 123 -> S123'; sha256               ~12 KiB
LAMBDA   12    C_n+1 = {parent C_n, state M_n+1, mutation, args P, ...}  ~300 B
S3       13    PUT S123', M_n+1, P, C_n+1  (four puts, in parallel)      ~65 KiB
DYNAMO   14    BatchWrite 4 catalogue rows {hash, size, timestamp}       <1 KiB
DYNAMO   15    conditional PutItem ref = {M_n+1, self C_n+1, $schema F}
               expect revision r_n  ->  ok r_n+1  |  conflict -> step 4
DYNAMO   16    release lock
CLIENT   17    <- committed {C_n+1, M_n+1}                               ~300 B
LAMBDA   18    dataflow loop: self-entry changed -> dependent tasks run
```

Steps 3–12 are the read-and-compute half and touch nothing durable. Step 13
writes objects that are invisible until step 15 swings the ref. Manifests and
segments are immutable, so both may be served from an in-process cache keyed by
hash on a warm Lambda; step 4 is the only read that must be strongly consistent.

**Per service, for the whole mutation:**

```
DYNAMO   lock acquire + release, 1 consistent read, 1 conditional write,
         4 catalogue rows. Never any object bytes (§8.6).
S3       2 GET (~64 KiB), 4 PUT (~65 KiB). Every object immutable.
LAMBDA   ~5 ms CPU over 1,000 rows. Peak record data in memory ~70 KiB.
         The 200k-row state is never read, decoded, or sent anywhere.
```

**Compared with today's whole-value path** on the same record:

| | Today | Target |
|---|---|---|
| Bytes read | 10 MiB | ~64 KiB |
| Bytes written | 10 MiB | ~65 KiB |
| CPU on the record | decode + encode 200k rows, ~1.4 s on a dev box, in a spawned runner | ~5 ms, in process |
| S3 requests | 1 GET + 1 PUT | 2 GET + 4 PUT |
| New storage per commit | 10 MiB | ~65 KiB — the two manifests share 199 of 200 segments |
| Cloud outcome at this size | fails on the 6 MB invoke payload cap | ~150–200 ms warm |

**What each guarantee rests on.**

- **Crash safety.** Nothing before step 15 is visible. A crash at any point
  leaves at most four orphan objects for GC. The ref swing is one conditional
  write, so the record is never torn.
- **Concurrency.** A conflict at step 15 restarts from step 4 with the same
  patch and re-reads ~64 KiB, never the record. If the other writer changed the
  same row, step 9 raises `ConflictError` instead of overwriting it. The lock is
  shared, so dataflow keeps running and only a deploy fences this out.
- **Retries.** A client retry carrying the same idempotency key returns the
  existing commit at step 2 without touching S3. Content-addressed puts are
  idempotent, so a half-completed step 13 re-run writes the same objects.
- **Integrity.** The segment's bytes are verified against its own hash before
  they are decoded — which a ranged read of one large blob can never offer,
  because no digest exists for a byte range.
- **History.** `M_n` and `S123` stay reachable through `C_n+1.parent`, so the
  previous state is still readable. Compaction plus GC with the §8.6 retention
  window reclaims them later.

**Insert and delete differ in two places only.** The bisect finds the segment
whose fence range owns the new key — the tail segment for a sequential id. After
the apply, the boundary rule is re-run over that segment's keys: roughly one
insert in a thousand lands on a boundary and splits the segment into two manifest
entries, and a delete that shrinks a segment below the minimum merges it with its
neighbour at the cost of one extra segment read. Everything else is identical.

### 8.8 Expected behaviour — what a commit stores, and what each operation costs

Stated as expected behaviour so the two likeliest misreadings of §7–§8.7 are
closed off in the spec itself.

**A commit stores the complete resulting value. The patch is an audit record,
and nothing is ever reconstructed by replaying patches.**

```
C_n+1 = { parent: C_n, state: M_n+1, args: P, mutation, actor, at }
                              |            |
                 the complete resulting    the patch, kept for the
                 value: manifest M_n+1     audit trail only. No read
                 -> all 200 segments       path ever opens it to
                                           serve state.
```

- Every commit's `state` names a complete value. Under §8.7 that value is a
  manifest listing all N segments, most of which are the same objects the
  previous state named. That sharing is why a full-value commit costs ~65 KiB
  rather than 10 MiB — and it is **not** delta storage: each manifest is a
  self-contained description of the whole record.
- A page read or key lookup follows the ref to the current manifest, then to
  one or two segments. Commits and patches are never touched.
- Reading history at an older commit follows that commit's `state` to its
  manifest — same path, no replay. `e3 get --at <commit>` is one manifest read
  plus the segments wanted.
- If every patch object were deleted, every state past and present would read
  identically; `args` is a GC leaf precisely because nothing depends on it.
- Compaction writes a new root commit pointing at the current state and folds
  nothing.
- This restates `e3-records-storage.md` ("Considered and deferred: patch
  storage per commit" — *reconstruct = replay the chain, wrong trade for a
  queryable system of record*) and §7.2 above. The patch under `args` adds only
  a better audit trail.

**Per-operation cost on a 200k-row plan record.** Sizes as in §8.7. Every
mutation follows §8.7's 18 steps and only *k*, the number of segments touched,
varies: each touched segment costs one GET, ~5–7 ms of CPU to decode and
re-encode its ~1,000 rows, and one PUT. Fixed per mutation: one manifest GET,
three small PUTs (manifest, patch, commit) and five DynamoDB operations.
Latencies are warm-Lambda, in-region, typical figures.

| Scenario | k | S3 requests | S3 bytes in / out | Rows decoded + re-encoded | DynamoDB | Warm latency | New storage |
|---|---|---|---|---|---|---|---|
| Delete one key | 1 | 2 GET, 4 PUT | 64 KiB / 65 KiB | 1,000 of 200,000 | 1 read, ~7 writes | 150–200 ms | ~65 KiB |
| Delete that takes a segment below its minimum bound (rare) | 2 | 3 GET, 4 PUT | 116 KiB / 117 KiB | 2,000 | 1 read, ~8 writes | 150–200 ms | ~117 KiB; manifest one entry shorter |
| Add one key | 1 | 2 GET, 4 PUT | 64 KiB / 65 KiB | 1,000 | 1 read, ~7 writes | 150–200 ms | ~65 KiB |
| Add one key that lands on a boundary (~1 in 1,000) | 1 | 2 GET, 5 PUT | 64 KiB / 65 KiB | 1,000 | 1 read, ~8 writes | 150–200 ms | ~65 KiB; manifest one entry longer |
| Modify two rows in the same segment | 1 | 2 GET, 4 PUT | 64 KiB / 65 KiB | 1,000 | 1 read, ~7 writes | 150–200 ms | ~65 KiB |
| Modify two rows in different segments | 2 | 3 GET, 5 PUT | 116 KiB / 117 KiB | 2,000 | 1 read, ~8 writes | 150–200 ms | ~117 KiB |
| One save touching 50 scattered rows | ≤ 50 | 51 GET, 53 PUT | 2.6 MiB / 2.6 MiB | 50,000 | 1 read, ~56 writes | 0.5–0.6 s, CPU-bound | ~2.6 MiB |
| Read one page of 50 rows, or one key lookup | 1–2 | 2–3 GET | 64–116 KiB / 0 | 1,000–2,000 | 1 read | 60–100 ms | 0 |
| Today's whole-value path, any of the above | 200 | 1 GET, 1 PUT | 10 MiB / 10 MiB | 200,000 | 1 read, ~4 writes | fails in cloud on the 6 MB payload cap; ~2 s locally | 10 MiB |

Notes. Sequential plan ids always land in the tail segment, so adds never
scatter; random ids scatter one segment per add. The 50-row save is CPU-bound:
its GETs and PUTs run in parallel and cost about one round trip each, while 50
segments at ~7 ms is ~350 ms of single-threaded decode + encode. Breakdown for
k ≤ 2: lock 10 ms, ref read 10 ms, manifest GET 20–40 ms (skipped on a warm
Lambda that already holds it by hash), segment GETs in parallel 20–40 ms, CPU
5–14 ms, PUTs in parallel with the catalogue write 40–60 ms, conditional write
10 ms, release 10 ms.

**What it costs in money.** In-region transfer between S3 and Lambda is free, so
money goes to requests, storage and compute. Approximate us-east-1 on-demand
list prices.

| | One small mutation, k = 1 | The 50-row scattered save |
|---|---|---|
| S3 requests | 4 PUT + 2 GET ≈ $0.00002 | 53 PUT + 51 GET ≈ $0.0003 |
| DynamoDB | ~7 write units + 1 read unit ≈ $0.000005 | ~56 write units ≈ $0.00004 |
| Lambda compute | ~200 ms ≈ $0.000003 | ~600 ms ≈ $0.00001 |
| **Total** | **≈ $0.00003 — roughly 35,000 mutations per dollar** | **≈ $0.00035** |

| 500 saves a day for a year, no compaction | Bytes kept | Monthly cost at year end |
|---|---|---|
| Whole value — today, and the §8.1 composition alternative | ~1.8 TB | ~$42 |
| Segment layout (§8.7) | ~12 GB | ~$0.28 |

Compaction + GC reduces both to the live state (~10 MiB). Under the segment
layout the whole audit history is affordable to keep, which is the point of a
system of record.

## 9. Wire changes and the GC gate

### 9.1 Wire

```ts
// packages/e3-types/src/record.ts
export const MigrationObjectType = StructType({
  bodyIr:      StringType,    // encodeEastIR bundle, like MutationObject
  from:        EastTypeType,  // type this step reads  (element type when elementwise)
  to:          EastTypeType,  // type it produces      (element type when elementwise)
  elementwise: BooleanType,   // map per element (§7.3) vs whole-value
  runner:      RunnerType,
});

export const RecordObjectType = StructType({
  path:       StringType,
  mutations:  DictType(StringType, StringType),
  migrations: ArrayType(StringType),   // NEW — appended LAST, ordered
});
```

`RecordCommitType`, `PackageObjectType`, `DatasetRefType`, `StructureType`,
`MutationObjectType`: **unchanged**. The applied frontier (§5.2) is a reserved
`$schema` key in the record ref's existing `VersionVector`
(`DictType(String, String)`) — new *state*, but not a new wire shape, on the
`$idem` precedent.

BEAST2 is positional, so `decodeRecordObject` becomes a dual-decoder on the
`decodePackageObject` precedent (`e3-types/src/package.ts:118`) — try current,
fall back to the two-field shape with `migrations: []`. Every read path, local
and cloud, must route through it. `RecordMigrationArgsType` (§5.2) is a new
value type with no compatibility surface.

`MigrationObjectType` carries an explicit `elementwise: BooleanType` rather
than inferring the kind from whether `from` is the record's element type. The
inference happens to be unambiguous today, but BEAST2 is positional: adding the
field later is another dual-decode tier, and reading a migration's kind is on
the deploy path. Pay the byte now.

### 9.2 GC is a merge gate, not an optimization

`isRecordObjectShape` (`gc.ts:215`) matches an **exact** field set. Adding
`migrations` breaks it: a package with the new field would fail the shape test,
its mutation bodies would go unmarked, and the first `repoGc` would sweep them.
The recognizer must accept both shapes and push every `migrations` entry, and
`isMigrationObjectShape` must push `bodyIr` as a leaf — landed **in the same
change**, with GC-survival fixtures (deploy → migrate → `repoGc` → mutate)
as the merge gate. This is the same trap #413 work-item D1 flags for `$chunk`
envelopes and the same one `e3-functions.md` §4.1 flagged for functions; it has
bitten twice already.

Splice-produced state blobs need no GC change — they are ordinary objects.
Manifests under §8.7 do: rule 5 there — the `$segments` recognizer and the
`state` non-leaf flip — is part of the same gate.

### 9.3 Compliance surface

`e3-api-tests/src/suites/records.ts` is scalar-counter shaped today. It needs:
keyed-collection fixtures at 10k and (perf-tagged) 100k rows; a migration
across a redeploy with history intact; a paged patch mutation whose result decodes
equal to the whole-value equivalent; a splice/carve round-trip against a
whole-encode of the same value; and GC survival across all of it. e3-cloud
inherits these, which is how the S3 composition path gets its correctness
guarantee. Under §8.7 the splice/carve round-trip becomes a manifest round-trip —
encode → manifest + segment objects → splice → decodes equal to the whole
encode — plus a determinism fixture: equal values yield byte-identical
manifests regardless of the edit history that produced them, and a one-row edit
at 1M rows costs no more than twice a one-row edit at 10k.

## 10. What this does *not* fix

Stated plainly, because the temptation is to claim more:

- **Per-commit storage is still O(state).** A splice writes a whole new blob;
  the unchanged segments' bytes are duplicated. `UploadPartCopy` makes
  *producing* it nearly free, not *storing* it. History growth is still bounded
  only by `recordCompact` + `repoGc`. The real fix is segments as individually
  content-addressed objects (a true prolly tree) — a larger change, and #635's
  composable addressing is its enabler, not its substitute. The auto-compaction
  ↔ GC-cadence open question from `e3-records-storage.md` stands unchanged and
  becomes *more* pressing under high-frequency patch writes. **Under the §8.7
  layout this bullet does not apply**: a commit adds the touched segments plus
  one manifest, and unchanged segments are shared by hash.
- **Reactive invalidation is still whole-record.** A one-key mutation still
  advances the record's single version-vector entry, so every task reading it
  re-runs. Per-key invalidation remains out of scope (#413 non-goal). §8.7's canonical
  manifests make per-segment change detection a manifest diff, which is the
  enabler if this is ever pursued.
- **Authored whole-value mutations stay O(n).** `e3.mutateByPatch` is an
  *additive* surface; an author who writes `(State, ...) => State` gets today's
  cost. Nor does a `replace`-arm patch page — only structural (`patch`-arm)
  patches are sparse enough to exploit.
- **Down-migrations are not supported.** Rolling a package back over a migrated
  record is refused, not reversed. `invertFor` from the patch system could in
  principle synthesize one, but only for value diffs, not type changes.
- **A record rename is a drop + create.** A migration chain belongs to a record
  identified by name, so renaming one presents as dropping it and minting
  another — losing state and history unless the operator notices. An explicit
  `renamedFrom` on `e3.record` would close it; deliberately left out of v1, but
  `--allow-drop-records` is what stands between a rename and silent data loss.

## 11. Extension: the same mechanism for `e3.input`

§2 establishes that redeploy silently resets every input to its package default.
The machinery generalizes — an input's type identity is the same derived hash, a
migration over it is the same East function, minus the commit chain — so
`e3.input(name, type, default, { retain: true })` would carry the prior value
forward, migrating it when the type changed.

Deliberately **not** in the main proposal: flipping the default is a breaking
change to every existing deployment, and the "cache of someone else's truth vs.
ours" distinction in `e3-records-storage.md` is *why* inputs reset. Opt-in after
the record path is proven, or not at all.

## 12. Staging

Each stage is independently valuable and independently shippable.

**S0 — storage placement (e3-cloud).** Withdraw the ≤ 4 KB DynamoDB-inline
rule (§8.6): every object to S3, catalogue retained, idempotent backfill of
existing inlined objects, the "no object bytes in DynamoDB" CI assertion, the
GC retention window and Object-Lock-tolerant delete, and the audit of the
remaining DynamoDB items for data-carrying fields. No monorepo code change —
documentation only here. Independent of everything below, and lands first.

**S1 — schema identity, migrations, deploy plan.** `MigrationObjectType`,
`RecordObjectType` + dual-decode, GC recognizer + survival fixtures,
`e3.migration`, `package_` collection + chain validation, deploy planning
phase, `$migrate`/`$deploy`/`$reset` commits, all-or-nothing rollback,
`--schema` / `--plan` / `--allow-drop-records`, `$idem` clearing, CLI + API +
`Record.bind().history` rendering, compliance suite. Whole-value migrations
only. **This is the user-visible capability**; everything after is scale.

**S2 — streamed element migrations.** `e3.elementMigration` on `PartitionBlob` +
`Beast2Writer`, with the element function lifted into a batch program so spawn
cost amortizes across segments (§7.3). Unblocks migrating records that cannot be
materialized. Requires S1's plan phase to route to it.

**S3 — paged patch writes.** `e3.mutateByPatch`, fence bisect, per-segment
apply, rebuild + splice, the Array offset-resolution pass and the
whole-apply ≡ segment-wise-apply property test (§7.2), split/merge policy with
pinned constants and parity fixtures. Includes widening `PatchType(T)`'s
TypeScript return from `EastType` to `PatchTypeOf<T>` (`type_of_patch.ts`) so
authored reducers taking a patch argument typecheck against
`East.applyPatch` (`expr/block.ts:1139`) without a cast. The interactive-latency unlock
(e3-cloud#181). Subsumes #413 work-item A for the patch path; work-item B's
size guardrails should land here as the whole-value path's backstop. Under §8.7,
"rebuild + splice" reads "rebuild the touched segment objects + write a new
manifest", and the split/merge policy is the boundary rule of §8.7 rule 3.

**S4 — cloud composition.** Gated on #635 (and on its in-container decision,
§8.2). `ObjectStore.composeFrom` + `ComposePart` with `LocalObjectStore` and
`InMemoryStorage` implementations and shared compliance tests; the ranged
rebuild + `SourceMap` return from `readBeast2ExtentsRanged` (§8.4, in `east`);
part coalescing and the sub-5-MiB degradation (§8.3); the S3 store's
`UploadPartCopy` mapping and `AbortIncompleteMultipartUpload` lifecycle rule;
e3-cloud's mutation Lambda dropping the state from its payload. **If the §8.7
layout is adopted, S4 is replaced** by that layout's items — `CollectionManifestType`
and the opener door, the GC recognizer and `state` non-leaf flip with survival
fixtures, the pinned boundary rule in three runtimes, the manifest-backed range
reader — and `composeFrom`, part coalescing, the ranged rebuild and the
multipart lifecycle rule are dropped.

**Emit the composition plan from S3 onward, not only in S4.** A `ComposePart[]`
that a local backend simply materializes costs nothing locally, and it means the
S3 backend is a *backend implementation* rather than a second write path to keep
in sync with the first. Moot under §8.7, where a local backend writes the same
segment and manifest objects the S3 backend does.

S1 and S3 are independent; S2 sits between them and reuses S3's geometry
wrapper if S3 lands first. Recommended order is S1 → S3 → S2 → S4 if
interactive latency is the binding constraint, S1 → S2 → S3 → S4 if the
blocking need is migrating an existing large record. S0 precedes both orders.

## 13. Open questions

- **`e3 watch` default.** `--schema=reset` is right for a scratch workspace and
  catastrophic for a shared one, and `watch` cannot tell them apart. Options:
  default `migrate` with a hard error naming the fix (safe, noisy); default
  `reset` with a loud warning (ergonomic, dangerous); mark workspaces
  `ephemeral: true` at create time and switch on that (correct, more surface).
  Leaning toward the third.
- **`$deploy` marker volume.** One commit per record per deploy is right for
  audit and wrong for a watch loop doing 200 redeploys an hour. Suppress under
  `watch`, or make the marker conditional on the package hash actually changing?
- **Down-migrations / rollback.** Refuse (proposed) vs. require a paired
  `to → from` function vs. snapshot-before-migrate with an explicit restore
  command. The third is the most operationally familiar and the most storage.
- **Where element-wise migrations run.** Segment-by-segment sequentially in the
  deploy process (simple, O(segment) memory, O(n) wall clock) vs. fanned out as
  partitioned executions (fast, reuses `partitionExec`, but a migration is not
  a task and has no cache key). Sequential first.
- **Where the multipart threshold sits, and who owns it.** Below some object
  size a ranged read + `PutObject` beats `CreateMultipartUpload` + parts +
  `Complete` on round trips (§8.3). Is that threshold a property of the S3
  backend (it knows its own latencies) or of the compose plan (the caller knows
  how scattered the edit is)? Backend, probably — but then `composeFrom` needs
  enough of the plan to decide, which it has. Composition alternative only; moot
  under §8.7.
- **Scattered-edit degradation should be observable.** An edit set that
  fragments into many sub-5-MiB gaps silently turns into transfer (§8.3). That
  is the correct behaviour but a bad surprise on a latency graph; it wants a
  telemetry counter (bytes copied server-side vs bytes transferred) before it
  is load-bearing in production, on the same principle as "no silent caps".
  Composition alternative only; moot under §8.7.
- **Boundary-rule constants (§8.7 rule 3).** The expected segment size (the
  paged encoder's 1,000-row / 2 MiB targets, or a byte target alone), the
  minimum and maximum bounds, and the key hash (the SHA-256 every runtime
  already has, or a cheaper pinned hash). They are baked into every manifest's
  `rule` id, so they are decided once, before the first production write, and
  parity-fixtured across the three runtimes.
- **Header byte identity across runtimes (§8.7 rule 2).** `spliceBeast2` needs
  byte-identical header prefixes, and type sections are not guaranteed
  byte-identical across independently built encoders (§8.4). The manifest pins
  the header hash; open is whether a runtime writing a segment must reproduce
  those exact bytes, or whether the materialiser re-headers segments on splice.

- **Rolling frontier hash vs. the applied-hash list.** The rolling hash is O(1)
  to store and detects edit/reorder/removal, but a mismatch can only name the
  first divergent step, not describe the divergence. Storing the applied
  migration object hashes as a delimited list instead would give a precise
  "applied A, B, D; package declares A, B, C, D" message, at O(chain) bytes in
  the ref. Chains are short; this may be worth the bytes purely for the error.
- **Frontier and workspace export.** `workspaceExport` copies workspace refs
  verbatim into the exported package, so the `$schema` slot travels with an
  exported bundle — correct for re-importing a workspace snapshot, and it means
  a bundle carries "what had been applied" as data. Confirm this is the wanted
  semantics before it becomes load-bearing.
- **Naming.** `e3.mutateByPatch` reads as a verb where its siblings
  (`e3.mutation`, `e3.migration`) are nouns. `e3.patchMutation` matches the
  SDK's qualifier-first style (`partitionTask`, `streamTask`) but reads as "a
  mutation of patches"; `mutateByPatch` says what it does. Decide before the
  surface ships. `e3.elementMigration` (§7.3) is the same question one level
  over.

## 14. Relationship to existing issues

| Issue | Relationship |
|---|---|
| #413 (scale large keyed-collection records) | §7 supersedes work-item D's `layout` flag and `$chunk` envelope with the v5 segment format (as its own comment suggests), subsumes work-item A for the patch path, and promotes the partial-key reducer follow-on the comment requests into S3. Work-item B (size guardrails) and C (fixtures/benchmarks) stand. Under §8.7 the `$chunk` envelope returns as `CollectionManifestType` (kind `$segments`), still with no per-record layout flag. |
| #635 (composable content addressing) | Hard dependency of S4, and its first concrete consumer. §8.2 answers the issue's open "where do the digests live" question **in favour of the in-container form**: a paged write already ranged-reads the blob's tail for the segment geometry, so index-section digests arrive free, while a side-car costs one extra GET on the hottest path forever. §8.1 gives `composeFrom?()` — named in the issue's "To build" list — a caller. Under §8.7 the composite address is not needed: the manifest is an ordinary object whose own hash is the state's address, and its entries are the per-leaf digests. |
| `e3-records.md` §13 | Resolves the redeploy open question: explicit migrations, with reset as an audited opt-in policy rather than the default. |
| `e3-records-storage.md` | Endorses its prolly-tree direction, on the v5 segment format rather than a new chunk encoding (§8.7 gives that tree its concrete form: a manifest over standalone v5 segment objects), and leaves its auto-compaction ↔ GC-cadence question open (§10). |
| #539 (frozen task inputs) | Unchanged: reducers still receive frozen values, copy-first. |
| e3-cloud#181 | §7 + §8 are the upstream half of the interactive-latency requirement. |
