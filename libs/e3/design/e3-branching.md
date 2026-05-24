# e3: Branching

Status: Design proposal
Scope: workspace branching for e3 (trunk + named branches per workspace)
Non-goals: full git-style commit history, cross-workspace branch references, diff-storage of branch state

## 1. Summary

A **workspace** in e3 is the place where data lives, tasks run, and a deployed package's dataflow executes. Today every workspace has a single mutable state. This document specifies how to add **branches** — alternate states forked off a workspace, sharing the same package, isolated from the parent's mutations and runs.

Headline decisions:

1. **Trunk is implicit, not named.** No `"main"`, no `"trunk"` keyword. A workspace whose `forkedFrom` is `none` is a trunk; one whose `forkedFrom` is `some` is a branch. The "trunk" concept exists only in user-facing prose, never in any East type or storage key.
2. **Branches store whole `DatasetRef` values, not diffs.** Fork is materialized (deep-copy refs); the object store deduplicates the underlying values. The patch system is used for *diff display* and *merge*, not for representing branch state.
3. **`WorkspaceRef` is an East value.** `StructType({ workspace: StringType, branch: OptionType(StringType) })`. Every API and wire type that previously carried a workspace name string now carries a `WorkspaceRef`. Trunk = `branch: none` — encoded by absence, not by sentinel.
4. **Storage backends gain no new axis.** A single `e3-core` helper flattens `WorkspaceRef → string` (using `<ws>/branches/<name>` for branches). Storage continues to operate on opaque workspace-key strings.
5. **No history.** Only current state is retained, plus a small per-branch fork-base snapshot (per-dataset hash map) so 3-way merge has a third leg. The fork-base is a GC root.

## 2. Mental model

A workspace `production` and its branches `production:experiment`, `production:review` share:

- A package (snapshotted at fork time as `packageHash`).
- A data structure (the package's `Structure`).
- The execution cache (executions are global and content-addressed; identical inputs hit the same `executions/<taskHash>/<inputsHash>/...` regardless of which workspace ran the task).

They do not share:

- Per-dataset refs (`workspaces/<ws>/data/*.ref` vs `workspaces/<ws>/branches/<branch>/data/*.ref`).
- Workspace state (`state.beast2`).
- Locks (each (`ws`, `branch?`) pair has its own lock).
- Dataflow runs (`dataflows/<ws>/<runId>.beast2` vs `dataflows/<ws>/branches/<branch>/<runId>.beast2`).

### Invariants

- A trunk's `WorkspaceState.forkedFrom` is `none`.
- A branch's `WorkspaceState.forkedFrom` is `some({ parent, forkedAt })` where `parent` is a trunk's workspace name (MVP rejects branch-of-branch).
- A branch always exists under its parent on disk; removing a parent trunk requires that no live branches remain (or `--force` cascades).
- A branch's `packageHash` equals the parent's `packageHash` *at fork time* and is independent thereafter (re-deploys on trunk do not propagate).
- The fork-base file `base.beast2` exists for the branch's lifetime; its hashes are GC roots.

## 3. East type changes (`e3-types`)

All persistent and wire-level state is BEAST2-encoded East values, consistent with the rest of `e3-types`.

### 3.1 New: `WorkspaceRefType`

Canonical addressing for any workspace-or-branch.

```ts
// e3-types/src/workspace.ts
export const WorkspaceRefType = StructType({
  workspace: StringType,
  branch: OptionType(StringType),
});
export type WorkspaceRef = ValueTypeOf<typeof WorkspaceRefType>;
```

`branch = none` ⇒ trunk. There is no other encoding of trunk anywhere.

### 3.2 Extend: `WorkspaceStateType`

```ts
// e3-types/src/workspace.ts
export const WorkspaceStateType = StructType({
  packageName: StringType,
  packageVersion: StringType,
  packageHash: StringType,
  deployedAt: DateTimeType,
  currentRunId: OptionType(StringType),
  forkedFrom: OptionType(StructType({
    parent: StringType,        // parent workspace name (always a trunk in MVP)
    forkedAt: DateTimeType,
  })),
});
```

Trunks: `forkedFrom = none`. Branches: `forkedFrom = some({...})`.

### 3.3 New: `ForkBaseType`

The 3-way-merge base, captured at fork time. Stored at `workspaces/<ws>/branches/<branch>/base.beast2`.

```ts
// e3-types/src/branch.ts (new file)
export const ForkBaseType = StructType({
  parent: StringType,
  forkedAt: DateTimeType,
  // keypath (e.g. ".inputs.sales") -> value object hash at fork time
  hashes: DictType(StringType, StringType),
});
export type ForkBase = ValueTypeOf<typeof ForkBaseType>;
```

`hashes` covers every leaf the branch could later mutate. On a `value`-typed `DatasetRef` we store the hash; on `unassigned` or `null`, we omit the entry (no historical hash to anchor a merge against). Diff/merge treat a missing key as "no recorded base; fall back to 2-way overwrite at that leaf".

### 3.4 Extend: `LockOperationType`

```ts
// e3-types/src/lock.ts
export const LockOperationType = VariantType({
  dataflow: NullType,
  deployment: NullType,
  removal: NullType,
  dataset_write: NullType,
  export: NullType,
  branch_create: NullType,
  branch_remove: NullType,
  branch_merge: NullType,
  branch_promote: NullType,
});
```

`branch_create` is acquired against the *parent's* lock to prevent the parent from being mutated during the deep-copy. Each branch then holds its own (`ws`, `branch`) lock independently.

### 3.5 New: `ResolutionType` and merge wire types

`Resolution` from `libs/east/src/patch/types.ts` is a TS-only union; a wire-form is needed so API clients can submit conflict resolutions.

```ts
// e3-types/src/branch.ts
export const ResolutionType = VariantType({
  keepA: NullType,
  keepB: NullType,
  manual: BlobType,   // beast2-encoded resolved leaf value (decoded with the dataset's East type)
});
export type Resolution = ValueTypeOf<typeof ResolutionType>;
```

### 3.6 New: branch API request/result types

Mirroring the pattern of `WorkspaceCreateRequestType` / `WorkspaceDeployRequestType`.

```ts
// e3-types/src/branch.ts
export const BranchCreateRequestType = StructType({
  workspace: StringType,
  branch: StringType,
});

export const BranchRemoveRequestType = StructType({
  workspace: StringType,
  branch: StringType,
});

export const BranchListResultType = StructType({
  workspace: StringType,
  branches: ArrayType(StructType({
    name: StringType,
    forkedAt: DateTimeType,
    packageName: StringType,
    packageVersion: StringType,
  })),
});

export const BranchDiffRequestType = StructType({
  workspace: StringType,
  branch: StringType,
  // optional path filter: empty string ⇒ whole workspace
  path: OptionType(StringType),
  // none ⇒ diff against fork base ("what this branch changed since fork")
  // some('trunk') ⇒ diff against parent's current state
  against: OptionType(StringType),
});

export const BranchDiffResultType = StructType({
  workspace: StringType,
  branch: StringType,
  // keypath -> beast2(PatchTypeOf<T>) blob; the dataset's type lives in the package Structure
  patches: DictType(StringType, BlobType),
});

export const BranchMergeRequestType = StructType({
  workspace: StringType,
  branch: StringType,
  // none ⇒ merge into the same trunk (i.e. parent)
  into: OptionType(StringType),
  // path -> resolution; absent paths must be conflict-free or the merge fails
  resolutions: OptionType(DictType(StringType, ResolutionType)),
  // if true, remove the branch on successful merge
  deleteAfter: BooleanType,
});

export const BranchMergeConflictType = StructType({
  path: StringType,        // keypath inside the dataset, e.g. ".policy.maxHours"
  dataset: StringType,     // dataset keypath, e.g. ".inputs.config"
  valueA: BlobType,        // beast2-encoded patch op from trunk side
  valueB: BlobType,        // beast2-encoded patch op from branch side
});

export const BranchMergeResultType = VariantType({
  merged: StructType({
    // datasets that were successfully written to the merge target
    paths: ArrayType(StringType),
  }),
  conflicts: StructType({
    conflicts: ArrayType(BranchMergeConflictType),
  }),
});

export const BranchPromoteRequestType = StructType({
  workspace: StringType,
  branch: StringType,
});
```

### 3.7 Extend: `WorkspaceInfoType`

`workspaceList` returns both trunks and branches as a flat list, distinguished by the `branch` option. Existing trunk-only consumers filter on `branch.type === 'none'`.

```ts
// e3-types/src/api.ts
export const WorkspaceInfoType = StructType({
  name: StringType,
  branch: OptionType(StringType),       // NEW
  deployed: BooleanType,
  packageName: OptionType(StringType),
  packageVersion: OptionType(StringType),
});
```

### 3.8 Extend: `WorkspaceStatusResultType`

Add `branch: OptionType(StringType)` so status results identify which workspace+branch they describe.

### 3.9 Extend: `parseDatasetPath` semantics

Today `parseDatasetPath("production.inputs.sales")` returns `{ ws: "production", path: [...] }`.

Extend to recognise a `:branch` suffix on the workspace segment:

```ts
parseDatasetPath("production:experiment.inputs.sales")
// → { ref: { workspace: "production", branch: some("experiment") }, path: [field("inputs"), field("sales")] }
```

The return type changes from `{ ws: string, path: TreePath }` to `{ ref: WorkspaceRef, path: TreePath }`. Callers must be updated; the change is mechanical because every existing caller already passes the `ws` string into a function that should now take a `WorkspaceRef`.

`:` is the chosen separator because:

- `.` is taken by keypath segments.
- `@` is taken by `name@version` package specs.
- `/` would clash with the storage-flatten convention (see §5).
- `:` is unambiguous, matches git's `ref:path` mnemonic, and is legal inside CLI args without escaping on every platform's shell except Windows-cmd `c:\path` style — workspaces never start with a drive letter so this is fine.

## 4. Concept summary

| Concept | Where it lives |
|---|---|
| Workspace ref (addressing) | `WorkspaceRefType` East value |
| Trunk | a workspace with `forkedFrom = none`; no other marker |
| Branch | a workspace with `forkedFrom = some({...})` |
| Fork base | `ForkBaseType` value at `workspaces/<ws>/branches/<b>/base.beast2` |
| Branch state | `WorkspaceStateType` (extended) at `workspaces/<ws>/branches/<b>/state.beast2` |
| Branch refs | `DatasetRefType` files under `workspaces/<ws>/branches/<b>/data/*.ref` |
| Branch lock | scoped to flattened workspace key (§5) |
| Branch dataflow runs | `dataflows/<ws>/branches/<b>/*.beast2` |
| Executions | global, untouched |

## 5. Storage layout

```
<repo>/
├── objects/                                  # unchanged — content-addressed
├── packages/                                 # unchanged
├── executions/                               # unchanged — global cache
├── dataflows/
│   ├── production/                           # trunk runs
│   │   └── <runId>.beast2
│   └── production/branches/experiment/       # branch runs
│       └── <runId>.beast2
└── workspaces/
    ├── production.beast2                     # trunk state
    ├── production.lock                       # trunk lock
    └── production/
        ├── data/                             # trunk per-dataset refs
        │   └── inputs/sales.ref
        └── branches/
            └── experiment/
                ├── state.beast2              # branch state
                ├── base.beast2               # fork base (merge anchor + GC root)
                ├── data/                     # branch per-dataset refs (sparse-or-dense)
                │   └── inputs/config.ref
                └── (lock at parent dir level — see §5.1)
```

### 5.1 Flattening boundary

The storage backend interface (`StorageBackend` in `e3-core/src/storage/interfaces.ts`) is **unchanged**. It continues to accept opaque workspace-name strings. A single helper in `e3-core` produces those strings from `WorkspaceRef`:

```ts
// e3-core/src/branches.ts
import { WorkspaceRef } from '@elaraai/e3-types';

/** Flatten a WorkspaceRef into the storage-key string used by StorageBackend. */
export function workspaceKey(ref: WorkspaceRef): string {
  return ref.branch.type === 'none'
    ? ref.workspace
    : `${ref.workspace}/branches/${ref.branch.value}`;
}

/** Inverse: parse a storage key back into a WorkspaceRef. */
export function parseWorkspaceKey(key: string): WorkspaceRef {
  const m = key.match(/^([^/]+)\/branches\/([^/]+)$/);
  if (m) return { workspace: m[1]!, branch: { type: 'some', value: m[2]! } };
  return { workspace: key, branch: { type: 'none', value: null } };
}
```

The slash-bearing storage key (`production/branches/experiment`) maps directly into the existing path layouts in `LocalRefStore`, `LocalDatasetRefStore`, `LocalLockService`, etc., because every place those stores construct a path uses `path.join(repo, 'workspaces', name, ...)` style — slashes flow through naturally.

For lock storage that names a `.lock` *file* alongside the workspace state file, we keep the same convention: trunk lock at `workspaces/production.lock`, branch lock at `workspaces/production/branches/experiment.lock`.

### 5.2 Why slash-in-name works

- `RefStore.workspaceList(repo)` — naturally returns both flat trunk names and the slashed branch keys; e3-core decodes via `parseWorkspaceKey`.
- `RefStore.workspaceRead/Write/Remove(repo, name)` — opaque string; the path constructor concatenates segments.
- `DatasetRefStore.{read,write,list,remove,removeAll}(repo, ws, ...)` — same.
- `LockService.{acquire,getState}(repo, resource, ...)` — same.
- `RefStore.dataflowRun*(repo, workspace, ...)` — same.

There is no place in the storage backend that needs to interpret the structure of the workspace key. **e3-core owns the encoding; storage is purely string-keyed.**

## 6. e3-core API

### 6.1 Existing functions: take `WorkspaceRef` instead of `name: string`

All existing workspace-scoped functions (`workspaceCreate`, `workspaceRemove`, `workspaceDeploy`, `workspaceGetState`, `workspaceGetPackage`, `workspaceExport`, `workspaceStatus`, plus dataset get/set/list/status, run/start/watch helpers) change their workspace parameter from `name: string` to `ref: WorkspaceRef`. Internally each function calls `workspaceKey(ref)` once and passes the resulting string into the storage backend.

For ergonomics in TS callers we add an optional positional `branch?: string` parameter on the public surfaces — but this is a thin convenience over `WorkspaceRef`:

```ts
export function workspaceGetState(
  storage: StorageBackend,
  repo: string,
  ref: WorkspaceRef,
): Promise<WorkspaceState | null>;
```

### 6.2 New: `e3-core/src/branches.ts`

```ts
export function workspaceKey(ref: WorkspaceRef): string;
export function parseWorkspaceKey(key: string): WorkspaceRef;
export function isBranch(ref: WorkspaceRef): boolean;
export function trunkOf(ref: WorkspaceRef): WorkspaceRef;

export async function branchList(
  storage: StorageBackend,
  repo: string,
  workspace: string,
): Promise<BranchInfo[]>;

export async function branchCreate(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  branch: string,
  options?: { lock?: LockHandle },
): Promise<void>;

export async function branchRemove(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  branch: string,
  options?: { lock?: LockHandle },
): Promise<void>;

export async function branchDiff(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  branch: string,
  options?: {
    against?: 'base' | 'trunk';   // default 'base'
    pathPrefix?: string;          // optional dataset filter
  },
): Promise<BranchDiffResult>;

export async function branchMerge(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  branch: string,
  options?: {
    into?: string;                                  // default = workspace (the trunk)
    resolutions?: Map<string, Resolution>;          // dataset-keypath -> Resolution
    deleteAfter?: boolean;                          // default false
    lock?: LockHandle;
  },
): Promise<BranchMergeResult>;

export async function branchPromote(
  storage: StorageBackend,
  repo: string,
  workspace: string,
  branch: string,
  options?: { lock?: LockHandle },
): Promise<void>;
```

### 6.3 `branchCreate` algorithm

1. Acquire `branch_create` lock on the parent (`workspaceKey({ workspace, branch: none })`).
2. Read parent's `WorkspaceState`. Reject if not deployed.
3. Reject if branch already exists.
4. Reject if `branch` contains `/`, `:`, or `@`.
5. Reject if parent is itself a branch (MVP).
6. List parent's dataset refs via `storage.datasets.list(repo, parentKey)`.
7. For each ref path: read parent ref, write same ref to branch. (Object store dedup means no value objects are duplicated; only `.ref` files.)
8. Build `ForkBase`: walk refs, collect `{ keypath: hash }` for every `value`-typed ref.
9. Encode and write `base.beast2`.
10. Encode and write branch `state.beast2` with `forkedFrom = some({ parent, forkedAt: now })` and the parent's `packageName` / `packageVersion` / `packageHash`. `currentRunId = none`.
11. Release lock.

The branch is an exact materialised snapshot of the parent. Object dedup makes step 7 cheap — it copies `.ref` files (~hundreds of bytes each) but no value blobs.

### 6.4 `branchDiff` algorithm

For each leaf in the branch's structure:

- Read branch's `DatasetRef`. Skip if `unassigned`.
- Read base value: if `against = 'base'`, look up `ForkBase.hashes[keypath]`; if `against = 'trunk'`, read the parent's current `DatasetRef`.
- If base is missing or both refs are equal hashes, skip.
- Decode both values using the dataset's East type (from the package's `Structure`).
- Compute `diffFor(type)(base, branch)`.
- If non-`unchanged`: encode the patch via `encodeBeast2For(PatchType(type))` and store under `keypath`.

Result is the `BranchDiffResult` East value: `patches: DictType(StringType, BlobType)`.

### 6.5 `branchMerge` algorithm

Three-way merge using `libs/east/src/patch/`:

1. Acquire locks on both `(workspace, none)` (target trunk) and `(workspace, some(branch))` (source). Order: trunk first, branch second.
2. Read `ForkBase`, branch refs, trunk refs.
3. For each leaf the branch *could* have changed (i.e. every keypath in `ForkBase.hashes` ∪ every branch leaf):
   a. Resolve `base = ForkBase.hashes[keypath]` (may be undefined).
   b. Read `trunkRef` and `branchRef`.
   c. If `trunkRef.hash === branchRef.hash`, skip.
   d. If `base === undefined`: 2-way overwrite — write `branchRef` to trunk, no merge needed.
   e. Otherwise: load values, compute `pT = diff(base, trunkValue)` and `pB = diff(base, branchValue)`. Run `mergeWithResolutionsFor(type)(pT, pB, resolutions)`.
   f. If `mergeFor` succeeds: `merged = applyFor(type)(base, mergedPatch)`. Write `merged` to the object store, write a new `DatasetRef` (with version vector merged from inputs) to trunk.
   g. If conflicts remain: collect them into `BranchMergeConflict[]` and abort the merge (no partial writes).
4. If all leaves merged: optionally `branchRemove` if `deleteAfter`. Release locks.
5. If any conflicts: release locks; return `conflicts` variant. Caller resubmits with `resolutions`.

Atomicity: merging touches multiple dataset refs in trunk. We don't have a trunk-wide atomic transaction — the natural boundary is per-dataset. We accept that a conflict in dataset N+1 leaves datasets 0..N already merged. Document this; recommend dry-run via `branchDiff --against trunk` first.

### 6.6 `branchPromote` algorithm

Replace trunk's per-dataset refs with branch's, atomically per-dataset.

1. Acquire locks on trunk and branch.
2. List branch refs.
3. For each ref: copy branch's ref content into trunk's ref slot.
4. If trunk has refs that the branch lacks (e.g. branch was forked, then trunk gained a new dataset via package re-deploy — disallowed in MVP, but defensive): leave untouched.
5. Update trunk's `WorkspaceState.currentRunId` to `none` (the previous run's outputs are no longer guaranteed consistent).
6. Remove the branch (`branchRemove`).

`promote` is essentially "merge but skip the patch system; branch wins". Useful when the user knows trunk hasn't materially changed and just wants the branch's state to become trunk's.

## 7. CLI surface (`e3-cli`)

### 7.1 New subcommand group

```
e3 branch list <repo> <ws>
e3 branch create <repo> <ws> <branch>
e3 branch remove <repo> <ws> <branch>
e3 branch diff <repo> <ws> <branch> [<dataset-path>] [--against base|trunk]
e3 branch merge <repo> <ws> <branch> [--into <ws>] [--delete] [--resolve <path>=keepA|keepB|<file>]...
e3 branch promote <repo> <ws> <branch>
```

### 7.2 Existing commands gain `:branch` suffix

Every command that takes a workspace or dataset path accepts the `:branch` suffix on the workspace segment:

```
e3 get <repo> production.inputs.sales              # trunk
e3 get <repo> production:experiment.inputs.sales   # branch

e3 set <repo> production:experiment.inputs.config ./y.beast2

e3 start <repo> production:experiment
e3 watch <repo> production:experiment
e3 logs <repo> production:experiment <task>
e3 dataset-status <repo> production:experiment.inputs.sales

e3 workspace status <repo> production:experiment
e3 workspace export <repo> production:experiment ./out.zip
e3 workspace remove <repo> production:experiment   # equivalent to: e3 branch remove <repo> production experiment
```

`e3 workspace list <repo>` shows trunks only by default; `--branches` adds branches grouped under their parent.

### 7.3 Conflict resolution UX

```
$ e3 branch merge . production experiment
Merge has 2 conflicts:
  .inputs.config:
    .policy.maxHours: trunk wants 40, branch wants 50
  .inputs.targets:
    [3].id: trunk inserted 'q4-2026', branch inserted 'q4-2026-rev'
Resolve with:
  e3 branch merge . production experiment \
    --resolve '.inputs.config:.policy.maxHours=keepB' \
    --resolve '.inputs.targets:[3].id=manual:./targets-3-id.beast2'
```

The conflict path syntax matches `Conflict.path` from `libs/east/src/patch/path.ts`. Manual values reference local beast2 files.

## 8. Locking & concurrency

Each workspace key (trunk or branch) has its own lock — already supported because `LockService.acquire(repo, resource, ...)` keys on a string. With the flattening helper, branch locks are just a different resource.

### 8.1 Cross-resource lock ordering

`branchCreate`: locks the *parent* with `branch_create` (prevents trunk mutation during deep copy). Holds for the duration of the copy. Branches cannot be created in parallel against the same trunk; this is fine.

`branchMerge`: locks trunk first (`branch_merge`), then branch (`branch_merge`). Always parent-then-child to prevent deadlocks. If two merges target the same trunk, the second waits.

`branchPromote`: locks trunk then branch.

`branchRemove`: locks branch only.

Trunk operations (deploy, run, dataflow) only lock the trunk and are unaffected by branch activity.

### 8.2 Lock state evolution

The new `LockOperation` variants (`branch_create`, `branch_merge`, `branch_promote`, `branch_remove`) decode/encode through the existing `LockOperationType` variant — no change to the lock service interface.

## 9. Reactive dataflow & version vectors

### 9.1 Branches inherit version vectors verbatim

At fork time, each `DatasetRef.versions` (the `VersionVector` field, `Map<keypath, hash>`) is copied as-is. This is correct because:

- A root input's VV is `Map([["<keypath>", "<own-hash>"]])` — identical regardless of which workspace owns it. Branch and trunk share the same VV entry for the same hash.
- A derived dataset's VV references root-input keypaths (not workspaces). After fork, those keypaths now refer to the *branch's* refs (which are hash-identical to trunk's at fork time), so consistency checking still works within the branch.

When the branch mutates a root input, its VV updates as today (`inputVersionVector(path, newHash)`). When the orchestrator runs the branch's dataflow, downstream tasks see the new VV; consistency checks against unchanged inputs use the branch's still-identical hashes. **No changes to `e3-core/src/dataset-refs.ts`**.

### 9.2 Cross-branch staleness is impossible

A task's VV only references its workspace's own root inputs. Branches and trunk never see each other's VVs. So there's no diamond-dependency hazard across the trunk/branch boundary.

### 9.3 Execution cache sharing — the headline win

Executions are keyed on `(taskHash, inputsHash)`. Both are content-addressed. So if branch and trunk run the same task with the same input value hashes, they hit the same cached output. This is automatic; nothing in the dataflow path needs modification. **The biggest practical win of the materialised-fork model.**

## 10. Diff and merge: where the patch system fits

The `libs/east/src/patch/` infrastructure (`diffFor`, `applyFor`, `composeFor`, `invertFor`, `mergeFor`, `detectConflictsFor`, `mergeWithResolutionsFor`, `walkPatch`, `prunePatchFor`, `validatePatchFor`) is used by:

- `branchDiff` — `diffFor` + `walkPatch` for leaf-level UI rendering.
- `branchMerge` — `mergeFor` / `mergeWithResolutionsFor` against the per-dataset 3-way reconstruction described in §6.5.
- The dry-run validation flow — `validatePatchFor` to surface "this branch's changes wouldn't apply cleanly to trunk-now" before the user attempts merge.

It is **not** used for storage. Branch state is whole `DatasetRef` values, not patches.

## 11. Garbage collection

`gcScanWorkspaceRoots` (in `RepoStore`) currently scans `workspaces/<name>.beast2` for `packageHash`, then walks the workspace tree.

Changes:

1. Recurse into `workspaces/<ws>/branches/<branch>/` for each branch's `state.beast2` (its own `packageHash`) and `data/*.ref` files.
2. Read each branch's `base.beast2` and treat every value in `ForkBase.hashes` as a GC root. **This is essential.** Without it, a trunk mutation that drops the only ref to a base hash would let GC reap an object the merge needs.
3. Branch dataflow runs (`dataflows/<ws>/branches/<b>/*.beast2`) are scanned the same way as trunk runs.

Implementation: extend `LocalRepoStore.gcScanWorkspaceRoots` to walk the nested layout. The cursor model is unchanged.

## 12. Workspace export/import

`workspaceExport` currently snapshots a workspace's refs and the deployed package, producing a zip with `data/*.ref`, `objects/*`, `packages/<n>/<v>`, and (optionally) executions.

Changes:

- `workspaceExport(ws, branch?)` — exports either a trunk or a branch.
- The exported package is named after the source: trunks export as today; branches export as `<pkgName>-<branchName>-<timestamp>` by default.
- Branch export does **not** include the parent's refs or the fork base — the export is a self-contained snapshot of the branch's state.
- `workspaceImport`/`packageImport` is unchanged; an imported package always lands as a trunk in the target workspace. To re-establish a branch relationship, the user would need to import to a trunk, then `branch create` on top.

## 13. Schema evolution

Adding `forkedFrom: OptionType(...)` to `WorkspaceStateType` and `branch: OptionType(...)` to `WorkspaceInfoType` is additive. BEAST2 doesn't support unknown-field-skip, so old `state.beast2` files cannot decode under the new type without help.

**Open decision (flag for the user):** how do you want to handle this?

1. **Strict version bump** — write a small migration that reads with the old type, re-encodes with the new type (`forkedFrom = none`), runs once on repo open. Clean but invasive.
2. **Tolerant decode** — extend the beast2 codec to allow trailing `OptionType(none)` fields when missing. Requires core BEAST2 changes; broader impact.
3. **Per-file version byte** — prepend a schema-version byte to `state.beast2`. Reader picks the type. Also invasive but local to e3.

Option 1 is the least surprising and aligns with "we only retain current state": rewrite all state files on first encounter under the new code. Recommend this unless you've already established a different pattern elsewhere in the codebase.

## 14. Open decisions

1. **Branch-of-branch.** MVP rejects (trunk-only parents). Relax later if a real workflow appears.
2. **Default merge target.** `branch merge` defaults `--into` to the parent trunk. (Confirmed in the design discussion.)
3. **`promote` deletes the branch.** Default: yes, with `--keep` to retain. Open: should it instead default to keep and require `--delete`? Lean: delete by default, matches "branch was an experiment, now it's trunk".
4. **Re-deploy on trunk after branches exist.** MVP: allowed; branches keep their old `packageHash` and continue. Future: warn if branches reference a now-orphaned package version (still in `packages/`, but packageHash mismatch suggests divergence).
5. **`:` separator in shell.** Generally fine; flag if any test environment escapes `:` weirdly. Fallback: always accept `--branch <name>` as an explicit flag in addition to `:branch` parsing.
6. **State-file schema evolution.** See §13 — pick option 1 / 2 / 3.
7. **Atomic merge.** §6.5 documents per-dataset atomicity; trunk-wide atomicity would require a journal. Accept per-dataset for MVP.
8. **Partial fork base.** `ForkBase.hashes` only records `value`-typed refs. An `unassigned`/`null` leaf at fork time gives a missing key in `hashes`, which §6.5 falls back to 2-way overwrite for. Verify that's the intended UX; alternative is to record `OptionType(StringType)` in the dict value, distinguishing "unassigned at fork" from "not in fork base".

## 15. Phased implementation plan

### Phase 0 — type additions only (no behaviour change)

- Add `WorkspaceRefType`, `ForkBaseType`, `ResolutionType`, branch request/result types to `e3-types/src/branch.ts`.
- Extend `WorkspaceStateType.forkedFrom`, `LockOperationType` variants, `WorkspaceInfoType.branch`, `WorkspaceStatusResultType.branch`.
- Re-export from `e3-types/src/index.ts`.
- Decide schema-evolution strategy (§13) and apply it for `WorkspaceStateType`.
- Run the existing test suite; everything still passes (additive change, trunks have `forkedFrom = none`).

### Phase 1 — internal API takes `WorkspaceRef`

- Add `e3-core/src/branches.ts` with `workspaceKey`, `parseWorkspaceKey`, `isBranch`, `trunkOf`.
- Migrate every `e3-core` workspace-scoped function to take `WorkspaceRef` (positional) instead of `name: string`. Internally call `workspaceKey(ref)` once and use the resulting string against the storage backend.
- Update `parseDatasetPath` to return `{ ref: WorkspaceRef, path: TreePath }` and recognise the `:branch` suffix.
- Update CLI argument parsing in `e3-cli` to construct `WorkspaceRef` from the parsed ref+branch.
- All existing CLI behaviour unchanged because every CLI caller passes `branch: none` and the storage key is unchanged for trunks.

### Phase 2 — `branch create / list / remove`

- Implement `branchCreate`, `branchList`, `branchRemove` in `e3-core/src/branches.ts`.
- Wire the new lock variants.
- Add `e3 branch create|list|remove` CLI subcommands.
- Add `:branch` suffix routing for `e3 get|set|start|watch|logs|workspace status` (each command resolves its `WorkspaceRef` and calls existing functions; no per-command logic changes).
- Test: fork a workspace, verify branch is independent, verify executions are shared via cache.

### Phase 3 — `branch diff`

- Implement `branchDiff` against `base` and against `trunk`.
- Render via `walkPatch` for terminal UX.
- Add `e3 branch diff` CLI subcommand.

### Phase 4 — `branch merge` and `branch promote`

- Implement `branchMerge` with `mergeFor` / `mergeWithResolutionsFor`.
- Implement `branchPromote` (no patch system needed).
- Add `e3 branch merge|promote` CLI subcommands.
- Conflict reporting and `--resolve` argument parsing.

### Phase 5 — GC & export integration

- Extend `gcScanWorkspaceRoots` to recurse into `branches/` and read `base.beast2` hashes as roots.
- Extend `workspaceExport` to accept `branch?: string` and produce branch-scoped zips.
- Add fuzz scenarios that mix trunk operations and branch operations against the same workspace (under `test/fuzz/scenarios/`).

### Phase 6 — API surface

- Add branch endpoints to `e3-api-server` and matching client functions in `e3-api-client`, using the wire types from §3.6.
- Add API compliance tests in `e3-api-tests`.
- Update remote command handling in `e3-cli` to call the new endpoints.

## 16. Testing checklist

- Fork → mutate input on branch → run dataflow on branch → verify trunk dataflow output unchanged.
- Fork → run dataflow on trunk and on branch with identical inputs → verify both hit the same execution cache entry.
- Fork → mutate input on trunk → verify branch unchanged.
- Branch diff against base shows expected patches.
- Branch diff against trunk after concurrent trunk mutation shows three-leg picture.
- Merge with no conflicts: trunk has both branch and trunk-side changes.
- Merge with conflicts: returns `conflicts` variant; resubmitting with `resolutions` succeeds.
- Promote: trunk now equals former branch state; branch removed.
- GC after fork retains base hashes; GC after branch removal collects orphaned objects.
- Trunk removal with branches present: rejected without `--force`.
- Branch-of-branch creation: rejected.
- `:` parsing edge cases: `production:` (empty branch — reject), `production:a:b` (reject), `production:experiment` ✓.
- Lock cross-talk: `branch_create` blocks trunk `dataset_write`; trunk `dataflow` does not block branch `dataflow`.
- Schema evolution: an old `state.beast2` decodes via the chosen migration path.
