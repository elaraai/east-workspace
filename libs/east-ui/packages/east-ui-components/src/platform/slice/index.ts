/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for `Slice.bind` (the stateful slice platform).
 *
 * The entire `SliceState` is stored under the user-provided key as a single
 * Beast2-encoded blob in the shared `UIStore`. Reads track the key via the
 * reactive tracker so any `Reactive.Root` that calls `slice.read()` (or any
 * derived getter) re-renders when a mutator runs.
 *
 * Each structured mutator (`setRange`, `addFilter`, …) is a read-modify-write
 * against the same blob — simpler than splitting state across many keys, and
 * `Reactive.Root` already coalesces re-renders within a tick.
 *
 * # Serializable handles (issue #106)
 *
 * The handle's ~27 methods are thin IR-bearing `East.function`s over the
 * `slice_*` primitives (declared in `@elaraai/east-ui`), each capturing only the
 * plain-data store key. That makes a `Slice.bind` handle ordinary serializable
 * East data: a captured handle (e.g. `onClick={() => slice.setSearch(some(q))}`)
 * encodes through beast2, and `decodeBeast2For({ platform })` recompiles the
 * methods against the decoder's platform map — re-binding every op to the
 * decoder's {@link getStore} store. The host side-effects (store I/O, the bound
 * rows / config / `toMatch`) live in the primitive impls, resolved by key from a
 * registry that `Slice.bind` refreshes on every bind.
 *
 * The pure-JS apply engine (`Slice.apply.matches` / `.where` / `.breakdownKey`)
 * is implemented in `@elaraai/east-ui` as `SliceApplyImpl` and registered here
 * so the bundle pulls it in via a single import.
 *
 * @packageDocumentation
 */

import {
    East,
    StringType,
    IntegerType,
    BooleanType,
    NullType,
    OptionType,
    SetType,
    ArrayType,
    DictType,
    none,
    encodeBeast2For,
    decodeBeast2For,
    type variant,
} from "@elaraai/east";
import { type PlatformFunction, type EastTypeValue } from "@elaraai/east/internal";
import { Slice, SliceApplyImpl, SliceBindPrimitives, sliceDimensions, sliceFields, sliceMatches, sliceBreakdown, sliceSeries } from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "../state-runtime.js";
import { registerPlatformImplementation, getRegisteredPlatformImplementations } from "../registry.js";

type Row = Record<string, unknown>;
/** A `{ id, label, meta }` search match. */
type Match = { id: string; label: string; meta: variant };

/** JS-side shape of `Slice.Types.State` after Beast2 decode. */
interface SliceStateLike {
    range:         variant;              // option<SliceRange>
    compare:       variant;              // option<SliceCompare>
    filters:       variant[];            // SlicePredicate[]
    cohorts:       SliceCohortLike[];
    activeCohorts: Set<string>;
    breakdown:     variant;              // option<SliceBreakdown>
    search:        variant;              // option<string>
    visible:       variant;              // option<Set<string>>
    selectedIndex: variant;              // option<bigint>
}

interface SliceCohortLike {
    id:      string;
    name:    string;
    filters: variant[];
}

const encodeState = encodeBeast2For(Slice.Types.State);
const decodeState = decodeBeast2For(Slice.Types.State);

export const DEFAULT_SLICE_STATE: SliceStateLike = {
    range:         none,
    compare:       none,
    filters:       [],
    cohorts:       [],
    activeCohorts: new Set<string>(),
    breakdown:     none,
    search:        none,
    visible:       none,
    selectedIndex: none,
};

function readState(key: string): SliceStateLike {
    const encoded = getStore().read(key);
    if (encoded === undefined) return DEFAULT_SLICE_STATE;
    return decodeState(encoded) as SliceStateLike;
}

function writeState(key: string, state: SliceStateLike): void {
    /* `SliceStateLike` uses the loose `variant` interface for option/variant
     * fields; the encode function's parameter is the strict East-generated
     * TS shape (with `[variant_symbol]` and tagged unions). The JS runtime
     * representation is identical — Beast2 encode only inspects the runtime
     * `type` / `value` fields. Cast at the boundary to bridge the static
     * gap. */
    getStore().write(key, encodeState(state as Parameters<typeof encodeState>[0]));
}

function updateState(key: string, fn: (s: SliceStateLike) => SliceStateLike): null {
    writeState(key, fn(readState(key)));
    return null;
}

/** Synthetic single-narrowing state, for per-aspect counts. */
const only = (patch: Partial<SliceStateLike>): SliceStateLike => ({ ...DEFAULT_SLICE_STATE, ...patch });

/** Bound data + config + `toMatch` per slice key — what the data-derived methods
 *  narrow from. The rows entry may be a getter so long-lived handles (a
 *  DecisionQueue's handle-owned slice) always see the live collection. Refreshed
 *  on every `Slice.bind`, so the IR-bearing handle methods (which carry only the
 *  key) resolve the current rows / config / `toMatch` live by key. */
const boundByKey = new Map<string, {
    rows: Row[] | (() => Row[]);
    config: Parameters<typeof sliceMatches>[1];
    toMatch: ((r: Row) => Match) | undefined;
}>();

function boundRows(entry: { rows: Row[] | (() => Row[]) }): Row[] {
    return typeof entry.rows === "function" ? entry.rows() : entry.rows;
}

/**
 * The bound rows' domain over the slice's range field — feeds the standalone
 * `Slice.Rail` brush strip (track = full domain, window = applied range).
 * Values are epoch ms for datetime fields, plain numbers for float/integer.
 */
export function boundRangeDomain(key: string): { kind: "datetime" | "float"; min: number; max: number } | undefined {
    const bound = boundByKey.get(key);
    if (bound === undefined) return undefined;
    const boundRowsList = boundRows(bound);
    if (boundRowsList.length === 0) return undefined;
    const cfg = bound.config as unknown as {
        rangeFieldId: { type: string; value: string };
        fields: Map<string, { type: string; value: { accessor: (r: unknown) => unknown } }>;
    };
    if (cfg.rangeFieldId.type !== "some") return undefined;
    const field = cfg.fields.get(cfg.rangeFieldId.value);
    if (field === undefined) return undefined;
    const kind = field.type === "datetime" ? "datetime" as const : "float" as const;
    let min = Infinity;
    let max = -Infinity;
    for (const r of boundRowsList) {
        const v = field.value.accessor(r);
        const n = v instanceof Date ? v.getTime() : Number(v);
        if (n < min) min = n;
        if (n > max) max = n;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    return { kind, min, max };
}

/**
 * Build a live slice handle outside the platform-function path — for
 * components that own their slice internally (a `DecisionQueue`'s rows
 * arrive via binding descriptors, so the host can't bind one). Same
 * closure construction as the `Slice.bind` impl; the key registers in the
 * shared store, so the rail / editor / `Slice.rows` all interoperate.
 */
export function buildSliceHandle(key: unknown, config: unknown, initial: unknown, data: unknown | (() => unknown), toMatch: unknown): Record<string, unknown> {
    return bindImpl(key, config, initial, data, toMatch);
}

// Compiled-handle cache (issue #106 perf): like State.bind, a slice re-binds on
// every reactive frame; the ~27 method IRs are a pure function of the store key,
// and the methods resolve getStore() + the bound rows registry LIVE, so a cached
// handle still re-binds. Module-level (the store is a singleton).
const sliceHandleCache = new Map<string, Record<string, unknown>>();

/**
 * Compile the `Slice.bind` handle: every method is a thin IR-bearing
 * `East.function` over a `slice_*` primitive, capturing only `key`. The host I/O
 * (store, bound rows / config / `toMatch`) lives in the primitive impls and is
 * resolved by key — so the handle is plain serializable East data and re-binds to
 * the decoder's store after `decodeBeast2For({ platform })`.
 */
function buildSliceHandleIR(key: string): Record<string, unknown> {
    const platform = getRegisteredPlatformImplementations();
    const keyExpr = East.value(key, StringType);
    const T = Slice.Types;
    // Bare identifiers (not `SliceBindPrimitives.read(...)`): platform calls inside
    // an `East.function` body read cleaner and match the State/Nav handle builders.
    const {
        read, write, setRange, setCompare, addFilter, removeFilter, clearFilters,
        defineCohort, updateCohort, removeCohort, toggleCohort,
        setBreakdown, setSearch, setVisible, select, isActive, activeCount,
        dimensions, fields, searchFieldIds, rangeFieldId,
        totalCount, resultCount, groups, series, matches, cohortCounts,
    } = SliceBindPrimitives;

    return {
        key,
        // --- raw read / write ---
        read:  East.compile(East.function([], T.State, ($) => { $.return(read(keyExpr)); }), platform),
        write: East.compile(East.function([T.State], NullType, ($, s) => { $.return(write(keyExpr, s)); }), platform),

        // --- range ---
        setRange:   East.compile(East.function([OptionType(T.Range)], NullType, ($, o) => { $.return(setRange(keyExpr, o)); }), platform),
        setCompare: East.compile(East.function([OptionType(T.Compare)], NullType, ($, o) => { $.return(setCompare(keyExpr, o)); }), platform),

        // --- filters ---
        addFilter:    East.compile(East.function([T.Predicate], NullType, ($, p) => { $.return(addFilter(keyExpr, p)); }), platform),
        removeFilter: East.compile(East.function([IntegerType], NullType, ($, i) => { $.return(removeFilter(keyExpr, i)); }), platform),
        clearFilters: East.compile(East.function([], NullType, ($) => { $.return(clearFilters(keyExpr)); }), platform),

        // --- cohorts ---
        defineCohort: East.compile(East.function([T.Cohort], NullType, ($, c) => { $.return(defineCohort(keyExpr, c)); }), platform),
        updateCohort: East.compile(East.function([StringType, T.Cohort], NullType, ($, id, c) => { $.return(updateCohort(keyExpr, id, c)); }), platform),
        removeCohort: East.compile(East.function([StringType], NullType, ($, id) => { $.return(removeCohort(keyExpr, id)); }), platform),
        toggleCohort: East.compile(East.function([StringType], NullType, ($, id) => { $.return(toggleCohort(keyExpr, id)); }), platform),

        // --- breakdown / search / visible / selection ---
        setBreakdown: East.compile(East.function([OptionType(T.Breakdown)], NullType, ($, o) => { $.return(setBreakdown(keyExpr, o)); }), platform),
        setSearch:    East.compile(East.function([OptionType(StringType)], NullType, ($, o) => { $.return(setSearch(keyExpr, o)); }), platform),
        setVisible:   East.compile(East.function([OptionType(SetType(StringType))], NullType, ($, o) => { $.return(setVisible(keyExpr, o)); }), platform),
        select:       East.compile(East.function([OptionType(IntegerType)], NullType, ($, o) => { $.return(select(keyExpr, o)); }), platform),

        // --- derived ---
        isActive:    East.compile(East.function([], BooleanType, ($) => { $.return(isActive(keyExpr)); }), platform),
        activeCount: East.compile(East.function([], IntegerType, ($) => { $.return(activeCount(keyExpr)); }), platform),

        // --- config-derived metadata ---
        dimensions:     East.compile(East.function([], ArrayType(T.Dimension), ($) => { $.return(dimensions(keyExpr)); }), platform),
        fields:         East.compile(East.function([], ArrayType(T.Field), ($) => { $.return(fields(keyExpr)); }), platform),
        searchFieldIds: East.compile(East.function([], ArrayType(StringType), ($) => { $.return(searchFieldIds(keyExpr)); }), platform),
        rangeFieldId:   East.compile(East.function([], OptionType(StringType), ($) => { $.return(rangeFieldId(keyExpr)); }), platform),

        // --- data-derived results ---
        totalCount:   East.compile(East.function([], IntegerType, ($) => { $.return(totalCount(keyExpr)); }), platform),
        resultCount:  East.compile(East.function([], IntegerType, ($) => { $.return(resultCount(keyExpr)); }), platform),
        groups:       East.compile(East.function([], ArrayType(T.BreakdownGroup), ($) => { $.return(groups(keyExpr)); }), platform),
        series:       East.compile(East.function([StringType, StringType], ArrayType(T.Series), ($, x, v) => { $.return(series(keyExpr, x, v)); }), platform),
        matches:      East.compile(East.function([], ArrayType(T.SearchMatch), ($) => { $.return(matches(keyExpr)); }), platform),
        cohortCounts: East.compile(East.function([], DictType(StringType, IntegerType), ($) => { $.return(cohortCounts(keyExpr)); }), platform),
    };
}

function bindImpl(key: unknown, config: unknown, initial: unknown, data: unknown, toMatch: unknown): Record<string, unknown> {
    const k = key as string;
    const cfg = config as Parameters<typeof sliceMatches>[1];
    const rowsSource = data as Row[] | (() => Row[]) | undefined;
    const liveRows = (): Row[] => (typeof rowsSource === "function" ? rowsSource() : rowsSource) ?? [];
    // `toMatch` arrives as `option<(row) => Match>`; unwrap the callable.
    const toMatchFn = (toMatch as variant | undefined)?.type === "some"
        ? (toMatch as { value: (r: Row) => Match }).value
        : undefined;

    /* First bind seeds the key with the caller-supplied initial state. */
    if (!getStore().has(k)) writeState(k, initial as SliceStateLike);
    /* Refresh the live bound entry EVERY bind (rows getter / config / toMatch),
     * before the cache check — so a cached handle's primitives always resolve the
     * current rows + config. */
    boundByKey.set(k, { rows: (typeof rowsSource === "function" ? rowsSource : liveRows()), config: cfg, toMatch: toMatchFn });

    const cached = sliceHandleCache.get(k);
    if (cached) return cached;
    const handle = buildSliceHandleIR(k);
    sliceHandleCache.set(k, handle);
    return handle;
}

export const SliceImpl: PlatformFunction[] = [
    Slice.rows.implement((_T: EastTypeValue) => (handle: unknown) => {
        const k = (handle as { key: string }).key;
        const bound = boundByKey.get(k);
        if (bound === undefined) return [];
        trackKey(k);
        const state = readState(k);
        const now = new Date();
        return boundRows(bound).filter(r => sliceMatches(state as never, bound.config, r, now));
    }),
    Slice.bind.implement((_T: EastTypeValue) => bindImpl),

    // ── issue #106 primitives — host I/O backing the IR-bearing handle methods.
    // Each is a faithful lift of the original closure body, keyed by the store key
    // (and resolving the bound rows / config / `toMatch` from `boundByKey`). ──

    // --- raw read / write ---
    // (`readState` yields the loose `SliceStateLike`; the platform output is the
    // strict East `SliceState`. Identical runtime shape — cast at the boundary,
    // as `writeState` does for the inverse direction.)
    SliceBindPrimitives.read.implement((key: unknown) => { trackKey(key as string); return readState(key as string) as never; }),
    SliceBindPrimitives.write.implement((key: unknown, state: unknown) => { writeState(key as string, state as SliceStateLike); return null; }),

    // --- range ---
    SliceBindPrimitives.setRange.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, range: opt as variant }))),
    SliceBindPrimitives.setCompare.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, compare: opt as variant }))),

    // --- filters ---
    SliceBindPrimitives.addFilter.implement((key: unknown, pred: unknown) =>
        updateState(key as string, s => ({ ...s, filters: [...s.filters, pred as variant] }))),
    SliceBindPrimitives.removeFilter.implement((key: unknown, idx: unknown) => {
        const i = Number(idx as bigint);
        return updateState(key as string, s => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }));
    }),
    /* Per the declaration: clears filters AND active cohorts. */
    SliceBindPrimitives.clearFilters.implement((key: unknown) =>
        updateState(key as string, s => ({ ...s, filters: [], activeCohorts: new Set<string>() }))),

    // --- cohorts ---
    SliceBindPrimitives.defineCohort.implement((key: unknown, cohort: unknown) => {
        const c = cohort as SliceCohortLike;
        return updateState(key as string, s => {
            if (s.cohorts.some(x => x.id === c.id)) {
                throw new Error(`[Slice.bind] cohort id "${c.id}" already exists`);
            }
            return { ...s, cohorts: [...s.cohorts, c] };
        });
    }),
    SliceBindPrimitives.updateCohort.implement((key: unknown, id: unknown, cohort: unknown) => {
        const target = id as string;
        const c = cohort as SliceCohortLike;
        return updateState(key as string, s => ({ ...s, cohorts: s.cohorts.map(x => x.id === target ? c : x) }));
    }),
    SliceBindPrimitives.removeCohort.implement((key: unknown, id: unknown) => {
        const target = id as string;
        return updateState(key as string, s => {
            const activeCohorts = new Set(s.activeCohorts);
            activeCohorts.delete(target);
            return { ...s, cohorts: s.cohorts.filter(c => c.id !== target), activeCohorts };
        });
    }),
    SliceBindPrimitives.toggleCohort.implement((key: unknown, id: unknown) => {
        const target = id as string;
        return updateState(key as string, s => {
            const activeCohorts = new Set(s.activeCohorts);
            if (activeCohorts.has(target)) activeCohorts.delete(target);
            else activeCohorts.add(target);
            return { ...s, activeCohorts };
        });
    }),

    // --- breakdown / search / visible / selection ---
    SliceBindPrimitives.setBreakdown.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, breakdown: opt as variant }))),
    SliceBindPrimitives.setSearch.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, search: opt as variant }))),
    SliceBindPrimitives.setVisible.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, visible: opt as variant }))),
    SliceBindPrimitives.select.implement((key: unknown, opt: unknown) =>
        updateState(key as string, s => ({ ...s, selectedIndex: opt as variant }))),

    // --- derived ---
    SliceBindPrimitives.isActive.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const s = readState(k);
        return (
            s.range.type === "some" ||
            s.filters.length > 0 ||
            s.activeCohorts.size > 0 ||
            s.breakdown.type === "some" ||
            s.search.type === "some" ||
            s.visible.type === "some" ||
            s.selectedIndex.type === "some"
        );
    }),
    SliceBindPrimitives.activeCount.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const s = readState(k);
        let n = 0;
        if (s.range.type === "some") n++;
        n += s.filters.length;
        n += s.activeCohorts.size;
        if (s.breakdown.type === "some") n++;
        if (s.search.type === "some") n++;
        if (s.visible.type === "some") n++;
        if (s.selectedIndex.type === "some") n++;
        return BigInt(n);
    }),

    // --- config-derived metadata (config is static; no reactive tracking) ---
    SliceBindPrimitives.dimensions.implement((key: unknown) => {
        const e = boundByKey.get(key as string);
        return e ? sliceDimensions(e.config as Parameters<typeof sliceDimensions>[0]) : [];
    }),
    SliceBindPrimitives.fields.implement((key: unknown) => {
        const e = boundByKey.get(key as string);
        return e ? sliceFields(e.config as Parameters<typeof sliceFields>[0]) : [];
    }),
    SliceBindPrimitives.searchFieldIds.implement((key: unknown) => {
        const e = boundByKey.get(key as string);
        return e ? (e.config as unknown as { searchFieldIds: string[] }).searchFieldIds : [];
    }),
    SliceBindPrimitives.rangeFieldId.implement((key: unknown) => {
        const e = boundByKey.get(key as string);
        // loose `variant` vs strict `option<string>` — identical runtime shape.
        return (e ? (e.config as unknown as { rangeFieldId: variant }).rangeFieldId : none) as never;
    }),

    // --- data-derived results (computed over the bound `rows`) ---
    SliceBindPrimitives.totalCount.implement((key: unknown) => {
        const e = boundByKey.get(key as string);
        return BigInt(e ? boundRows(e).length : 0);
    }),
    SliceBindPrimitives.resultCount.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const e = boundByKey.get(k);
        if (e === undefined) return 0n;
        const s = readState(k);
        const now = new Date();
        return BigInt(boundRows(e).filter(r => sliceMatches(s as never, e.config, r, now)).length);
    }),
    SliceBindPrimitives.groups.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const e = boundByKey.get(k);
        if (e === undefined) return [];
        return sliceBreakdown(readState(k) as never, e.config, boundRows(e), new Date());
    }),
    SliceBindPrimitives.series.implement((key: unknown, xFieldId: unknown, valueFieldId: unknown) => {
        const k = key as string;
        trackKey(k);
        const e = boundByKey.get(k);
        if (e === undefined) return [];
        // loose point shape (`size`/`color` as bare `none`) vs strict `option<...>`.
        return sliceSeries(readState(k) as never, e.config, boundRows(e), xFieldId as string, valueFieldId as string, new Date()) as never;
    }),
    SliceBindPrimitives.matches.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const e = boundByKey.get(k);
        if (e === undefined) return [];
        const s = readState(k);
        const now = new Date();
        const hits = s.search.type === "some"
            ? boundRows(e).filter(r => sliceMatches(only({ search: s.search }) as never, e.config, r, now))
            : boundRows(e);
        // `Match.meta` is the loose `variant`; the output is `option<string>`.
        if (e.toMatch !== undefined) return hits.map(e.toMatch) as never;
        // No `toMatch` supplied: auto-derive matches from the config's first
        // searchable string field so search works out of the box (#129). Project
        // each hit to `{ id, label, meta: none }`; a per-row ordinal keeps `id`
        // unique when the field has duplicate values.
        const cfg = e.config as unknown as {
            searchFieldIds: string[];
            fields: Map<string, { type: string; value: { accessor: (r: unknown) => unknown } }>;
        };
        const stringId = cfg.searchFieldIds.find(id => cfg.fields.get(id)?.type === "string")
            ?? [...cfg.fields].find(([, f]) => f.type === "string")?.[0];
        if (stringId === undefined) return [];   // genuinely un-derivable (no string fields)
        const accessor = cfg.fields.get(stringId)!.value.accessor;
        return hits.map((r, i) => {
            const label = String(accessor(r));
            return { id: `${label} ${i}`, label, meta: none };
        }) as never;
    }),
    SliceBindPrimitives.cohortCounts.implement((key: unknown) => {
        const k = key as string;
        trackKey(k);
        const e = boundByKey.get(k);
        if (e === undefined) return new Map<string, bigint>();
        const s = readState(k);
        const now = new Date();
        const out = new Map<string, bigint>();
        for (const c of s.cohorts) {
            out.set(c.id, BigInt(boundRows(e).filter(r => sliceMatches(only({ filters: c.filters }) as never, e.config, r, now)).length));
        }
        return out;
    }),
];

registerPlatformImplementation(SliceImpl);
registerPlatformImplementation(SliceApplyImpl);

export { SliceApplyImpl };
