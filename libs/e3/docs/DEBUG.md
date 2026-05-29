# DEBUG — Windows e3 transfer round-trip (`unassigned input`)

Working notes for the one remaining red leg on the
`feat/east-c-msvc-build` cross-OS CI work.

**Status (2026-05-28): root-caused and fixed; pending a clean rebuild +
integration run in a build-capable directory.** Delete this file once CI is
green and the change is committed.

## The failing test

`round-trip local -> remote -> local preserves data integrity`
— `libs/e3/packages/e3-api-tests/src/suites/transfer.ts:325`, run from
`libs/e3/test/integration/src/api-compliance.spec.ts` (in-process
`e3-api-server` on `localhost`, per-test repos).

What it does, in order:

1. Create the **diamond** package (`createDiamondPackageZip`,
   `fixtures.ts:136`): inputs `a`, `b`; tasks `left=a+b`, `right=a*b`,
   `merge=left+right`.
2. Import + deploy to **local repo 1**, `dataset set a=20 b=3`,
   `dataflow run` → asserts `merge == 83`. ✅ (works on every OS)
3. `workspace export … --name diamond-snapshot` → captures the workspace
   state (a=20, b=3) into a new package (`workspaceExport`,
   `workspaces.ts:362`).
4. `package import` to the **remote** API server.
5. Deploy on remote, `dataflow run` → **FAILED on Windows** with
   `Task 'left' has unassigned input`.

Passed on Linux/macOS; failed only on the Windows runner.

## Root cause (CONFIRMED)

**The dataset paths are *nested*, not top-level — and `walkDir` produced
backslash refs-map keys on Windows that `deploy` then failed to look up.**

The earlier version of this note asserted "all five dataset paths are
top-level (no `/`)" and used that to *rule out* the `walkDir` backslash bug.
**That assertion was wrong.** The e3 SDK lays datasets out under nested
trees:

- `e3.input('a', …)` → path `.inputs.a` → refPath **`inputs/a`**
  (`packages/e3/src/input.ts:57`)
- `e3.input('b', …)` → refPath **`inputs/b`**
- task output → path `.tasks.<name>.output` → refPath
  **`tasks/<name>/output`** (`packages/e3/src/task.ts:91`), plus
  **`tasks/<name>/function_ir`**

Verified live — `storage.datasets.list()` for the deployed diamond returns:

```
["inputs/a","inputs/b",
 "tasks/left/function_ir","tasks/left/output",
 "tasks/merge/function_ir","tasks/merge/output",
 "tasks/right/function_ir","tasks/right/output"]
```

Every dataset path is multi-segment, so the `walkDir` separator bug applies
to **all of them**, `inputs/a` and `inputs/b` included.

### The mechanism

1. **Export** (`workspaceExport`, `workspaces.ts:402`) builds the package's
   inline `refs` map (`PackageObject.data.refs`,
   `Map<refPath, DatasetRef>`) by keying on whatever
   `storage.datasets.list()` returns.
2. `list()` → `LocalDatasetRefStore.walkDir` computed the key with
   `path.relative(baseDir, fullPath)`. On Windows that yields
   **`inputs\a`** (backslash); on POSIX, `inputs/a`.
3. **Deploy** (`writeRefsFromPackageRecursive`, `dataset-refs.ts:377`) walks
   the package *structure* and builds each leaf's refPath as
   `pathPrefix + '/' + fieldName` → always **`inputs/a`** (forward slash).
4. `refs.get('inputs/a')` misses the `inputs\a` key → falls back to
   `variant('unassigned', null)`.
5. The run then reads `inputs/a` / `inputs/b` as `unassigned` →
   `stepPrepareTask` throws `Task 'left' has unassigned input`
   (`steps.ts:550`).

Windows-only because `path.relative` / `path.sep` only emit `\` on Windows;
on POSIX the keys already matched.

### Why only the *remote* step tripped on it

Not a local-vs-remote difference in code — both run on the same Windows
box. The difference is **who supplies the input values**:

- Step 2 (local) deploys, then does `dataset set a` / `dataset set b`,
  which **overwrite** whatever deploy wrote. That masks the broken ref
  restoration entirely.
- Step 5 (remote) relies **solely** on deploy restoring the snapshot's
  refs — no `dataset set` follows — so it is the first place a broken
  restore can surface. (Step 8, the local-repo-2 deploy of the same
  snapshot, would have failed the same way had the test reached it.)

## The fix (in tree, uncommitted)

`LocalDatasetRefStore.ts:128` — normalize separators in `walkDir` so refs
keys are forward-slash on every OS, matching the deploy lookup:

```ts
const relative = path.relative(baseDir, fullPath).split(path.sep).join('/');
```

This is the single change that fixes bug #2. **Keep it.**

### Proof (without east-py)

The original repro blocker — `dataflow run` needs `east-py` on PATH — does
**not** block verifying this fix, because `inputs/a` / `inputs/b` are set by
`dataset set` (plain value refs), not computed by a task. Reproduced the
exact export → import → deploy round-trip with the real diamond fixture,
setting the inputs directly and skipping task execution:

- **With the fix:** after the round-trip, `inputs/a` and `inputs/b` come
  back `type=value`. ✅ (task `left` would no longer see an unassigned
  input.)
- **Mechanism check:** `path.win32.relative('…/data', '…/data/inputs/a.ref')`
  → `inputs\a`; `new Map([['inputs\\a', …]]).get('inputs/a')` → `undefined`
  → `unassigned`. With the normalization the key is `inputs/a` → hit.

## Bug #1 — orchestrator error never persisted (FIXED, kept)

Independent robustness fix, also kept. Original CI symptom was a **300 s
hang**, not a clean failure: when `runExecutionLoop` threw (e.g. the
`unassigned input` above), success-path finalization was skipped, so the
run's persisted status stayed `running` forever, and a **remote**
`dataflow run` polled it until the test timeout.

Fix (`LocalOrchestrator.ts`, the `catch` before the `finally`): on a thrown
error, persist a terminal `failed` status via
`stateStore.updateStatus(…, 'failed', { error })`, then rethrow. Pollers
observe the failure promptly (~19 s instead of 300 s). Independent of bug
#2 — it just turns any future hang into a fast, legible failure. **Keep.**

## Current working-tree state

Only two tracked files differ from HEAD; both are the fixes to keep:

| File | Change | Disposition |
|---|---|---|
| `e3-core/src/storage/local/LocalDatasetRefStore.ts` | `walkDir` separator normalization | **fix for bug #2 — keep** |
| `e3-core/src/dataflow/orchestrator/LocalOrchestrator.ts` | persist `failed` status on thrown error | **fix for bug #1 — keep** |

All debug scaffolding has been removed / reverted to HEAD:
- `dataset-refs.ts` — `[DEPLOY]` logs reverted.
- `LocalTaskRunner.ts` — `[RUN]` logs reverted.
- `LocalOrchestrator.ts` — `[ORCH]` logs removed (only the bug #1 `catch`
  remains).
- `api-compliance.spec.ts` — test timeout restored to `300_000`.

> Note: `e3-core/dist/` still holds the **old** build with instrumentation —
> it has not been rebuilt yet (the OneDrive path with spaces breaks
> tsc/pnpm). Rebuild after relocating; don't be misled by stale `[DEPLOY]`
> output from the old dist.

## Next steps (ordered)

1. **Move the repo to a build-capable directory** (no spaces / not under
   OneDrive sync) and `pnpm install` if needed.
2. Rebuild: `pnpm --filter @elaraai/e3-core build` (or `cd libs/e3 && make
   build`).
3. Run the integration round-trip. Locally needs `east-py` on PATH
   (see [`../../../docs/WINDOWS_SETUP.md`](../../../docs/WINDOWS_SETUP.md));
   the Windows CI leg already installs it. The input-ref round-trip is
   already proven (above); this run also exercises task execution
   end-to-end.
   ```bash
   # from libs/e3/test/integration, after the e3-core build + `pnpm run build`
   node --enable-source-maps --test-reporter=spec --test-concurrency=1 \
        --test-name-pattern="round-trip local" --test 'dist/**/*.spec.js'
   ```
4. When green: **delete this file**, drop the temporary
   `docs/WINDOWS_SETUP.md` / `scripts/windows-dev-env.sh` scaffolding if no
   longer needed, and commit (walkDir normalization = bug #2; orchestrator
   failed-status persistence = bug #1).

## File map

| Concern | Location |
|---|---|
| Failing test | `packages/e3-api-tests/src/suites/transfer.ts:325` |
| Diamond fixture | `packages/e3-api-tests/src/fixtures.ts:136` |
| Input path layout (`inputs/<name>`) | `packages/e3/src/input.ts:57` |
| Task output path layout (`tasks/<name>/output`) | `packages/e3/src/task.ts:91` |
| Export workspace→package | `packages/e3-core/src/workspaces.ts:362` |
| Refs-map keys built from `list()` | `packages/e3-core/src/workspaces.ts:402` |
| Package import (refs inline) | `packages/e3-core/src/packages.ts:182` |
| Deploy → write refs (forward-slash lookup) | `packages/e3-core/src/dataset-refs.ts:377` |
| Run → resolve input ref | `packages/e3-core/src/dataflow.ts:634` |
| Throw site | `packages/e3-core/src/dataflow/steps.ts:550` |
| **Fix #2 — walkDir normalization** | `packages/e3-core/src/storage/local/LocalDatasetRefStore.ts:128` |
| **Fix #1 — persist failed status** | `packages/e3-core/src/dataflow/orchestrator/LocalOrchestrator.ts` (`catch` before `finally`) |
