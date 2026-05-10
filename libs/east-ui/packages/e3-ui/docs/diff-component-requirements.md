# Diff component — requirements

Status: locked-in requirements after BA discovery. Drives design of:

- **`Data.bindStaged`** — new platform fn in `e3-ui/src/data.ts` alongside `Data.bind`.
- **`Diff` UI component** — new factory + IR in `e3-ui` (component itself, since it's bound to `Data.bindStaged`'s closure surface). React renderer lives in `e3-ui-components`.
- **3-way merge primitives** — new functions in `libs/east/src/patch/` next to the existing `diff` / `applyPatch` / `composePatch` / `invertPatch`. Exhaustively tested at the patch-system layer.

---

## 1. Problem

East UI apps bind UI inputs to e3 datasets. Today every edit writes
through to the dataset immediately (`Data.bind` returns `write` /
`writeAndStart` closures that hit the server). For workflows where the
user accumulates many edits across multiple inputs and only wants to
commit them as a coherent set — policy review, fermentation protocol
tweaks, scheduling changes, contract clause edits — there is no
"transactional" path. Users either:

- Commit each edit immediately (no atomicity, no review, no undo).
- Build bespoke staging UIs per app (expensive, inconsistent).

The asked-for capability: **a transactional staging layer for bound
inputs, plus a reusable Diff component that surfaces all pending
staged changes for a developer-chosen set of bindings, with a single
commit gesture and merge-aware conflict resolution.**

---

## 2. Personas

| Persona | Cares about |
|---|---|
| **Developer** (e3-UI app builder) | Single-line ergonomics on the staged bind; explicit control over which staged inputs surface in which Diff; full TS typing end-to-end. |
| **End user** (frontline business worker — workforce manager, winemaker, ops manager, etc.) | Clarity on what's pending; per-change accept/reject; confidence that Apply commits the intended subset; clear handling when the server has moved underneath them. |

---

## 3. Canonical use cases

1. **Single-form transactional edit.** Form has 4 inputs. User edits 3,
   reviews the Diff, applies. Server state moves from V₀ to V₁ in one
   atomic write.
2. **Long-running multi-page edit.** User edits across SPA pages over
   minutes; staged state persists in the browser across navigation
   and across reload.
3. **Table cell edits with deferred commit.** Cell change handlers
   call `staged.write(...)` on pre-existing handles. A Diff drawer
   attached to the table shows pending edits for *those handles
   only* — not unrelated stages elsewhere in the app.
4. **Server-side drift during review.** While the user has staged
   edits, another actor (or a recompute) changes the server value.
   The Diff surfaces the conflict, the user resolves per-leaf
   ("keep yours" / "keep theirs" / "manual"), then commits.
5. **Discard.** User decides not to apply. Click discard, staged
   buffer is cleared, server unchanged.

---

## 4. Architecture decisions (locked)

### 4.1 `Data.bindStaged` (in `e3-ui/src/data.ts`)

Distinct generic platform fn from `Data.bind`. Same shape: type tuple +
path + struct of typed closures.

```ts
Data.bindStaged([T], path) -> StructType({
    /** Reactive overlay: staged value if pending, else server value. */
    read:     FunctionType([], T),
    /** Local-only write — updates the staging buffer, NOT the server. */
    write:    FunctionType([T], NullType),
    /** Server snapshot, no overlay. Used for diffing / conflict detection. */
    original: FunctionType([], T),
    /** Has staged change pending? */
    pending:  FunctionType([], BooleanType),
    /** Flush staged → server, running 3-way merge against current server. */
    commit:   FunctionType([], NullType),
    /** Drop the staged value, keep the server value. */
    discard:  FunctionType([], NullType),
})
```

Notes:
- **No `writeAndStart`** — staged writes don't trigger dataflow until commit.
- **`pending()` is orthogonal to `Data.bind.status()`.** A path can
  be staged AND server-stale; both states are surfaced independently.
- Same path can be bound in both modes — `Data.bind(path)` for direct
  reads/writes, `Data.bindStaged(path)` elsewhere for staged. Single
  underlying buffer per path.

### 4.2 Buffer storage (in `e3-ui-components`)

Per-path keyed. Two `Data.bindStaged([T], path)` calls to the same
`path` share the same buffer entry. Buffer entry shape:

```ts
StagedEntry<T> = {
    snapshot: T,         // server value at the moment staging began
    buffered: T,         // current locally-edited value
}
```

**Persistence: browser-session via localStorage.** Survives reload
within the same tab. Cross-tab is best-effort (last-write-wins on
localStorage); full cross-tab synchronisation is non-goal for v1.

The snapshot is captured the FIRST time `write()` is called on a
previously-unstaged path. Subsequent writes update `buffered` only;
`snapshot` stays pinned until commit / discard.

### 4.3 `Diff` component (in `e3-ui`)

The Diff factory is in `e3-ui` — same package as `Data.bindStaged` —
because its inputs ARE staged-binding handles. Renderer in
`e3-ui-components`.

```ts
Diff.Root({
    staged: [handle1, handle2, …],   // array of staged-binding handles
    // visual config: mode, hideUnchanged, maxDepth, style, …
    // lifecycle hooks: onCommitted, onDiscarded
})
```

- **Caller enumerates handles** — no auto-discovery, no scope tokens.
- The Diff iterates handles, computes the per-handle patch via
  `East.diff(snapshot, buffered)` at render time, walks each, renders
  rows.
- Per-row accept/reject for selective commit (toggling which leaves
  to include in the eventual commit).
- Apply button triggers the merge-aware commit flow (§ 4.4).

### 4.4 3-way merge primitives (in `libs/east/src/patch/`)

The conflict-resolution machinery is general patch-system work — not
UI-specific — and belongs in `libs/east/src/patch/` next to the
existing `diff` / `applyPatch` / `composePatch` / `invertPatch`. With
exhaustive tests at the patch layer, the UI consumes a stable
merge API.

New API additions:

```ts
/** Identifies overlapping paths between two patches over the same T.
 *  Returns the set of conflict descriptors, empty if patches don't overlap.
 *  Pure function — no merge attempted. */
export function detectConflicts<T extends EastType>(
    patchA: Expr<PatchTypeOf<T>>,
    patchB: Expr<PatchTypeOf<T>>,
    type: T,
): ExprType<ArrayType<ConflictType>>;

/** 3-way merge: given a snapshot and two divergent patches against it,
 *  produce a merged patch.
 *  Throws ConflictError (or returns ConflictType) when the two patches
 *  touch the same leaf with different replacements.
 *  Equivalent in spirit to `git merge` on a per-leaf granularity. */
export function mergePatch<T extends EastType>(
    patchA: Expr<PatchTypeOf<T>>,
    patchB: Expr<PatchTypeOf<T>>,
    type: T,
): ExprType<PatchTypeOf<T>>;

/** Variant of mergePatch that takes a per-conflict resolution map.
 *  For each path identified as conflicting, the resolution dictates
 *  which side wins (or a manual replacement value). */
export function mergePatchWithResolutions<T extends EastType>(
    patchA: Expr<PatchTypeOf<T>>,
    patchB: Expr<PatchTypeOf<T>>,
    resolutions: Expr<DictType<StringType, MergeResolutionType>>,
    type: T,
): ExprType<PatchTypeOf<T>>;
```

Plus supporting types (in `libs/east/src/patch/types.ts`):

```ts
ConflictType = StructType({
    path: StringType,                // dot-encoded path to the leaf
    valueA: <…opaque carrier…>,      // patchA's intended replacement
    valueB: <…opaque carrier…>,      // patchB's intended replacement
});

MergeResolutionType = VariantType({
    keepA: NullType,                 // user picks A's leaf
    keepB: NullType,                 // user picks B's leaf
    manual: <T-or-leaf-typed value>, // user supplies a fresh leaf value
});
```

(The `<opaque carrier>` and `<T-or-leaf-typed value>` placeholders
hit the same parametric-polymorphism wall as before — implementation
will decide between path-keyed string transport vs a new East-core
boxed-value type. **TBD at implementation; doesn't affect UI API.**)

Tests at `libs/east/src/patch/*.spec.ts` cover the truth table:
primitive replace × primitive replace; struct field disjoint vs
overlapping; array op disjoint (different keys) vs overlapping (same
key); dict ops; variant-tag changes; nested patches; non-overlapping
patches under nested struct/array combinations; etc.

### 4.5 Commit flow

When the user clicks Apply on a Diff:

1. For each staged handle, fetch the current server value
   (`server_now`) and the snapshot (`handle.original()`).
2. Compute `patch_user = East.diff(snapshot, buffered)`.
3. Compute `patch_server = East.diff(snapshot, server_now)`.
4. Attempt `mergePatch(patch_user, patch_server, T)`:
   - **No conflicts** → apply merged patch to `server_now`, write
     to server, fire `onCommitted`. Buffer cleared.
   - **Conflicts present** → renderer flips into "conflict mode":
     - For each conflict, render a chooser row with three options:
       "keep yours" / "keep theirs" / "manual edit".
     - Apply disabled until all resolved.
     - On retry, call `mergePatchWithResolutions(...)` with the
       collected resolutions and proceed.

### 4.6 Visual style

Follows the existing Elara AI brand sheet
(`east-ui-components/CLAUDE.md`): brand teal, cool green-gray
neutrals, soft chips with same-hue borders, status colours always
paired with glyphs, DM Sans / Inter Tight / JetBrains Mono.

The HTML mock at `docs/diff-component-mockup.html` (in this
package's docs) is the visual contract for the renderer.

---

## 5. DX guarantees

```ts
// Bind once, statically, inside Reactive.Root:
const policy   = $.let(Data.bindStaged([PolicyType],   policyPath));
const schedule = $.let(Data.bindStaged([ScheduleType], schedulePath));

// Use in inputs as you would Data.bind handles:
StringInput.Root($.let(policy.read().maxWeeklyHours.toString()), {
    onChange: hrs => $(policy.write({ ...current, maxWeeklyHours: BigInt(hrs) })),
});

// Surface for review with a single line:
Diff.Root({ staged: [policy, schedule] });
```

- T inferred end-to-end. `policy.read()` returns `Expr<PolicyType>`;
  conflict resolution preserves typing.
- `Diff.Root` accepts the array of handles directly. Developer
  controls scope explicitly.
- localStorage persistence is invisible at the call site.
- Conflict resolution is invisible at the call site — surfaces only
  inside the Diff renderer when it actually happens.

---

## 6. Non-goals

- **3+ way merge.** Only the snapshot / current-server / current-buffered triple.
- **Cross-tab live synchronisation.** localStorage gives best-effort
  same-tab persistence; concurrent edits across tabs are not coordinated.
- **Sub-leaf merge granularity.** Conflict resolution operates at
  the leaf granularity of `PatchTypeOf<T>` — whole-leaf "keep mine /
  keep theirs". No partial field-content merging.
- **Auto-merge heuristics for overlapping changes.** Overlap always
  requires explicit user resolution.
- **Server-side staging.** Buffer is client-side only.
- **Audit trail / multi-stakeholder approval workflows.** Each Diff
  is one user's commit decision.
- **Diffing types the renderer can't structurally walk** (function
  values, opaque blobs).

---

## 7. Open questions to resolve at design time

| # | Question |
|---|---|
| 7.1 | Naming for the conflict-row primitive (`DiffConflictRow`? `ConflictResolver`?) |
| 7.2 | Default behaviour for `discard()` — silent, or trigger a confirmation prompt? Probably configurable. |
| 7.3 | What happens to the staged buffer when the `DataProvider` context unmounts? Keep (localStorage) or clear? Probably keep. |
| 7.4 | How does the Diff variant tag get registered into east-ui's UIComponentType from e3-ui without inverting the package dep? Likely via UIComponentType extension or a registered renderer. **Implementation decision; affects e3-ui ↔ east-ui boundary.** |
| 7.5 | Conflict UI for *primitive* T — same chooser, just without nesting. |
| 7.6 | Snapshot freshness: pin at first write, never refresh until commit/discard? |
| 7.7 | Two `Data.bindStaged` handles for the same path in one Diff — dedupe by path? **Yes.** |
| 7.8 | "Manual edit" resolution UI — inline editor per conflict, or pop a value-edit modal? |

---

## 8. Success criteria

- **End user**: can review pending changes, accept/reject leaves, and apply (or resolve conflicts) within a single screenful, ≤ 30 seconds for a typical (≤ 20 leaf) change set.
- **Developer**: can wire transactional editing in ≤ 6 lines (bind handle + Diff call site). Full TS typing on every step. No manual key management, no manual buffer plumbing.
- **Patch-merge layer**: exhaustive tests across every patch-shape combination in `libs/east/src/patch/`.
- **Conflict path**: when the server moves underneath, the user sees clear conflict rows with three resolution paths (yours / theirs / manual) and can commit successfully after resolving.

---

## 9. Implementation phasing

**Phase A — Patch-merge primitives** (`libs/east/src/patch/`).
- New `mergePatch`, `detectConflicts`, `mergePatchWithResolutions`,
  `ConflictType`, `MergeResolutionType`.
- Exhaustive `merge.spec.ts` covering every type combination.
- No UI dependency yet — pure patch-system work.

**Phase B — `Data.bindStaged` platform** (`e3-ui/src/data.ts` +
`e3-ui-components/`).
- New generic-platform function alongside `Data.bind`.
- TS-side store + localStorage backing in `e3-ui-components`.
- Unit tests on the closure semantics (read overlay, write, commit,
  discard) — no merge yet (commit just last-writes-wins).

**Phase C — `Diff` component (review-only)** (`e3-ui/` + `e3-ui-components/`).
- New form-shaped component.
- Renders staged changes per handle, per-leaf accept/reject, Apply.
- Apply uses Phase A's `mergePatch` (conflict surfaces as runtime
  error / generic alert; no chooser UI yet).

**Phase D — Conflict resolution UI** (`e3-ui-components/`).
- Conflict-row primitive with chooser UI.
- "X conflicts to resolve" header state.
- Apply blocked until resolved; uses
  `mergePatchWithResolutions` for the retry.

**Phase E — Examples + showcase** (`e3-ui-showcase`).
- Showcase scenarios for each canonical use case (§ 3).
- Examples in `e3-ui/test/diff.examples.ts`.

Each phase is independently shippable and demonstrates a real
capability gain over the prior state.
