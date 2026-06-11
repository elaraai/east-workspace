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
 * The pure-JS apply engine (`Slice.apply.matches` / `.where` / `.breakdownKey`)
 * is implemented in `@elaraai/east-ui` as `SliceApplyImpl` and registered here
 * so the bundle pulls it in via a single import.
 *
 * @packageDocumentation
 */

import { none, type variant } from "@elaraai/east";
import { encodeBeast2For, decodeBeast2For } from "@elaraai/east";
import { type PlatformFunction, type EastTypeValue } from "@elaraai/east/internal";
import { Slice, SliceApplyImpl, sliceDimensions, sliceFields, sliceMatches, sliceBreakdown, sliceSeries } from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "../state-runtime.js";
import { registerPlatformImplementation } from "../registry.js";

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

/** Bound data + config per slice key — what `Slice.rows` narrows from. The
 *  rows entry may be a getter so long-lived handles (a DecisionQueue's
 *  handle-owned slice) always see the live collection. */
const boundByKey = new Map<string, { rows: Row[] | (() => Row[]); cfg: Parameters<typeof sliceMatches>[1] }>();

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
    const cfg = bound.cfg as unknown as {
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
export function buildSliceHandle(key: unknown, config: unknown, initial: unknown, data: unknown | (() => unknown), toMatch: unknown) {
    return bindImpl(key, config, initial, data, toMatch);
}

export const SliceImpl: PlatformFunction[] = [
    Slice.rows.implement((_T: EastTypeValue) => (handle: unknown) => {
        const k = (handle as { key: string }).key;
        const bound = boundByKey.get(k);
        if (bound === undefined) return [];
        trackKey(k);
        const state = readState(k);
        const now = new Date();
        return boundRows(bound).filter(r => sliceMatches(state as never, bound.cfg, r, now));
    }),
    Slice.bind.implement((_T: EastTypeValue) => bindImpl),
];

function bindImpl(key: unknown, config: unknown, initial: unknown, data: unknown, toMatch: unknown) {
    {
        const k = key as string;
        const cfg = config as Parameters<typeof sliceMatches>[1];
        const rowsSource = data as Row[] | (() => Row[]) | undefined;
        const liveRows = (): Row[] => (typeof rowsSource === "function" ? rowsSource() : rowsSource) ?? [];
        // `toMatch` arrives as `option<(row) => Match>`; unwrap the callable.
        const toMatchFn = (toMatch as variant | undefined)?.type === "some"
            ? (toMatch as { value: (r: Row) => Match }).value
            : undefined;
        /* Synthetic single-narrowing state, for per-aspect counts. */
        const only = (patch: Partial<SliceStateLike>): SliceStateLike => ({ ...DEFAULT_SLICE_STATE, ...patch });

        /* First bind seeds the key with the caller-supplied initial state. */
        if (!getStore().has(k)) writeState(k, initial as SliceStateLike);
        boundByKey.set(k, { rows: (typeof rowsSource === "function" ? rowsSource : liveRows()), cfg } as never);

        return {
            key: k,
            // --- raw read / write ---
            read: () => {
                trackKey(k);
                return readState(k);
            },
            write: (state: unknown) => {
                writeState(k, state as SliceStateLike);
                return null;
            },

            // --- range ---
            setRange: (opt: unknown) =>
                updateState(k, s => ({ ...s, range: opt as variant })),
            setCompare: (opt: unknown) =>
                updateState(k, s => ({ ...s, compare: opt as variant })),

            // --- filters ---
            addFilter: (pred: unknown) =>
                updateState(k, s => ({ ...s, filters: [...s.filters, pred as variant] })),
            removeFilter: (idx: unknown) => {
                const i = Number(idx as bigint);
                return updateState(k, s => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }));
            },
            /* Per the declaration: clears filters AND active cohorts. */
            clearFilters: () =>
                updateState(k, s => ({ ...s, filters: [], activeCohorts: new Set<string>() })),

            // --- cohorts ---
            defineCohort: (cohort: unknown) => {
                const c = cohort as SliceCohortLike;
                return updateState(k, s => {
                    if (s.cohorts.some(x => x.id === c.id)) {
                        throw new Error(`[Slice.bind] cohort id "${c.id}" already exists`);
                    }
                    return { ...s, cohorts: [...s.cohorts, c] };
                });
            },
            updateCohort: (id: unknown, cohort: unknown) => {
                const target = id as string;
                const c = cohort as SliceCohortLike;
                return updateState(k, s => ({ ...s, cohorts: s.cohorts.map(x => x.id === target ? c : x) }));
            },
            removeCohort: (id: unknown) => {
                const target = id as string;
                return updateState(k, s => {
                    const activeCohorts = new Set(s.activeCohorts);
                    activeCohorts.delete(target);
                    return {
                        ...s,
                        cohorts: s.cohorts.filter(c => c.id !== target),
                        activeCohorts,
                    };
                });
            },
            toggleCohort: (id: unknown) => {
                const target = id as string;
                return updateState(k, s => {
                    const activeCohorts = new Set(s.activeCohorts);
                    if (activeCohorts.has(target)) activeCohorts.delete(target);
                    else activeCohorts.add(target);
                    return { ...s, activeCohorts };
                });
            },

            // --- breakdown / search / visible / selection ---
            setBreakdown: (opt: unknown) =>
                updateState(k, s => ({ ...s, breakdown: opt as variant })),
            setSearch: (opt: unknown) =>
                updateState(k, s => ({ ...s, search: opt as variant })),
            setVisible: (opt: unknown) =>
                updateState(k, s => ({ ...s, visible: opt as variant })),
            select: (opt: unknown) =>
                updateState(k, s => ({ ...s, selectedIndex: opt as variant })),

            // --- derived ---
            isActive: () => {
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
            },
            activeCount: () => {
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
            },

            // --- config-derived metadata (config is static; no reactive tracking) ---
            dimensions: () => sliceDimensions(config as Parameters<typeof sliceDimensions>[0]),
            fields: () => sliceFields(config as Parameters<typeof sliceFields>[0]),
            searchFieldIds: () => (config as { searchFieldIds: string[] }).searchFieldIds,
            rangeFieldId: () => (config as { rangeFieldId: variant }).rangeFieldId,

            // --- data-derived results (computed over the bound `rows`) ---
            totalCount: () => BigInt(liveRows().length),
            resultCount: () => {
                trackKey(k);
                const s = readState(k);
                const now = new Date();
                return BigInt(liveRows().filter(r => sliceMatches(s as never, cfg, r, now)).length);
            },
            groups: () => {
                trackKey(k);
                return sliceBreakdown(readState(k) as never, cfg, liveRows(), new Date());
            },
            series: (xFieldId: unknown, valueFieldId: unknown) => {
                trackKey(k);
                return sliceSeries(readState(k) as never, cfg, liveRows(), xFieldId as string, valueFieldId as string, new Date());
            },
            matches: () => {
                trackKey(k);
                const s = readState(k);
                if (toMatchFn === undefined) return [];
                const now = new Date();
                const hits = s.search.type === "some"
                    ? liveRows().filter(r => sliceMatches(only({ search: s.search }), cfg, r, now))
                    : liveRows();
                return hits.map(toMatchFn);
            },
            cohortCounts: () => {
                trackKey(k);
                const s = readState(k);
                const now = new Date();
                const out = new Map<string, bigint>();
                for (const c of s.cohorts) {
                    out.set(c.id, BigInt(liveRows().filter(r => sliceMatches(only({ filters: c.filters }), cfg, r, now)).length));
                }
                return out;
            },
        };
    }
}

registerPlatformImplementation(SliceImpl);
registerPlatformImplementation(SliceApplyImpl);

export { SliceApplyImpl };
