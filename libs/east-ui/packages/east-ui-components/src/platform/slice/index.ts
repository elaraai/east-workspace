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
    FloatType,
    DateTimeType,
    BooleanType,
    NullType,
    OptionType,
    SetType,
    ArrayType,
    DictType,
    SortedMap,
    SortedSet,
    none,
    compareFor,
    encodeBeast2For,
    decodeBeast2For,
    equalFor,
    isValueOf,
    type option,
    type ValueTypeOf,
} from "@elaraai/east";
import { type PlatformFunction, type EastTypeValue } from "@elaraai/east/internal";
import { Slice, SliceApplyImpl, SliceBindPrimitives, sliceDimensions, sliceFields, sliceFieldText, sliceMatches, sliceBreakdown, sliceSeries } from "@elaraai/east-ui/internal";
import { getStore, trackKey } from "../state-runtime.js";
import { registerPlatformImplementation, getRegisteredPlatformImplementations } from "../registry.js";

type Row = Record<string, unknown>;
/** A slice's state, decoded. */
type SliceState = ValueTypeOf<typeof Slice.Types.State>;
/** A bound slice's handle. */
type SliceBind = ValueTypeOf<typeof Slice.Types.Bind>;
/** A `{ id, label, meta }` search match. */
type Match = ValueTypeOf<typeof Slice.Types.SearchMatch>;

const encodeState = encodeBeast2For(Slice.Types.State);
const decodeState = decodeBeast2For(Slice.Types.State);
/** Structural predicate equality — nested variant/struct/Date/Set payloads. */
const predicateEqual = equalFor(Slice.Types.Predicate);
/** East's order over cohort ids — an active-cohort set is an East Set. */
const compareStrings = compareFor(StringType);

export const DEFAULT_SLICE_STATE: SliceState = {
    range:         none,
    compare:       none,
    filters:       [],
    cohorts:       [],
    activeCohorts: new SortedSet<string>(undefined, compareStrings),
    breakdown:     none,
    search:        none,
    visible:       none,
    selectedIndex: none,
    resolution:    none,
};

function readState(key: string): SliceState {
    const encoded = getStore().read(key);
    if (encoded === undefined) return DEFAULT_SLICE_STATE;
    return decodeState(encoded);
}

function writeState(key: string, state: SliceState): void {
    getStore().write(key, encodeState(state));
    // Every slice mutation funnels through here — the one choke point the
    // opt-in persistence write-back needs (#168).
    schedulePersist(key);
}

function updateState(key: string, fn: (s: SliceState) => SliceState): null {
    writeState(key, fn(readState(key)));
    return null;
}

// ---------------------------------------------------------------------------
// Opt-in slice persistence (#168) — hydrate a slice's state from
// localStorage / sessionStorage / a URL query parameter on mount, and
// debounce-write every mutation back. The blob is the state's beast2 bytes,
// base64url-encoded (compact, URL-safe). A blob that fails to decode (a
// foreign value, or a wire shape from another build) is ignored — the seeded
// state stands.
// ---------------------------------------------------------------------------

/** Where a persisted slice's state lives. */
export type SlicePersistMode = "local" | "session" | "url";

/** Debounce for the persisted write-back — mutations are chatty (brush drags). */
const PERSIST_DEBOUNCE_MS = 150;

const persistedSlices = new Map<string, { mode: SlicePersistMode; timer: ReturnType<typeof setTimeout> | undefined }>();

/** Storage / query-parameter name for a persisted slice. */
const persistName = (key: string) => `east-ui.slice.${key}`;

function bytesToBase64url(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function readPersistedBlob(key: string, mode: SlicePersistMode): string | undefined {
    if (typeof window === "undefined") return undefined;
    if (mode === "url") {
        return new URLSearchParams(window.location.search).get(persistName(key)) ?? undefined;
    }
    return (mode === "local" ? window.localStorage : window.sessionStorage).getItem(persistName(key)) ?? undefined;
}

function writePersistedBlob(key: string, mode: SlicePersistMode, blob: string): void {
    if (typeof window === "undefined") return;
    if (mode === "url") {
        const url = new URL(window.location.href);
        url.searchParams.set(persistName(key), blob);
        window.history.replaceState(null, "", url);
        return;
    }
    (mode === "local" ? window.localStorage : window.sessionStorage).setItem(persistName(key), blob);
}

function persistNow(key: string): void {
    const entry = persistedSlices.get(key);
    if (entry === undefined) return;
    const encoded = getStore().read(key);
    if (encoded === undefined) return;
    writePersistedBlob(key, entry.mode, bytesToBase64url(encoded));
}

function schedulePersist(key: string): void {
    const entry = persistedSlices.get(key);
    if (entry === undefined) return;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.timer = undefined; persistNow(key); }, PERSIST_DEBOUNCE_MS);
}

/**
 * Opt a bound slice's state into persistence (#168). Registers the key once:
 * hydrates the store from the persisted blob when one exists (replacing the
 * seeded state — a blob that fails to decode is ignored), then debounce-writes
 * every subsequent mutation back to the chosen store. The `Slice.Rail`
 * renderer calls this on mount when its `persist` chrome option is set.
 *
 * @param key - the slice's store key
 * @param mode - where the state persists (`local` / `session` / `url`)
 */
export function enableSlicePersistence(key: string, mode: SlicePersistMode): void {
    if (persistedSlices.has(key)) return;
    persistedSlices.set(key, { mode, timer: undefined });
    const blob = readPersistedBlob(key, mode);
    if (blob === undefined) return;
    try {
        writeState(key, decodeState(base64urlToBytes(blob)));
    } catch {
        /* stale / foreign blob (e.g. an older wire shape) — keep the seed */
    }
}

/**
 * Flush any pending debounced persistence writes immediately. Deterministic
 * tests call this instead of sleeping out the debounce window.
 */
export function flushSlicePersistence(): void {
    for (const [key, entry] of persistedSlices) {
        if (entry.timer !== undefined) {
            clearTimeout(entry.timer);
            entry.timer = undefined;
            persistNow(key);
        }
    }
}

/**
 * Drop every persistence registration (pending timers cancelled, storage left
 * untouched). Test isolation only.
 * @internal
 */
export function resetSlicePersistence(): void {
    for (const [, entry] of persistedSlices) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
    }
    persistedSlices.clear();
}

/** Synthetic single-narrowing state, for per-aspect counts. */
const only = (patch: Partial<SliceState>): SliceState => ({ ...DEFAULT_SLICE_STATE, ...patch });

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
 * The bound slice's decoded config, live from the caller's most recent
 * `Slice.bind` — for components whose rows arrive outside a `Slice.rows`
 * feed (a `DecisionQueue`'s rows come from binding descriptors) and that
 * therefore narrow their own rows with `sliceMatches(state, config, row,
 * now)`. Matching with the caller's config keeps the rail's fields and the
 * component's narrowing in exact agreement.
 */
export function boundSliceConfig(key: string): Parameters<typeof sliceMatches>[1] | undefined {
    return boundByKey.get(key)?.config;
}

/** A range field's kinds, as the brush domain reads them. */
type DomainKind = "datetime" | "integer" | "float";

/**
 * A range field's value as a number on its brush domain — epoch ms for a
 * datetime, the value for an integer or a float — read by the field's kind,
 * the value's East type checked with `isValueOf` as the apply engine checks
 * a row value. `undefined` for a value of another type.
 */
function domainNumber(kind: DomainKind, value: unknown): number | undefined {
    switch (kind) {
        case "datetime": return isValueOf(value, DateTimeType) ? (value as ValueTypeOf<DateTimeType>).getTime() : undefined;
        case "integer":  return isValueOf(value, IntegerType) ? Number(value as ValueTypeOf<IntegerType>) : undefined;
        case "float":    return isValueOf(value, FloatType) ? value as ValueTypeOf<FloatType> : undefined;
    }
}

/**
 * The bound rows' domain over the slice's range field — feeds the standalone
 * `Slice.Rail` brush strip (track = full domain, window = applied range).
 * Values are epoch ms for datetime fields, plain numbers for float/integer.
 * The kind reports the field's TRUE primitive: an Integer field must yield
 * `"integer"` so the brush writes an `integer` range arm — a `float` arm is
 * inert for bigint values (`isValueOf` guard) and silently filters nothing (#167).
 */
export function boundRangeDomain(key: string): { kind: DomainKind; min: number; max: number } | undefined {
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
    const kind = field.type === "datetime" ? "datetime" as const
        : field.type === "integer" ? "integer" as const
            : "float" as const;
    let min = Infinity;
    let max = -Infinity;
    for (const r of boundRowsList) {
        const n = domainNumber(kind, field.value.accessor(r));
        if (n === undefined) continue;
        if (n < min) min = n;
        if (n > max) max = n;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    return { kind, min, max };
}

/**
 * Row-count histogram over the range field's domain (#190) — the density
 * strip behind the standalone `Slice.Rail` brush. Buckets the bound rows by
 * the range field's accessor into `buckets` equal-width bins across
 * {@link boundRangeDomain}. Counted **self-excluding**: under the current
 * narrowing minus the range itself (consistent with #188's facet semantics),
 * so the histogram reacts to filters/search/cohorts but never collapses
 * under its own window.
 *
 * @param key - the slice's store key
 * @param buckets - number of equal-width bins (callers default this)
 * @param extent - The HALF-OPEN span to bin over, `[min, max)` on the domain's
 *   own numbers — a value outside it counts in no bin. The Plan's horizon
 *   passes the whole periods around the data (#949), so a value at the
 *   domain's max counts in the period it falls in rather than piling into the
 *   last bin beside its predecessor. Omitted, the bins span the closed domain.
 * @returns per-bucket row counts (all zeros when nothing matches), or
 *          `undefined` when the slice has no usable range domain
 */
export function boundRangeHistogram(key: string, buckets: number, extent?: { min: number; max: number }): number[] | undefined {
    const bound = boundByKey.get(key);
    const domain = boundRangeDomain(key);
    if (bound === undefined || domain === undefined || buckets < 1) return undefined;
    const cfg = bound.config as unknown as {
        rangeFieldId: { type: string; value: string };
        fields: Map<string, { type: string; value: { accessor: (r: unknown) => unknown } }>;
    };
    const field = cfg.fields.get(cfg.rangeFieldId.value);
    if (field === undefined) return undefined;
    const s = readState(key);
    const facetState = { ...s, range: none };
    const now = new Date();
    const lo = extent?.min ?? domain.min;
    const hi = extent?.max ?? domain.max;
    const span = hi - lo;
    const counts = new Array<number>(buckets).fill(0);
    for (const r of boundRows(bound)) {
        if (!sliceMatches(facetState, bound.config, r, now)) continue;
        const n = domainNumber(domain.kind, field.value.accessor(r));
        if (n === undefined || !Number.isFinite(n)) continue;
        // A half-open extent holds `[lo, hi)`; the closed domain holds its max,
        // which lands in the last bin.
        if (extent !== undefined && (n < lo || n >= hi)) continue;
        const idx = span <= 0 ? 0 : Math.min(buckets - 1, Math.floor(((n - lo) / span) * buckets));
        if (idx >= 0) counts[idx]! += 1;
    }
    return counts;
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
        read, write, setRange, setCompare, setResolution, addFilter, removeFilter, clearFilters, toggleFilter, facetGroups,
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

        // --- cross-filtering (#165/#188 — appended last, matching the struct order) ---
        toggleFilter: East.compile(East.function([T.Predicate], NullType, ($, p) => { $.return(toggleFilter(keyExpr, p)); }), platform),
        facetGroups:  East.compile(East.function([], ArrayType(T.BreakdownGroup), ($) => { $.return(facetGroups(keyExpr)); }), platform),

        // --- time resolution (appended last, matching the struct order) ---
        setResolution: East.compile(East.function([OptionType(T.Resolution)], NullType, ($, o) => { $.return(setResolution(keyExpr, o)); }), platform),
    };
}

function bindImpl(key: unknown, config: unknown, initial: unknown, data: unknown, toMatch: unknown): Record<string, unknown> {
    const k = key as string;
    const cfg = config as Parameters<typeof sliceMatches>[1];
    const rowsSource = data as Row[] | (() => Row[]) | undefined;
    const liveRows = (): Row[] => (typeof rowsSource === "function" ? rowsSource() : rowsSource) ?? [];
    // `toMatch` arrives as `option<(row) => Match>`; unwrap the callable.
    const toMatchOpt = toMatch as option<(r: Row) => Match> | undefined;
    const toMatchFn = toMatchOpt?.type === "some" ? toMatchOpt.value : undefined;

    /* First bind seeds the key with the caller-supplied initial state. */
    if (!getStore().has(k)) writeState(k, initial as SliceState);
    /* Refresh the live bound entry EVERY bind (rows getter / config / toMatch),
     * before the cache check — so a cached handle's primitives always resolve the
     * current rows + config. */
    // Store the GUARDED `liveRows` getter (not the raw source) so a getter that
    // transiently returns undefined (data not yet loaded) yields `[]`, not a
    // `totalCount` crash — the `?? []` guard must cover both branches.
    boundByKey.set(k, { rows: (typeof rowsSource === "function" ? liveRows : liveRows()), config: cfg, toMatch: toMatchFn });

    const cached = sliceHandleCache.get(k);
    if (cached) return cached;
    const handle = buildSliceHandleIR(k);
    sliceHandleCache.set(k, handle);
    return handle;
}

/**
 * Auto-derive search dropdown options from the matching rows when the slice
 * declares no `toMatch`: project each row's first searchable field — a string
 * field's value, a `text` field's projection — to a **distinct**
 * `{ id, label, meta }`, using the clean text as both id and label so
 * selecting an option commits a valid query (#129). Pure + exported so the
 * projection can be tested directly without standing up the store.
 *
 * @param hits - the rows already narrowed by the active search query
 * @param config - the slice config (its `searchFieldIds` + `fields` accessors)
 * @returns one option per distinct value (empty when no searchable field exists)
 */
export function autoDeriveMatches(
    hits: ReadonlyArray<unknown>,
    config: {
        searchFieldIds: ReadonlyArray<string>;
        fields: Map<string, { type: string; value: { accessor: (r: unknown) => unknown } }>;
    },
): Match[] {
    // First searchable field (string or text), else the first such field at all —
    // the same resolution `sliceMatches` applies, so the dropdown offers what the
    // search reads.
    const searchable = (kind: string | undefined) => kind === "string" || kind === "text";
    const fieldId = config.searchFieldIds.find(id => searchable(config.fields.get(id)?.type))
        ?? [...config.fields].find(([, f]) => searchable(f.type))?.[0];
    if (fieldId === undefined) return [];   // no searchable field → genuinely un-derivable
    const seen = new Set<string>();
    const out: Match[] = [];
    for (const r of hits) {
        const label = sliceFieldText(config as never, fieldId, r as Row);
        if (label === undefined) continue;   // never offer a "null"/"undefined" suggestion (cf. autoDeriveFieldHints)
        if (seen.has(label)) continue;   // distinct values only
        seen.add(label);
        out.push({ id: label, label, meta: none });
    }
    return out;
}

/** Cap on auto-derived hints per field — a high-cardinality field shouldn't
 *  flood the suggestion list (free entry beyond the cap stays allowed). */
const FIELD_HINT_CAP = 50;

/**
 * Distinct field VALUES across the bound rows — the auto-derived autocomplete
 * suggestions for a string field's `in`/`notIn`/`eq` value controls (#131).
 * Capped at {@link FIELD_HINT_CAP}. A value that is not a String (null or
 * undefined in an untyped row) is no hint. Pure + exported for testing.
 *
 * @param rows - the bound rows
 * @param accessor - the string field's value accessor
 * @param cap - max distinct values to collect
 * @returns the distinct String values (insertion order), capped
 */
export function autoDeriveFieldHints(
    rows: ReadonlyArray<unknown>,
    accessor: (r: unknown) => unknown,
    cap: number = FIELD_HINT_CAP,
): string[] {
    const seen = new Set<string>();
    for (const r of rows) {
        const v = accessor(r);
        if (!isValueOf(v, StringType)) continue;
        seen.add(v as ValueTypeOf<StringType>);
        if (seen.size >= cap) break;
    }
    return [...seen];
}

export const SliceImpl: PlatformFunction[] = [
    // The generic platforms hand their arguments over untyped; the handle is a
    // `Slice.Types.Bind` value.
    Slice.rows.implement((_T: EastTypeValue) => (handle: unknown) => {
        const k = (handle as SliceBind).key;
        const bound = boundByKey.get(k);
        if (bound === undefined) return [];
        trackKey(k);
        const state = readState(k);
        const now = new Date();
        return boundRows(bound).filter(r => sliceMatches(state, bound.config, r, now));
    }),
    // The FULL bound rows, each tagged with whether it passes the active
    // narrowing — the "keep the excluded" feed. `Slice.rows` is this filtered to
    // `matched`; here every row survives, carrying its `matched` flag for a
    // downstream de-emphasis effect (e.g. a Schematic's `excluded`).
    Slice.partition.implement((_T: EastTypeValue) => (handle: unknown) => {
        const k = (handle as SliceBind).key;
        const bound = boundByKey.get(k);
        if (bound === undefined) return [];
        trackKey(k);
        const state = readState(k);
        const now = new Date();
        return boundRows(bound).map(r => ({ value: r, matched: sliceMatches(state, bound.config, r, now) }));
    }),
    Slice.bind.implement((_T: EastTypeValue) => bindImpl),

    // ── issue #106 primitives — host I/O backing the IR-bearing handle methods.
    // Each is a faithful lift of the original closure body, keyed by the store key
    // (and resolving the bound rows / config / `toMatch` from `boundByKey`). ──

    // --- raw read / write ---
    SliceBindPrimitives.read.implement((key) => { trackKey(key); return readState(key); }),
    SliceBindPrimitives.write.implement((key, state) => { writeState(key, state); return null; }),

    // --- range ---
    SliceBindPrimitives.setRange.implement((key, range) => updateState(key, s => ({ ...s, range }))),
    SliceBindPrimitives.setCompare.implement((key, compare) => updateState(key, s => ({ ...s, compare }))),
    SliceBindPrimitives.setResolution.implement((key, resolution) => updateState(key, s => ({ ...s, resolution }))),

    // --- filters ---
    // Appending a structurally-equal predicate is a no-op (no write, no
    // re-render) — an accidental double Add can't inflate the active count
    // (#164). Structural equality via East's equalFor, which handles the
    // nested variant/struct/Date/Set payloads correctly.
    SliceBindPrimitives.addFilter.implement((key, pred) => {
        const s = readState(key);
        if (s.filters.some(f => predicateEqual(f, pred))) return null;
        writeState(key, { ...s, filters: [...s.filters, pred] });
        return null;
    }),
    SliceBindPrimitives.removeFilter.implement((key, index) => {
        const i = Number(index);
        return updateState(key, s => ({ ...s, filters: s.filters.filter((_, j) => j !== i) }));
    }),
    // Idempotent toggle (#165): append when absent, remove the structurally-
    // equal clause when present — the "filter to this" gesture both narrows
    // and un-narrows.
    SliceBindPrimitives.toggleFilter.implement((key, pred) =>
        updateState(key, s => {
            const i = s.filters.findIndex(f => predicateEqual(f, pred));
            return i >= 0
                ? { ...s, filters: s.filters.filter((_, j) => j !== i) }
                : { ...s, filters: [...s.filters, pred] };
        })),
    // "Clear all" must zero every NARROWING the Summary counts — filters,
    // active cohorts, range, and search — not just filters/cohorts (else the
    // count can never reach 0). Breakdown (grouping), visible (legend whitelist)
    // and selectedIndex (selection) are presentation, not narrowings: left alone,
    // matching activeCount/isActive.
    SliceBindPrimitives.clearFilters.implement((key) =>
        updateState(key, s => ({
            ...s, filters: [], activeCohorts: new SortedSet<string>(undefined, compareStrings), range: none, search: none,
        }))),

    // --- cohorts ---
    SliceBindPrimitives.defineCohort.implement((key, cohort) =>
        updateState(key, s => {
            if (s.cohorts.some(x => x.id === cohort.id)) {
                throw new Error(`[Slice.bind] cohort id "${cohort.id}" already exists`);
            }
            return { ...s, cohorts: [...s.cohorts, cohort] };
        })),
    SliceBindPrimitives.updateCohort.implement((key, id, cohort) =>
        updateState(key, s => ({ ...s, cohorts: s.cohorts.map(x => x.id === id ? cohort : x) }))),
    SliceBindPrimitives.removeCohort.implement((key, id) =>
        updateState(key, s => {
            const activeCohorts = new SortedSet(s.activeCohorts, compareStrings);
            activeCohorts.delete(id);
            return { ...s, cohorts: s.cohorts.filter(c => c.id !== id), activeCohorts };
        })),
    SliceBindPrimitives.toggleCohort.implement((key, id) =>
        updateState(key, s => {
            const activeCohorts = new SortedSet(s.activeCohorts, compareStrings);
            if (activeCohorts.has(id)) activeCohorts.delete(id);
            else activeCohorts.add(id);
            return { ...s, activeCohorts };
        })),

    // --- breakdown / search / visible / selection ---
    SliceBindPrimitives.setBreakdown.implement((key, breakdown) => updateState(key, s => ({ ...s, breakdown }))),
    SliceBindPrimitives.setSearch.implement((key, search) => updateState(key, s => ({ ...s, search }))),
    SliceBindPrimitives.setVisible.implement((key, visible) => updateState(key, s => ({ ...s, visible }))),
    SliceBindPrimitives.select.implement((key, selectedIndex) => updateState(key, s => ({ ...s, selectedIndex }))),

    // --- derived ---
    SliceBindPrimitives.isActive.implement((key) => {
        trackKey(key);
        const s = readState(key);
        // Active iff a NARROWING is set (mirrors activeCount + clearFilters).
        // breakdown (grouping), visible (legend whitelist) and selectedIndex
        // (selection) don't narrow the row set, so they don't count.
        return (
            s.range.type === "some" ||
            s.filters.length > 0 ||
            s.activeCohorts.size > 0 ||
            s.search.type === "some"
        );
    }),
    SliceBindPrimitives.activeCount.implement((key) => {
        trackKey(key);
        const s = readState(key);
        // Count NARROWINGS only — exactly what "clear all" (clearFilters) resets.
        // Breakdown (grouping), visible (legend whitelist) and selectedIndex
        // (selection) don't narrow the row set, so they're excluded; otherwise
        // "clear all" could never zero the displayed count.
        let n = 0;
        if (s.range.type === "some") n++;
        n += s.filters.length;
        n += s.activeCohorts.size;
        if (s.search.type === "some") n++;
        return BigInt(n);
    }),

    // --- config-derived metadata (config is static; no reactive tracking) ---
    SliceBindPrimitives.dimensions.implement((key) => {
        const e = boundByKey.get(key);
        return e ? sliceDimensions(e.config) : [];
    }),
    SliceBindPrimitives.fields.implement((key) => {
        const e = boundByKey.get(key);
        if (e === undefined) return [];
        const base = sliceFields(e.config as Parameters<typeof sliceFields>[0]);
        // Auto-derive distinct value hints from the bound data for string fields
        // that carry no explicit `hints` (#131) — so picking `in`/`notIn`/`eq` on,
        // e.g., `country` suggests the values actually present. Explicit hints win;
        // free entry stays allowed (suggestions, not an allow-list).
        const fieldsMap = (e.config as unknown as {
            fields: Map<string, { type: string; value: { accessor: (r: unknown) => unknown } }>;
        }).fields;
        const rows = boundRows(e);
        // (Loose `variant` format field vs the strict platform output — same
        // boundary cast as `writeState`; identical runtime shape.)
        return base.map(f => {
            if (f.hints.length > 0 || f.kind !== "string") return f;
            const accessor = fieldsMap.get(f.fieldId)?.value?.accessor;
            if (accessor === undefined) return f;
            return { ...f, hints: autoDeriveFieldHints(rows, accessor) };
        }) as never;
    }),
    SliceBindPrimitives.searchFieldIds.implement((key) => {
        const e = boundByKey.get(key);
        return e ? [...e.config.searchFieldIds] : [];
    }),
    SliceBindPrimitives.rangeFieldId.implement((key) => {
        const e = boundByKey.get(key);
        // The engine's config holds the loose `variant`; the output is the
        // strict `option<string>` — identical runtime shape.
        return (e ? e.config.rangeFieldId : none) as never;
    }),

    // --- data-derived results (computed over the bound `rows`) ---
    SliceBindPrimitives.totalCount.implement((key) => {
        const e = boundByKey.get(key);
        return BigInt(e ? boundRows(e).length : 0);
    }),
    SliceBindPrimitives.resultCount.implement((key) => {
        trackKey(key);
        const e = boundByKey.get(key);
        if (e === undefined) return 0n;
        const s = readState(key);
        const now = new Date();
        return BigInt(boundRows(e).filter(r => sliceMatches(s, e.config, r, now)).length);
    }),
    SliceBindPrimitives.groups.implement((key) => {
        trackKey(key);
        const e = boundByKey.get(key);
        if (e === undefined) return [];
        return sliceBreakdown(readState(key), e.config, boundRows(e), new Date());
    }),
    // Self-excluding facet options (#188): the breakdown groups computed with
    // the breakdown field's OWN filters stripped from the narrowing — a facet
    // must keep showing every option (with live counts) while some are
    // selected. Filters on other fields, range, search, and cohorts still
    // narrow the option counts.
    SliceBindPrimitives.facetGroups.implement((key) => {
        trackKey(key);
        const e = boundByKey.get(key);
        if (e === undefined) return [];
        const s = readState(key);
        if (s.breakdown.type !== "some") return [];
        const fieldId = s.breakdown.value.fieldId;
        const facetState = { ...s, filters: s.filters.filter(f => f.value.fieldId !== fieldId) };
        return sliceBreakdown(facetState, e.config, boundRows(e), new Date());
    }),
    SliceBindPrimitives.series.implement((key, xFieldId, valueFieldId) => {
        trackKey(key);
        const e = boundByKey.get(key);
        if (e === undefined) return [];
        // loose point shape (`size`/`color` as bare `none`) vs strict `option<...>`.
        return sliceSeries(readState(key), e.config, boundRows(e), xFieldId, valueFieldId, new Date()) as never;
    }),
    SliceBindPrimitives.matches.implement((key) => {
        trackKey(key);
        const e = boundByKey.get(key);
        if (e === undefined) return [];
        const s = readState(key);
        const now = new Date();
        const hits = s.search.type === "some"
            ? boundRows(e).filter(r => sliceMatches(only({ search: s.search }), e.config, r, now))
            : boundRows(e);
        if (e.toMatch !== undefined) return hits.map(e.toMatch);
        // No `toMatch`: auto-derive distinct search options from the config's
        // first searchable string field so search works out of the box (#129).
        return autoDeriveMatches(hits, e.config as never);
    }),
    SliceBindPrimitives.cohortCounts.implement((key) => {
        trackKey(key);
        const counts = new SortedMap<string, bigint>(undefined, compareStrings);
        const e = boundByKey.get(key);
        if (e === undefined) return counts;
        const s = readState(key);
        const now = new Date();
        for (const c of s.cohorts) {
            counts.set(c.id, BigInt(boundRows(e).filter(r => sliceMatches(only({ filters: c.filters }), e.config, r, now)).length));
        }
        return counts;
    }),
];

registerPlatformImplementation(SliceImpl);
registerPlatformImplementation(SliceApplyImpl);

export { SliceApplyImpl };
