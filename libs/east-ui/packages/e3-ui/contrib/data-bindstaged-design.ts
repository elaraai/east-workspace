/**
 * `Data.bindStaged` + `Diff.Root` — design sketch.
 *
 * Status: design iteration. Not shipped, not imported by anything in src/.
 * Run `npx tsc --noEmit` from the package root to type-check.
 *
 * Background: see `docs/diff-component-requirements.md` (in this package's
 * docs) for the full requirements pass that this design is built against.
 *
 * Highlights:
 *   - `Data.bindStaged` is a NEW closure-returning generic platform fn,
 *     distinct from `Data.bind`. Lives in `src/data.ts`. Returns
 *     transactional staging accessors:
 *     `{ read, write, original, pending, commit, discard }`.
 *   - The buffer is per-path, value-form, snapshot-pinned at first write,
 *     localStorage-persisted (in `e3-ui-components`).
 *   - `Diff.Root({ staged: [...handles] })` is the developer-controlled
 *     review surface. Caller enumerates which handles surface in which Diff.
 *   - On commit, a 3-way merge runs via `mergePatch` from
 *     `libs/east/src/patch/`. Clean → apply. Overlapping → render as conflict
 *     rows with per-leaf chooser; commit retries with
 *     `mergePatchWithResolutions`.
 *
 * This file proves the call-site DX type-checks and sketches the closure
 * shape. Real implementations:
 *   - `Data.bindStaged`        →  `e3-ui/src/data.ts`
 *   - `Diff` factory            →  `e3-ui/src/diff/index.ts`  (new)
 *   - `Diff` renderer           →  `e3-ui-components/src/diff/index.tsx`  (new)
 *   - `mergePatch` etc.         →  `libs/east/src/patch/merge.ts`  (new)
 */
import {
    East,
    StructType,
    IntegerType,
    FloatType,
    BooleanType,
    NullType,
    type SubtypeExprOrValue,
    type ExprType,
    type EastType,
} from "@elaraai/east";

// =============================================================================
// 1. Stand-in shapes for the design — these will live in the real packages.
// =============================================================================

/**
 * The closure surface returned by `Data.bindStaged([T], path)`.
 * Mirrors `Data.bind`'s shape but with staging semantics. Lives in
 * `e3-ui/src/data.ts`.
 */
type StagedHandle<T extends EastType> = {
    /** Reactive overlay: staged value if pending, else server value. */
    read:     () => ExprType<T>;
    /** Local-only write — updates the staging buffer, NOT the server. */
    write:    (value: SubtypeExprOrValue<T>) => ExprType<NullType>;
    /** Server snapshot, no overlay — for diffing / conflict detection. */
    original: () => ExprType<T>;
    /** Has staged change pending? */
    pending:  () => ExprType<BooleanType>;
    /** Flush staged → server, running 3-way merge against current server.
     *  On conflict, the Diff component switches to conflict-resolution mode. */
    commit:   () => ExprType<NullType>;
    /** Drop the staged value, keep the server value. */
    discard:  () => ExprType<NullType>;
};

/** Stand-in for the real generic platform fn. */
declare function bindStaged<T extends EastType>(
    types: [T],
    path: string,
): StagedHandle<T>;

/** Stand-in for the Diff factory in `e3-ui/src/diff/index.ts`. */
declare const Diff: {
    Root: (options: DiffOptions) => ExprType<EastType>;   // really ExprType<UIComponentType>
};

interface DiffOptions {
    /** Caller-enumerated staged handles. The Diff shows pending changes for
     *  these handles only — it does NOT auto-discover other staged paths. */
    staged: ReadonlyArray<StagedHandle<any>>;
    mode?: "inline" | "side-by-side" | "unified";
    hideUnchanged?: SubtypeExprOrValue<BooleanType>;
    /** Fires when commit completes successfully (after any merge resolution). */
    onCommitted?: ($: any) => void;
    /** Fires when discard completes. */
    onDiscarded?: ($: any) => void;
    style?: object;
}

// =============================================================================
// 2. Canonical use case 1 — single-form transactional edit.
// =============================================================================

const PolicyType = StructType({
    maxWeeklyHours: IntegerType,
    overtimeThresholdHours: IntegerType,
    publicHolidayPenalty: FloatType,
});
type PolicyType = typeof PolicyType;

declare const policyPath: string;

function singleFormExample() {
    const policy = bindStaged([PolicyType], policyPath);

    // Reading the OVERLAY value (server, or staged if pending).
    const _live: ExprType<PolicyType> = policy.read();

    // Writing — goes to local staging, NOT the server.
    const _stagedWrite: ExprType<NullType> = policy.write({
        maxWeeklyHours: 40n,
        overtimeThresholdHours: 40n,
        publicHolidayPenalty: 2.0,
    });

    // Reading the original (server snapshot, ignoring staging).
    const _server: ExprType<PolicyType> = policy.original();

    // Diff surface — single line; developer controls scope.
    Diff.Root({
        staged: [policy],
        onCommitted: ($) => { void $; },
        onDiscarded: ($) => { void $; },
    });
}
void singleFormExample;

// =============================================================================
// 3. Canonical use case 2 — multi-binding scoped Diffs.
// =============================================================================

const ScheduleType = StructType({ /* … */ });
type ScheduleType = typeof ScheduleType;

const PriceListType = StructType({ /* … */ });
type PriceListType = typeof PriceListType;

declare const schedulePath: string;
declare const priceListPath: string;

function multiBindingScopedDiffsExample() {
    const policy    = bindStaged([PolicyType],    policyPath);
    const schedule  = bindStaged([ScheduleType],  schedulePath);
    const priceList = bindStaged([PriceListType], priceListPath);

    // Diff A — table-attached, only policy + schedule.
    Diff.Root({ staged: [policy, schedule] });

    // Diff B — different drawer, only priceList.
    Diff.Root({ staged: [priceList] });

    // No auto-discovery → no leaks between unrelated parts of the UI.
}
void multiBindingScopedDiffsExample;

// =============================================================================
// 4. Closure semantics — quasi-pseudocode of how `Data.bindStaged` works.
// =============================================================================

/*
 * Per path, the staging store keeps an entry of shape:
 *
 *     StagedEntry<T> = { snapshot: T, buffered: T }
 *
 * keyed by `path`. localStorage-backed for browser-session persistence.
 *
 *   read():
 *     if path is staged:
 *         return buffered (overlaid)
 *     else:
 *         return server.read(path)        // delegates to Data.bind read
 *
 *   write(value):
 *     if path NOT staged:
 *         currentServer = server.read(path)
 *         store.put(path, { snapshot: currentServer, buffered: value })
 *     else:
 *         store.update(path, { ...prev, buffered: value })
 *     // localStorage flush; Reactive deps invalidated for read() / pending()
 *
 *   original():
 *     if path is staged: return store.get(path).snapshot
 *     else:              return server.read(path)
 *
 *   pending():
 *     return store.has(path) AND
 *            !equalFor(T)(store.get(path).snapshot, store.get(path).buffered)
 *
 *   commit():
 *     entry = store.get(path)
 *     currentServer = server.read(path)
 *     patchUser   = East.diff(entry.snapshot, entry.buffered)
 *     patchServer = East.diff(entry.snapshot, currentServer)
 *
 *     // 3-way merge via the patch-system primitive.
 *     try:
 *         merged = mergePatch(patchUser, patchServer, T)   // from libs/east/src/patch/merge.ts
 *         server.write(applyPatch(currentServer, merged))
 *         store.delete(path)
 *     catch ConflictError:
 *         // The Diff renderer with this handle in scope catches & surfaces.
 *         // After user resolves, retry with mergePatchWithResolutions().
 *         throw
 *
 *   discard():
 *     store.delete(path)
 *     // Reactive deps invalidated.
 */

// =============================================================================
// 5. New patch-system primitives that the commit flow depends on.
//    All live in `libs/east/src/patch/merge.ts` — UI consumes them.
//    Exhaustively tested in `libs/east/src/patch/merge.spec.ts`.
// =============================================================================

/*
 * detectConflicts(patchA, patchB, T): Array<ConflictType>
 *   Pure check. Walks both patches, identifies leaves they both touch
 *   with different replacements. Empty array means clean merge possible.
 *
 * mergePatch(patchA, patchB, T): PatchTypeOf<T>
 *   Attempts 3-way merge. Throws ConflictError if any leaf-level overlap
 *   has different replacements.
 *
 * mergePatchWithResolutions(patchA, patchB, resolutions, T): PatchTypeOf<T>
 *   3-way merge with per-conflict-path explicit resolution.
 *   `resolutions: Dict<String, MergeResolutionType>` keyed on conflict path.
 *
 * MergeResolutionType = Variant<{
 *     keepA: Null,
 *     keepB: Null,
 *     manual: <leaf-typed value>,
 * }>
 */

// =============================================================================
// 6. Diff renderer commit flow (lives in `e3-ui-components/src/diff/index.tsx`).
// =============================================================================

/*
 * EastChakraDiff = memo(({ value }) => {
 *     const stagedHandles = value.staged;     // typed handles
 *
 *     // Per handle: read snapshot + buffered, compute patch on the fly.
 *     const rows = stagedHandles.flatMap(h => walkPatch(
 *         typeOf(h),
 *         east.diff(h.original(), h.read()),
 *     ));
 *
 *     // Local React state for per-row accept/reject + conflict resolutions.
 *     const [accepted, setAccepted] = useState<Map<string, boolean>>(...);
 *     const [conflicts, setConflicts] = useState<ConflictRow[] | null>(null);
 *     const [resolutions, setResolutions] = useState<Map<string, MergeResolution>>(...);
 *
 *     const handleApply = useCallback(() => {
 *         try {
 *             stagedHandles.forEach(h => h.commit());
 *             onCommittedFn?.();
 *         } catch (err) {
 *             if (err instanceof ConflictError) {
 *                 setConflicts(extractConflictRows(err));
 *                 // User resolves, then retry with mergePatchWithResolutions
 *             } else throw err;
 *         }
 *     }, [stagedHandles, onCommittedFn]);
 *
 *     return <DiffCard>...</DiffCard>;
 * }, ...);
 *
 * Conflict-row primitive: orange exclamation + 3-option chooser
 *   (keep yours / keep theirs / manual edit).
 */

// =============================================================================
// 7. Compile-check probe — TS-only, not real runtime.
// =============================================================================

void Diff;
void East;
void bindStaged;
