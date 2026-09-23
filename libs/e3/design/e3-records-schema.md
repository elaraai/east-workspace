# Design: record schema versioning, migrations, and paged mutation

> Status: **proposal** · 2026-09-04 · revised 2026-09-22 (§9–§11: secondary
> indexes, the mutation delta, steps for records; §7.3 corrected; §12–§17
> renumbered from §9–§14) · 2026-09-23 (§8.7 rule 3: the byte bound decided)
> Audience: e3 maintainers. Companion to [`e3-records.md`](./e3-records.md)
> (the records spec) and [`e3-records-storage.md`](./e3-records-storage.md)
> (the storage decision record). Resolves the §13 open question *"Redeploy
> onto live record state — keep-if-type-unchanged vs always-reset vs explicit
> migration mutations (`$migrate`)"*, and folds it together with the paged
> read/write story so one mechanism serves both.
> Related issues: #413 (scale large keyed-collection records), #635 (composable
> content addressing), #779 (the epic of §9–§11), e3-cloud#175/#176/#181.

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
- **One write door, `e3.patchMutation`, paged automatically when the record's
  root is a collection** (§7). `PatchType(T)` already addresses what changed —
  keys for Dict/Set, `{key, offset}` for Array — so the engine resolves the
  touched segments and rewrites only those, on the
  `carveBeast2`/`rebuildBeast2`/`spliceBeast2` geometry
  `execution/partitionIo.ts` already wraps. A one-row edit costs one segment,
  and — on a record without indexes — needs no reducer process at all. §10
  generalises the door to three write forms.
- **The write is emitted as a composition plan, not a byte stream** (§8), so
  e3-cloud executes it as ranged reads in and `UploadPartCopy` ranges out — the
  unchanged segments never leave S3. This needs a new `ObjectStore.composeFrom`
  and has a hard dependency on #635 for naming a result we never read.
  Superseded by the segment-object layout of §8.7 once that is adopted (see
  the note there).
- **Every content-addressed object lives in S3; DynamoDB holds only pointers,
  revision tokens, leases and the GC catalogue** (§8.6). The ≤ 4 KB
  DynamoDB-inline rule is withdrawn so the platform has one data-at-rest
  surface, and it lands first (S0, §15) so nothing in this design is written
  against a placement branch.

- **A record declares secondary indexes** (§9). `e3.recordIndex` names an
  East function of an entry; the index is a second canonical collection,
  `Dict<{ik, k}, P>`, stored as a segment manifest like the primary, and the
  record's state becomes a small `$record` object naming the primary and every
  index — one commit, one ref swing, always consistent. Pages and key searches
  take an index selector and a range-seek form; an index window is an ordered
  array, never a dict.
- **Every mutation writes a delta** (§10). Three forms — `reduce`, `edit` and
  `patch` — run as one generated program on the mutation's runner that emits
  the primary and index changes as one sorted collection, which e3-core
  applies segment by segment. A mutation's write cost is the touched segments
  of every target whatever its form, and e3-core never evaluates user East.
- **Records reuse the step interpreter** (§11): index builds and reindexes,
  migrations including key-changing ones, and writes above a segment threshold
  run as plan, map, reduce and splice templates with a commit step, on every
  backend. Runners open a segment manifest lazily, so a record is staged by
  linking and a slice is a sub-manifest.

The wire cost is four new object types (`MigrationObjectType`,
`RecordMigrationArgsType`, `RecordIndexObjectType`, `RecordStateType`) and
five appended fields (`RecordObjectType.migrations` and `.indexes`,
`MutationObjectType.form` and `.programIr`, `RecordCommitType.delta`), each
appended last with a dual decoder. `DatasetRefType`, `PackageObjectType` and
the structure encoding are unchanged.

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

**Built, as of the 2026-09-22 revision.** Nothing of §7, §8.7 or §9–§11 exists
in the tree: `recordMutate` is the whole-value loop above, there is no
collection manifest or opener door, and `getDatasetPage` pages single blobs.
Every stage of §15 is ahead.

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
| One key order | A view by an attribute of the value, by a related entity, or by time across every key scans the record (§9) |
| Every mutation form returns a whole state | Index maintenance would have to diff whole states; only a client patch is sparse (§10) |

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
commit path, it must preserve `$schema` (§5.2). On by default; see §16 for the
watch-loop volume question.

### 6.5 `e3 watch`

`e3 watch` redeploys on every source save, so under `--schema=migrate` a
type-changing edit to a record fails the loop until a migration exists — the
correct behaviour for a shared workspace, the wrong ergonomics for a scratch
one. `watch` should take the same `--schema` flag and the scaffold's dev script
should pass `--schema=reset`, so the dev loop resets a scratch record loudly
and a shared workspace still refuses. See §15.

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

### 7.2 `e3.patchMutation` — one door, paged when it can be

Today's authored surface is `e3.mutation(name, record, fn, config?)` with
`fn: (State, ...Args) => State` (`e3/src/mutation.ts`). It stays exactly as it
is, for logic and invariants. Beside it:

```ts
// any record, any type — no reducer body
const editRoster = e3.patchMutation(roster);   // arg: PatchType(RosterType)
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

**Paging is an implementation detail, not an API split.** `patchMutation` is
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
one segment decode, one segment encode, and a byte-copy splice. That holds for
a record without indexes. A record with indexes runs the generated program of
§10.2 over a sub-manifest of the touched segments — one process per mutation,
because the index functions are user East and run where user East runs; the
apply itself stays in-process.

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

**Opt-in, not universal.** `patchMutation` is declared per record and passed to
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
ranged rebuild. §8.7 gives the step-by-step form and §8.8 the costs. Under §10
this list is superseded by §10.4: the program runs first, and its delta — not
the raw patch — is what the touched-segment loop buckets and applies, for the
primary and for every index.

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

> **Withdrawn (2026-09-22).** With the merge-tree fan-in of #764 a key-changing
> migration streams too: `map` emits re-keyed entries per slice, `reduce` sorts
> and merges them, `splice` finishes — §11.3. The size refusal above no longer
> applies, and the batched-program recommendation is what the template does:
> one unit per slice.

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

`e3.patchMutation` runs no reducer at all on a record without indexes —
e3-core applies the patch in-process — so it introduces no runtime concept
anywhere; with indexes it runs the generated program of §10.2, and §10.5
restates this section under the delta. Authored
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

A `patchMutation` write therefore emits, for a patch touching segments *i* and
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

**Staging.** S0 in §15 — independent of S1–S4 and lands first, so the paged
write path is never written against a size branch that is about to disappear.

### 8.7 Target-state flow — one row of a 200k-row record (segment-object layout)

**Normative target state for the collection write path**, stated end to end so
the roles of Lambda, DynamoDB and S3 are unambiguous. It assumes the
**segment-object layout** below — the prolly tree `e3-records-storage.md`
decided on, realised on the v5 segment format that now exists. Where this layout
is adopted, §8.1–§8.4 (the composition plan, `UploadPartCopy`, the 5 MiB
coalescing, the ranged rebuild) are not needed and the first bullet of §13 no
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
   a runner is `spliceBeast2` over the segments — or, with the manifest-aware
   opener of §10.3, no materialisation at all: the runner opens the manifest
   and reads the segments it touches, the splice being the fallback for a
   runtime without it.
3. **Boundaries are content-defined.** A segment *starts* at the element whose
   encoded key hashes into a pinned pattern, within pinned minimum and maximum
   element bounds, identically in all three runtimes. Segmentation is then a
   pure function of the value, never of edit history: equal values produce
   equal manifests, and two states diff in O(changed segments).

   **Resolved (2026-09-22), rule id `cdc/fnv1a64/256-1024-4096/1`.** Walking a
   Set or Dict's keys in canonical order, a new segment begins at key *k* when
   the open segment already holds at least `MIN = 256` elements and either
   `fnv1a64(canonical bare encoding of k) & 1023 == 0` — so segments average
   `TARGET = 1024` elements — or the open segment has reached `MAX = 4096`.
   Array roots have no key to hash and keep the paged encoder's byte-adaptive
   batching under the id `pos/1000-2MiB/1`; their segmentation is a property of
   the writer rather than of the value.

   Three things about that shape are load-bearing.

   - **The cut falls before the boundary key, not after it**, so the key that
     decided a boundary IS that segment's fence — which the manifest already
     stores and a bare blob's reader already probes. A reader can therefore
     answer *"was this cut by the rule?"* from the segment index alone, which
     is what lets a conforming runner's output be carved into segment objects
     by byte copy rather than decoded and re-encoded. The test is necessary
     rather than sufficient — a writer that skipped a boundary key inside a
     segment cannot be caught without decoding it — and that is enough: the
     writers are the three runtimes' encoders, and a positionally batched blob
     fails it almost surely.
   - **The bounds are element counts, never bytes.** The only byte count a
     writer knows as it cuts is the compressed one, and deflate output is not
     byte-identical across zlib builds, so a byte bound could not be part of a
     rule three runtimes must agree on. The exposure this leaves is wide rows:
     at the 53 B/row of the sizes below a segment is ~52 KiB, but a row holding
     a nested collection at 10 KB makes a 1024-element segment ~10 MB, and a
     segment is the unit of every random read and of every one-row rewrite —
     measured, a `Dict<String, Blob>` of 300 one-MiB blobs is a single 300 MiB
     segment. *Decided 2026-09-23: shipped count-only.* A plain cap on logical
     (pre-deflate) bytes, deterministic as it would be, is the wrong fix: for
     wide rows its cuts land more often than the 256 elements a hash cut
     needs, so they never line up with the hash cuts again, and one row
     growing by a byte re-cuts every segment after it — a wide-row mutation
     becomes O(state), the cost this layout exists to remove. A bound that
     keeps edit locality has to make the boundary test itself size-aware,
     which is #788; it lands under a new rule id, and a manifest cut under an
     older one is re-cut whole on its first write.
   - **FNV-1a rather than SHA-256**, because it is one multiply and one xor per
     byte with no state beyond a 64-bit accumulator, so every runtime
     reproduces it in a few lines and the per-element cost stays under the
     key's own encode. It carries no security claim: a key chosen to avoid
     boundaries only lengthens a segment as far as `MAX`.
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
   §12.2 demands.

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

## 9. Secondary indexes — `e3.recordIndex`

### 9.1 The gap

§7 and §8.7 page and patch a record in its primary key order and nothing
else. The trigger workload has more than one order. A planning record
`Dict<{plan, bin}, Row>` — hundreds of thousands of plans, each a run of time
bins, a row holding variants and nested collections, millions of entries in
all — is read by plan, by plan over a time range, by an attribute of the row
(status, owner, customer), by a related entity a row names many of (the
resources a plan consumes), and by time across every plan. Only the first two
are contiguous in primary order. The rest are not addressable through §7 at
any cost short of a scan of the primary, which is exactly what a system of
record at this size cannot afford per view.

A secondary index closes that gap without a new storage structure: it is a
second canonical collection whose sort order *is* the query order, stored as a
segment manifest exactly like the primary, maintained inside the same commit,
and read with the same paging machinery.

### 9.2 An index is a canonical collection

```
Index(K, V, IK, P) = Dict<{ ik: IK, k: K }, P>
```

- `IK` is the index key an East function computes from an entry `(K, V)` — a
  scalar, a struct, a variant. Struct keys compare field by field in
  declaration order, so every entry with the same `ik` is one contiguous run,
  ordered by primary key inside it, and a *range* of `ik` is one contiguous
  run too. `k` in the key makes the entry unique and gives the run its inner
  order.
- A **multi-valued** index function returns `Set<IK>`: one entry per element,
  so a plan that names five resources appears under five resource keys. An
  empty set is an entry the index does not carry — a partial index is the same
  declaration with a predicate inside the function.
- `P` is an optional **covering projection**, a second East function of
  `(K, V)`; `NullType` by default. A view that renders from the index alone —
  a queue of `{status, due, title}` — declares the fields it renders as `P`
  and never touches the primary segments; a view that needs the row joins
  (§9.5).

Because it is an ordinary collection blob under the §8.7 layout, everything
already built for one applies unchanged: content-defined segments and their
fences, the pager's bisect and windows, `findDatasetKey`, carve and splice,
the lazy opener, the emit sink and the k-way merge. Nothing is added to
beast2.

### 9.3 Authoring surface

```ts
// packages/e3/src/record-index.ts (new)
const plans = e3.record('plans', DictType(PlanKeyType, PlanRowType), new Map());

// One key per entry, with a covering projection.
const byStatus = e3.recordIndex('by_status', plans, {
  key:   East.function([PlanKeyType, PlanRowType], StatusKeyType, ($, k, v) => ({ status: v.status, due: v.due })),
  value: East.function([PlanKeyType, PlanRowType], QueueCardType, ($, k, v) => ({ title: v.title, owner: v.owner })),
});

// Many keys per entry: a Set return.
const byResource = e3.recordIndex('by_resource', plans, {
  keys: East.function([PlanKeyType, PlanRowType], SetType(ResourceRefType), ($, k, v) => v.resources),
});

// Time-major order across every plan.
const byBin = e3.recordIndex('by_bin', plans, {
  key: East.function([PlanKeyType, PlanRowType], TimeBinType, ($, k, v) => k.bin),
});

const pkg = e3.package('planning', '1.0.0', plans, byStatus, byResource, byBin, …);
```

`e3.recordIndex(name, record, spec, config?)`:

- `spec` carries exactly one of `key` (a function of `(K, V)` to `IK`) or
  `keys` (to `SetType(IK)`), and an optional `value` (to `P`); `config` takes
  an optional `runner` on the `e3.mutation` policy. The record's type must be a
  `Dict` — a Set or Array record has no `(K, V)` entry to index.
- collected by `package_()` onto its record like a mutation
  (`item.kind === 'recordIndex'`); an index whose record is not in the package
  is a definition-time error.
- the same guards as a mutation: sync, no `Platform` node under `walkIR`,
  parameter types equal to the record's key and value types by
  `equalFor(EastTypeType)`. The name is an identifier, unique on the record,
  and not `primary` (reserved by §10.1). All definition-time errors, never
  deploy failures.

The functions are pure for the same reason a reducer is: they run again on
every commit and in every bulk build, and the maintained index must equal the
rebuilt one to the byte (§9.6).

### 9.4 Where the indexes live — the `$record` state object

The record's `state` gains one level when the record declares an index. The
ref's `value.hash` then names a small state object rather than the primary
manifest:

```ts
// packages/e3-types/src/record.ts
export const RecordStateType = StructType({
  kind:    StringType,                 // "$record" — GC recognizer tag, like "$segments"
  primary: StringType,                 // CollectionManifest hash of the primary
  indexes: DictType(StringType, StructType({
    manifest: StringType,              // CollectionManifest hash of the index collection
    index:    StringType,              // RecordIndexObject hash it was built under
  })),
});
```

One state object, one commit, one conditional ref write: the primary and every
index are consistent at every commit, history carries them, `e3 get --at
<commit>` resolves them, compaction copies the state hash and so keeps them,
and GC walks them (§12.2). A record without indexes keeps the plain manifest,
so this is additive on §8.7 — and adding a record's first index is a
`$reindex` commit (§11.2), not a migration.

`indexes[name].index` is what deploy compares (§11.2): an index whose object
hash differs from the package's — its key function, its value function or its
runner changed — is rebuilt; one absent from the package is dropped from the
state; one present in the package and absent from the state is built.

The state object is resolved through the same opener door §8.7 rule 1
introduces: every reader of a record's `value.hash` asks the door for the
*primary* and gets the manifest, and the index readers of §9.5 ask it for an
index by name. Task-input marshalling, `datasetGet`, paging and the UI read
path see the primary and nothing else, as today.

### 9.5 Reads through an index

The page and key-search endpoints take an index selector, `index=<name>`,
beside the window or the query:

```
GET …/datasets/<record>?page=true&index=by_status&offset=0&limit=50[&join=true][&hash=<state>]
GET …/datasets/<record>?find=true&index=by_status&from=<literal>…&to=<literal>…[&hash=<state>]
```

- **The index window is served from the index's own segments** — the same
  fence bisect and window slice §7 uses on the primary, over the index
  manifest. With a covering `P` the window is the answer.
- **`join=true` returns the rows.** The window's primary keys are bucketed by
  owning primary segment (one fence bisect each, against the primary manifest
  already in hand), each distinct segment is read and decoded once, and the
  rows are projected out. A page of fifty rows scattered across the primary
  costs at most fifty segment reads, issued in parallel; a page whose entries
  share an index key usually clusters far better than that. A joined page of
  wide rows is clamped by the primary's average row bytes exactly as §7's page
  byte budget clamps a primary window.
- **An index window is an array, not a dict.** A `Dict` value re-sorts by its
  key, which would throw away the index order the page was asked for. The
  wire type of an index window is therefore positional, in index order,
  carrying every key the client may need:

  ```ts
  IndexWindowType(K, IK, P, V) = ArrayType(StructType({
    ik:    IK,             // the index key
    key:   K,              // the primary key
    value: P,              // the covering projection (Null when none)
    row:   OptionType(V),  // the primary row — some(...) with join=true
  }));
  ```

  Whatever renders an index-ordered view consumes this shape. That is a
  contract the data layer sets and the UI meets, not the reverse: the keyed
  row-source contract in east-ui grows an ordered-keyed-rows arm for it (§13,
  last bullet).
- **Range seeks.** `findDatasetKey` answers exact keys, string prefixes and
  exact leading struct fields. An index over `{status, due}` and a primary over
  `{plan, bin}` both need *bounds*: "plan X between t0 and t1", "every plan in
  this week", "late plans due before Friday". The query gains a fourth form —
  `from` and `to`, each a list of `.east` literals for a leading prefix of the
  key's **flattened** field path (for an index key that path begins inside
  `ik`: `{ik: {status, due}, k: {plan, bin}}` flattens to `status, due, plan,
  bin`, so `from=[late, 2026-10-01]` bounds `ik.status, ik.due`) — with the
  same monotone lower and upper predicates the existing forms build, recursing
  into nested struct fields in declaration order. Two fence bisects, one
  contiguous row range, on the primary and on any index alike.
- **Hash pinning** pins the `$record` state hash; a page of any index under it
  is immutable-cacheable exactly as a primary page is (§7).

Per-operation cost on the §8.8 record with three indexes declared, typical
in-region figures:

| Read | S3 GET | Rows decoded | Warm latency |
|---|---|---|---|
| Index page of 50 covering entries | state + index manifest (cached warm) + 1–2 segments | 1,000–2,000 index entries | 40–80 ms |
| Index page of 50, `join=true`, entries clustered in 3 primary segments | + 3 primary segments | + 3,000 rows | 60–120 ms |
| Index page of 50, `join=true`, fully scattered | + up to 50 primary segments, in parallel | + up to 50,000 rows | 120–250 ms, CPU-bound |
| Range seek on an index | 2 bisects over cached fences | ≤ 2 segments | 20–60 ms |

### 9.6 Invariants and the reindex door

- **Maintained ≡ rebuilt.** At every commit each index manifest equals, byte
  for byte, the manifest a bulk build (§11.2) over the same primary would
  write. Content-defined boundaries make this a property of the value rather
  than of the edit history, and the compliance suite asserts it after a mixed
  sequence of inserts, updates, deletes and multi-key changes.
- **Rebuildable.** An index is derived state. `e3 record reindex <ws> <record>
  [--index <name>]` (and its API route) rebuilds it from the primary through
  §11.2 and appends a `$reindex` commit; the audit chain records that it
  happened. This is also the operator's exit when an index function turns out
  to be wrong: fix the function, redeploy, and the deploy plan rebuilds.
- **Never partial.** A commit either updates every index the state names or
  none: the delta of §10 carries every index arm, and the apply of §10.4
  writes every manifest before the one ref swing.

## 10. Every mutation writes a delta

### 10.1 The mutation delta

§7.2 reasoned about one write form: a client-supplied `PatchType(State)`. With
indexes, every write form must produce the same thing — the primary changes
*and* the index changes, addressed by key, sparse — so that one apply path
serves all of them. That thing is the **mutation delta**, one sorted collection
per commit:

```ts
// Derived per record from its type and index declarations; never stored as a
// type — every delta blob is self-describing.
PatchOps(T)       = VariantType({ delete: T, insert: T, update: PatchType(T) })  // the op type of PatchType(Dict<_, T>)'s `patch` arm
DeltaKeyType      = VariantType({ primary: K,           [name]: StructType({ ik: IK_name, k: K }) … })
DeltaOpType       = VariantType({ primary: PatchOps(V), [name]: PatchOps(P_name) … })
MutationDeltaType = DictType(DeltaKeyType, DeltaOpType)
```

One variant case per target — `primary` plus one per declared index, which is
why `primary` is a reserved index name. The arm of a case is exactly the op
type of that target's own `PatchType`, so applying the `by_status` run of a
delta to the `by_status` collection *is* `applyFor(indexType)(segment,
variant('patch', ops))`, `ConflictError` and all. Canonical order puts every
target's ops in one contiguous run, in the target's own key order: the apply
streams the delta segment by segment and never holds it whole, and a delta is
a pageable dataset like any other. A delta whose only arm is `primary`, on a
record with no index, is exactly the `patch` arm of §7.2.

The delta is what the commit records: `RecordCommitType` gains a trailing
`delta: OptionType(StringType)` (appended last, dual-decoded, a GC leaf like
`args`) naming it, so history shows what changed without diffing states, and
`invertFor` can synthesise an undo from it. `args` keeps its meaning — the
mutation's own arguments, which is what an audit reader wants to see first.

### 10.2 Three write forms, one program

| Form | Declared as | Body | Best for |
|---|---|---|---|
| **reduce** | `e3.mutation(name, record, fn)` — unchanged | `(State, …Args) => State` | invariants over the whole state; small records |
| **edit** | `e3.editMutation(name, record, fn)` | `(State, …Args, Edit) => Null` | server-side logic touching a few entries of a large record — the "lazy write" |
| **patch** | `e3.patchMutation(record)` | none; the argument is `PatchType(State)` | interactive edits from a view; integrations that send diffs |

`e3.patchMutation` is the door §7.2 specifies, under the name this document
now uses throughout (§16). `Edit` is a struct of three East functions the SDK
types as `EditOf(State)`:

```ts
EditOf(Dict<K, V>) = StructType({
  set:    FunctionType([K, V], NullType),
  delete: FunctionType([K], NullType),
  update: FunctionType([K, PatchType(V)], NullType),
});
```

An edit body reads the state it is given — lazily, the frozen pager-backed
value every runner already serves (#539) — and writes through `edit`; it never
returns a state. Repeated edits of one key fold: `set` after anything is that
`set`; `update` after `set` applies to the set value; `update` after `update`
composes (`composePatch`); `delete` after anything is `delete`; a `delete` or
`update` of a key the state does not hold fails the mutation naming the key,
as `applyFor` would.

All three forms run as **one generated program** on the mutation's runner. The
SDK builds it at export beside the body, the way `partitionTask` builds its
merge command and `streamTask` its command IR — an ordinary East function
assembled from the author's own IR and the record's index functions, then
linked and encoded like any other `bodyIr`:

```
program(state, …args | patch, emit):
  ops : Dict<K, EditOp(V)>                          // the touched primary keys, folded
    reduce:  next = body(state, …args); ops = diff(state, next).patch   // the Diff builtin — sparse
    edit:    ops = {}; body(state, …args, edit-over-ops)
    patch:   ops = patch.patch  (a `replace` arm: check `before` ≡ state, then ops = diff(state, after).patch)
  arms : one Dict per target, keyed by that target's key type
  for (k, op) in ops:                               // canonical key order
    old = state.tryGet(k)                           // one lazy segment decode, LRU-cached by the pager
    new = apply(old, op)
    arms.primary[k] = toPatchOp(old, new)           // insert new | delete old | update diff(old, new)
    for each index i:
      oldKeys = keys_i(k, old) if old else {}       // `key` wraps into a one-element set
      newKeys = keys_i(k, new) if new else {}
      for ik in oldKeys − newKeys: arms.i[{ik, k}] = delete value_i(k, old)
      for ik in newKeys − oldKeys: arms.i[{ik, k}] = insert value_i(k, new)
      for ik in oldKeys ∩ newKeys, value changed:  arms.i[{ik, k}] = update diff(value_i(k, old), value_i(k, new))
  for case in canonical case order of DeltaKeyType: // `emit` needs ascending keys on every runtime
    for (key, op) in arms[case]: emit(variant(case, key), variant(case, op))
```

The runner invocation is the one every task already knows: `run` with the
state as a lazily opened input (`--stream`, so a 1.5 GB primary costs the
segments the body touches, not a decode), `--emit dict` for the delta, `-o
<delta.beast2>`. No new runner command and no new native code: the program
emits its delta in canonical order itself, so it needs neither the C sink's
spill-and-merge sort (the TypeScript sink has none) nor any runtime beyond the
one the mutation declares. e3-core never evaluates user East — it applies
(§10.4) — which keeps the step interpreter's rule and the cross-runtime parity
§7.3 wanted for migrations.

Two costs to name. The `reduce` form's diff is O(n) in the runner, as its
encode already was; its *write* is now O(touched) like the others. And a record
with indexes turns the `patch` form from "no process" (§7.2) into one runner
run over the touched entries — the price of computing the index functions
where user East runs. Without indexes e3-core applies a client patch directly,
exactly as §7.2 says.

### 10.3 The state the program sees

Locally, a record's state is materialised for the runner the way every task
input is (#767): by link, never by copy. Under §8.7 that means the segment
objects are linked into the scratch directory beside a manifest, and the
runner's lazy opener follows the manifest — a beast2 file whose value is a
`CollectionManifest` opens as the collection it describes, its segments being
sibling files named by hash. Splicing the segments into one file, which §8.7
rule 2 names as the materialisation, becomes the fallback for a runtime
without a manifest-aware opener. The same opener lets a partition slice be a
*sub-manifest* — a list of segment hashes, no bytes copied — which is what §11
leans on.

For the `patch` form e3-core knows the touched keys before anything runs,
bisects them against the primary manifest, and hands the program a
sub-manifest of only the touched segments. The `edit` and `reduce` forms read
data-dependently, so they take the whole manifest. On e3-cloud the difference
matters (§10.6).

### 10.4 The apply, in e3-core

Per CAS attempt, replacing the step list of §7.2:

1. Read the versioned ref; read the `$record` state object (or the bare
   manifest); read the manifests it names — every one immutable and served
   from an in-process cache by hash on a warm process.
2. Run the program (§10.2); adopt its delta output as an object by hash.
   Nothing is decoded in this process.
3. Stream the delta. For each arm, bisect the touched keys against that
   target's fences, group by segment, and for each touched segment: read the
   segment object, verify its hash, decode,
   `applyFor(targetType)(segment, variant('patch', ops))`, re-run the boundary
   rule over the result together with its neighbours where a merge or split
   falls due, and encode each resulting segment as a standalone blob under the
   manifest's pinned header. A `ConflictError` here is the stale-write signal
   of §7.2: the attempt is abandoned and the outcome is `conflict` naming the
   key, never a silent clobber.
4. Write the new segment objects and one new manifest per touched target;
   untouched targets keep their manifest hash.
5. Write the new `$record` state object and the commit (with `delta`), and
   swing the ref with `writeIf`; on a conflict, restart from step 1 with the
   same arguments.

Nothing in this process ever holds more than the touched segments of one
target. The whole-apply ≡ segment-wise-apply property test §7.2 asks for
covers every arm; a second fixture pins that the apply's segment objects equal,
hash for hash, the objects the encoder door writes for the whole new value.

Per-mutation cost on the §8.8 record with three indexes — one plan edited from
a view, typical in-region figures, warm:

| | primary | each index | fixed |
|---|---|---|---|
| segment GET + PUT | 1 + 1 | 1 + 1 | manifests 1 + 3 (cached warm), state object, delta, commit |
| rows decoded and re-encoded | ~1,000 | ~1,000 | — |
| process runs | 1 (the program, ~30–50 ms warm) | 0 | — |
| warm latency, end to end | | | 250–350 ms |

Against §8.8's 150–200 ms for a record without indexes, the difference is the
program run and three more small puts. The 50-row scattered save of §8.8
scales the same way: at most 50 primary segments plus at most 50 per index,
CPU-bound, in parallel.

### 10.5 What the reducer sees, restated

§7.5 stands: every form receives a value, frozen and pager-backed, and the
copy-first rule applies. What changes is the *output* contract — a delta on
the runner's emit sink instead of a state on `-o` — and that a mutation never
needs the whole state on the heap unless its own body does.

### 10.6 On e3-cloud

The shape is unchanged: every manifest, segment, state object and delta is an
S3 object under §8.6; DynamoDB holds the ref and the conditional write; the
program runs on the detached-runner Lambda. Three things follow for the cloud
implementation:

- **Inputs by reference** (#413 work item A) is a prerequisite: the state is a
  manifest, so the runner Lambda resolves object hashes against S3 and
  materialises segments to its ephemeral disk. A warm runner keeps a
  hash-keyed cache of segment objects; after the first mutation of a record
  only the segments a later commit changed are fetched again, so the `edit`
  and `reduce` forms cost O(changed segments) of transfer on a warm container
  and one full fetch on a cold one. The `patch` form carries a sub-manifest
  and is O(touched) cold or warm — the form to use for interactive latency at
  any record size.
- **The delta comes back as an object**, never in the invoke response: the
  runner adopts it into S3 by hash and returns the hash — #413 work item A's
  `resultAsObject`.
- **The S3 object store has no ranged read and buffers streamed writes whole**
  today. Under the segment-object layout neither is on the mutation path —
  segments are whole small objects — but a bulk build's final splice (§11.2)
  is a streamed write and needs the multipart path.

## 11. Steps for records

Partitioned execution has a step interpreter — `plan`, `map`, `reduce`,
`splice` over a template, every unit an ordinary content-addressed execution,
the carve and splice hooks and the unit executor injectable so e3-cloud runs
the units on its own compute (`execution/steps.ts`, #770). Records get their
bulk operations from it rather than from anything new, and the mutation forms
of §10 are its units when a write is large.

### 11.1 The record template

A record operation is a template over the record's primary manifest instead
of a task's input blob:

- `plan` reads the manifest — its fences, counts and bytes *are* the segment
  index — and cuts partitions by `targetPartitionBytes` exactly as
  `planPartitions` does from a blob's index; a slice is a sub-manifest
  (§10.3), so nothing is carved.
- `map` runs a generated program per slice on the record's (or the index's)
  runner — an execution of a synthesized task object, probed in the execution
  cache first, so a re-run over unchanged segments hits.
- `reduce` is the merge tree of #770's fan-in — `ranges` grouping, the
  runner's `merge` command.
- `splice` writes the result through the encoder door, which cuts it into
  segment objects and a manifest; a segment equal to one the store already
  holds dedupes by hash.
- a final **commit step** writes the `$record` state object, the commit and
  the conditional ref write — the one step the task interpreter lacks, and the
  reason "steps" reach mutations at all.

### 11.2 Index build and reindex

Building an index over N entries is an external sort of N small entries — the
emit sink's job. The template is `[plan, map, reduce(merge), splice, commit]`:

- `map`: the index's build program, generated at export beside its key and
  value functions — `(slice: Dict<K, V>, emit) => Null`, iterating the slice
  and emitting `{ik, k} → P` for every key the index function yields. Index
  order is not primary order, so the program collects its slice's entries in a
  local `Dict` and emits it in order; a runtime whose sink sorts may stream
  instead, and the bytes are the same either way.
- `reduce`: partials overlap in index-key space, so they merge through the
  tree with a trivial merge function — keys cannot collide, since `k` is
  unique to one slice.
- `splice` and the door; then one `$reindex` commit naming the new state
  object, carrying `mutation: "$reindex:<name>"` and, in `args`, the
  `RecordIndexObject` hash it was built under.

Deploy plans it. §6.1's table gains rows: for each record present, an index in
the package whose object hash is not the one the state names is `build`; an
index the state names and the package does not is `drop`; a type-changing
migration (§5) implies `build` for every index, applied after the migration's
own steps; a record whose declared indexes match its state is `keep`.
`--plan` prints the work per index in segments and bytes. Every policy of §6.2
runs index builds, `fail` included: an index is derived, and building one
changes no state the audit chain protects. The frontier of §5.2 is untouched.

Sizes for the §8.8 record: 200 segments, one map unit per 256 MiB target —
one unit at this size, a few seconds on the C runner; the 1.5-million-entry
planning record of §9.1 at ~150 MB is one unit at the default 256 MiB target
and six at 32 MiB — the byte target is the parallelism knob — a minute or so on
a laptop either way and, on cloud, a job (§11.5).

### 11.3 Migrations, corrected

§7.3 says a key-changing migration cannot stream because its output must be
re-sorted. With the merge tree that is no longer true: `map` emits re-keyed
entries per slice through the migration's program, `reduce` sorts and merges
them, `splice` finishes. The whole-value refusal of §7.3 is withdrawn: a
key-changing migration is the same template as an index build with a
different map program, and an element migration is the template without
`reduce`. The "one process per segment" trap of §7.3 is answered the same way
— one map unit per slice, not per segment — so the batched-program
recommendation there is what the template does.

### 11.4 Large writes as steps

A delta is a sorted, pageable collection, so a write that touches many
segments is a `map` over the touched segments rather than an in-process loop.
Above a threshold of touched segments — `MUTATION_INLINE_MAX_SEGMENTS`, pinned
like the boundary constants — the apply of §10.4 plans one unit per run of
touched segments per target, each unit a generated program
`(segments: Dict<K, V>, ops: Dict<K, PatchOps(V)>) => Dict<K, V>` that is one
`applyPatch` call, run on the record's runner, its output re-encoded by the
runner as a canonical blob; the untouched spans are copied by sub-manifest;
`splice` and the door finish; then the commit step. Below the threshold the
in-process apply runs, and a fixture pins that both paths write the same
segment objects for the same delta. This is what an integration writing a
hundred thousand rows in one mutation, or a planner's "reschedule everything
on this resource", costs: parallel units on every backend, cached like any
other execution.

A **partitioned edit mutation** — an `edit` body run once per slice of the
state, each unit emitting its own delta, the deltas merged (their keys are
disjoint by construction) and applied as above — is the same template one
step earlier, and is deferred until a workload asks for it; every piece is
present.

### 11.5 On e3-cloud

The units run through the executor hook e3-cloud already supplies for
partitioned tasks; nothing record-specific is added to the compute path. What
is new is *when* the template runs: a deploy that builds an index or migrates
a record cannot finish inside a deploy request, so a cloud deploy returns with
the record in an `indexing` or `migrating` status and runs the template as an
orchestrated job — the yielding shell the dataflow loop uses — with the
workspace fenced by the deploy lock until the commit step lands or the
all-or-nothing rollback of §6.3 restores the captured refs. This is a cloud
design item with a companion issue; it applies to §5's migrations as much as
to indexes.

## 12. Wire changes and the GC gate

### 12.1 Wire

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

The 2026-09-22 revision appends to three of these and adds two object types:

```ts
// packages/e3-types/src/record.ts — §9 and §10
export const RecordIndexObjectType = StructType({
  keyIr:     StringType,               // encodeEastIR bundle hash: (K, V) -> IK, or -> Set<IK>
  multi:     BooleanType,              // declared with `keys` (a Set return) rather than `key`
  valueIr:   OptionType(StringType),   // (K, V) -> P; none ⇒ P is Null
  keyType:   EastTypeType,             // IK
  valueType: EastTypeType,             // P
  buildIr:   StringType,               // the generated build program of §11.2
  runner:    RunnerType,
});
export const RecordStateType = …       // the `$record` envelope, §9.4
export const RecordObjectType = StructType({
  path, mutations, migrations,
  indexes:   DictType(StringType, StringType),   // NEW — name -> RecordIndexObject hash
});
export const MutationObjectType = StructType({
  bodyIr, argTypes, runner,
  form:      StringType,                         // NEW — "reduce" | "edit" | "patch"
  programIr: StringType,                         // NEW — the generated program of §10.2
});
export const RecordCommitType = StructType({
  parent, state, mutation, args, actor, at,
  delta:     OptionType(StringType),             // NEW — the mutation delta object, §10.1
});
```

Every new field is appended last, in landing order (`migrations` and
`indexes` land with different stages, and whichever lands first takes the
earlier position), and every decoder reads every prefix. For the `patch` form
`bodyIr` names the program itself, there being no author body.
`PackageObjectType`, `DatasetRefType` and `StructureType`: **unchanged**. The
applied frontier (§5.2) is a reserved
`$schema` key in the record ref's existing `VersionVector`
(`DictType(String, String)`) — new *state*, but not a new wire shape, on the
`$idem` precedent.

BEAST2 is positional, so `decodeRecordObject` becomes a dual-decoder on the
`decodePackageObject` precedent (`e3-types/src/package.ts:118`) — try current,
fall back to every shorter prefix, defaulting `migrations` to `[]` and `indexes`
to an empty map. Every read path, local
and cloud, must route through it. `RecordMigrationArgsType` (§5.2) is a new
value type with no compatibility surface.

`MigrationObjectType` carries an explicit `elementwise: BooleanType` rather
than inferring the kind from whether `from` is the record's element type. The
inference happens to be unambiguous today, but BEAST2 is positional: adding the
field later is another dual-decode tier, and reading a migration's kind is on
the deploy path. Pay the byte now.

### 12.2 GC is a merge gate, not an optimization

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

The 2026-09-22 revision adds to the gate: `isRecordIndexObjectShape` (its
three IR fields are leaves); `isRecordObjectShape` accepting two to four
fields and pushing every `indexes` value as non-leaf; `isMutationObjectShape`
accepting the two appended fields and pushing `programIr` as a leaf;
`isRecordCommitShape` accepting `delta` as a leaf; and `isRecordStateShape`
(kind `$record`) pushing `primary`, every `indexes[].manifest` and every
`indexes[].index` as non-leaf — the index object must stay reachable from a
historical state after the package that declared it is gone. Survival
fixtures: deploy with indexes → mutate → reindex → gc → read at head and at an
older commit; drop an index → gc.

### 12.3 Compliance surface

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
at 1M rows costs no more than twice a one-row edit at 10k. §9.6 and §10.4 add:
maintained ≡ rebuilt for every index after a mixed mutation sequence; the
whole-apply ≡ segment-wise-apply property over every delta arm; a joined index
page against a whole-value filter; and the generated program's delta
byte-identical across the three runtimes.

## 13. What this does *not* fix

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
  enabler if this is ever pursued. A `partitionTask` over the record already
  re-runs only the partitions whose slices changed, which content-defined
  segments make exact — coarse, but automatic.
- **The `reduce` form's runner cost stays O(n).** Its body and its diff see the
  whole state (§10.2); only its *write* is O(touched). Nor does a `replace`-arm
  patch avoid that diff. The `edit` form's body and apply are O(touched), but
  every form that runs a program is handed the state as a file, which the
  engine writes by streaming the record's segments — O(n) bytes moved, one
  segment held — until runners open a record's segments directly. Only a
  `patch` on a record with no index runs no process, and is O(touched) end to
  end.
- **Down-migrations are not supported.** Rolling a package back over a migrated
  record is refused, not reversed. `invertFor` from the patch system could in
  principle synthesize one, but only for value diffs, not type changes.
- **A record rename is a drop + create.** A migration chain belongs to a record
  identified by name, so renaming one presents as dropping it and minting
  another — losing state and history unless the operator notices. An explicit
  `renamedFrom` on `e3.record` would close it; deliberately left out of v1, but
  `--allow-drop-records` is what stands between a rename and silent data loss.
- **Ad-hoc indexes are not in v1.** An index is declared in the package (§9.3);
  a view that sorts by an undeclared attribute scans. The bulk build of §11.2
  keyed by state hash and index-function hash is the obvious on-demand form,
  deferred until a workload asks for it.
- **The UI contract is a consequence here, not a driver.** An index-ordered
  window is an ordered array (§9.5); the keyed row-source contract in east-ui
  gains an arm for it, and composite keys, in a follow-up. This document sets
  the wire shape and stops there.

## 14. Extension: the same mechanism for `e3.input`

§2 establishes that redeploy silently resets every input to its package default.
The machinery generalizes — an input's type identity is the same derived hash, a
migration over it is the same East function, minus the commit chain — so
`e3.input(name, type, default, { retain: true })` would carry the prior value
forward, migrating it when the type changed.

Deliberately **not** in the main proposal: flipping the default is a breaking
change to every existing deployment, and the "cache of someone else's truth vs.
ours" distinction in `e3-records-storage.md` is *why* inputs reset. Opt-in after
the record path is proven, or not at all.

## 15. Staging

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

**S3 — paged patch writes.** `e3.patchMutation`, fence bisect, per-segment
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

**SL — the segment-object layout (§8.7).** `CollectionManifestType`, the
encoder door writing segment objects plus a manifest, the content-defined
boundary rule pinned in all three runtimes' writers, the opener at every
reader, the GC recognizer with the `state` non-leaf flip and survival fixtures,
the manifest round-trip and determinism fixtures. Not a stage of the first
draft, named here because everything after it stands on it.

**S5 — secondary indexes (§9).** `e3.recordIndex`, `RecordIndexObjectType`,
`RecordObjectType.indexes`, `RecordStateType` and its door, the GC
recognizers, the index page and find selectors, the range-seek query form,
`e3 record reindex`, genesis builds, the compliance suites. Reads work from S5
alone; before S7 an index is built by one detached run of its build program.

**S6 — the mutation delta (§10).** `MutationDeltaType`, `e3.editMutation` and
`e3.patchMutation`, the generated program at export, `MutationObjectType.form`
and `.programIr`, `RecordCommitType.delta`, the manifest-aware lazy opener in
the three runtimes with staging by links, the in-process apply of §10.4 with
its property tests. Subsumes S3: the paged patch write is the `patch` form's
apply.

**S7 — steps for records (§11).** The record template and commit step, index
builds and reindexes on deploy and on demand, migrations by template (§11.3),
the large-write threshold and its map units (§11.4).

**Emit the composition plan from S3 onward, not only in S4.** A `ComposePart[]`
that a local backend simply materializes costs nothing locally, and it means the
S3 backend is a *backend implementation* rather than a second write path to keep
in sync with the first. Moot under §8.7, where a local backend writes the same
segment and manifest objects the S3 backend does.

S1 and S3 are independent; S2 sits between them and reuses S3's geometry
wrapper if S3 lands first. Recommended order is S1 → S3 → S2 → S4 if
interactive latency is the binding constraint, S1 → S2 → S3 → S4 if the
blocking need is migrating an existing large record. S0 precedes both orders.

**Revised order (2026-09-22).** S0 → SL → S1 → S5 → S6 → S7. S3 is subsumed by
S6 (the `patch` form's apply), S2 by S7 (migrations by template), and S4 is
dropped as §8.7 already says. S5 ships reads before S6 ships writes; S6
without S7 serves interactive edits and small batches through the in-process
apply, which is the user-visible capability of this revision.

## 16. Open questions

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
  a task and has no cache key). Sequential first. *Resolved 2026-09-22:* as the
  template of §11.3 — partitioned units whose synthesized task object and
  slice inputs are their cache key.
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
- **Boundary-rule constants (§8.7 rule 3). Resolved 2026-09-22** as
  `cdc/fnv1a64/256-1024-4096/1` — `MIN 256`, `TARGET 1024`, `MAX 4096`, FNV-1a
  64-bit over the key's canonical bare encoding, the cut falling *before* the
  boundary key. See §8.7 rule 3 for why each is what it is. The sub-question
  of a byte bound is decided there too (2026-09-23): not a plain cap on
  logical bytes, which would cost wide-row edits their locality, but a
  size-aware boundary test under a new rule id — #788.
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
- **Naming — resolved.** Qualifier-first nouns throughout, as `partitionTask`
  and `streamTask`: `e3.patchMutation`, `e3.editMutation`, `e3.recordIndex`,
  `e3.elementMigration`.
- **The large-write threshold** (§11.4). `MUTATION_INLINE_MAX_SEGMENTS` is a
  pinned constant; where it sits is a measurement — the in-process apply's
  per-segment cost against a unit's spawn — and the fixture that pins both
  paths to the same bytes is what makes moving it safe.
- **The TypeScript sink does not sort.** The C sink spills and merges permuted
  keys; the TypeScript `EmitFileWriter` refuses them, as `streamTask`'s
  contract says every runtime does. §10.2 and §11.2 emit in order so nothing
  here depends on it, but the two runtimes disagree today and should be
  reconciled one way or the other.
- **Cold materialisation on cloud** (§10.6). Whether the runner Lambda's
  segment cache is enough for the `edit` and `reduce` forms on multi-GB
  records, or a fault-on-read opener — libcurl in east-c, a worker-backed
  synchronous fetch in TypeScript — is needed. The `patch` form does not wait
  on the answer.
- **Deploy-time builds on cloud** (§11.5). The job's status surface and how a
  client waits on it; shared with §5's migrations.
- **Where the `reduce` form's diff runs.** In the program (recommended: O(n)
  in the runner, which already holds the new state) or in e3-core from the
  manifest diff (O(changed segments), but e3-core decoding user data at scale
  and a second runner run for the index functions anyway).

## 17. Relationship to existing issues

| Issue | Relationship |
|---|---|
| #413 (scale large keyed-collection records) | §7 supersedes work-item D's `layout` flag and `$chunk` envelope with the v5 segment format (as its own comment suggests), subsumes work-item A for the patch path, and promotes the partial-key reducer follow-on the comment requests into S3. Work-item B (size guardrails) and C (fixtures/benchmarks) stand. Under §8.7 the `$chunk` envelope returns as `CollectionManifestType` (kind `$segments`), still with no per-record layout flag. |
| #635 (composable content addressing) | Hard dependency of S4, and its first concrete consumer. §8.2 answers the issue's open "where do the digests live" question **in favour of the in-container form**: a paged write already ranged-reads the blob's tail for the segment geometry, so index-section digests arrive free, while a side-car costs one extra GET on the hottest path forever. §8.1 gives `composeFrom?()` — named in the issue's "To build" list — a caller. Under §8.7 the composite address is not needed: the manifest is an ordinary object whose own hash is the state's address, and its entries are the per-leaf digests. |
| `e3-records.md` §13 | Resolves the redeploy open question: explicit migrations, with reset as an audited opt-in policy rather than the default. |
| `e3-records-storage.md` | Endorses its prolly-tree direction, on the v5 segment format rather than a new chunk encoding (§8.7 gives that tree its concrete form: a manifest over standalone v5 segment objects), and leaves its auto-compaction ↔ GC-cadence question open (§13). |
| #539 (frozen task inputs) | Unchanged: reducers still receive frozen values, copy-first. |
| e3-cloud#181 | §7 + §8 are the upstream half of the interactive-latency requirement. |
| #779 (records: secondary indexes, the mutation delta, steps for records) | The epic of §9–§11, filed with the 2026-09-22 revision. Its first child delivers #413 work item D as respecified by §8.7; its cloud items depend on #413 work item A; the UI adapts to §9.5's window shape in its last child. |
