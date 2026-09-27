/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure JS implementation of the `Slice.apply.*` platforms.
 *
 * No DOM, no React, no host-specific APIs — just predicate evaluation
 * against plain JS values. Suitable for browser, server, and tests. Plug
 * into any East runtime via the platform-functions map:
 *
 * ```ts
 * import { describeEast, TestImpl } from "@elaraai/east-node-std";
 * import { SliceApplyImpl } from "@elaraai/east-ui";
 *
 * describeEast("MySlice", (test) => { ... }, {
 *     platformFns: { ...TestImpl, ...SliceApplyImpl },
 * });
 * ```
 *
 * # Variant / Option shape
 *
 * East values arrive at platform impls as `variant<Type, Value>` objects
 * (from `@elaraai/east`) — they carry `.type` and `.value` plus the
 * `variant_symbol` brand. Options are variants with `"some"` / `"none"`
 * tags. Constructing return variants ALWAYS goes through
 * `variant()` / `some()` / `none` so the brand symbol is attached.
 *
 * # Field extraction
 *
 * Predicates reference fields by `fieldId` (string). This impl extracts
 * the field from a row via plain JS property access (`row[fieldId]`). The
 * accessor function declared in `config.fields[fieldId]` is decorative
 * for the apply engine — it exists so East-side consumers (charts, axis
 * draws) can compose against typed accessors when needed — with ONE
 * exception: a `text` field (a non-primitive field, or one with a `text`
 * projection) is searched through what its accessor prints, because the
 * raw value is not a String ({@link sliceFieldText}).
 *
 * # Comparison semantics
 *
 * Range / op comparisons use East helpers (`lessFor`, `equalFor`) where
 * the field's typed value can flow through them; this handles NaN /
 * total-order semantics correctly.
 *
 * @packageDocumentation
 */

import {
    some, none, variant,
    equalFor, lessFor, lessEqualFor, greaterFor, greaterEqualFor, isValueOf, parseFor, printFor,
    StringType, IntegerType, FloatType, DateTimeType, BooleanType,
    type ValueTypeOf,
} from "@elaraai/east";
import { formatDateTime, parseDateTimeFormatted, tokenizeDateTimeFormat } from "@elaraai/east/internal";
import type {
    SliceBooleanOpType, SliceDateTimeOpType, SliceFloatOpType, SliceIntegerOpType, SlicePredicateType, SliceStringOpType,
} from "./index.js";

// Module-scope comparators — East-typed, instantiated once. Routing every
// op through these gives correct NaN / total-order / BigInt semantics.
const eqString    = equalFor(StringType);
const eqInteger   = equalFor(IntegerType);
const ltInteger   = lessFor(IntegerType);
const lteInteger  = lessEqualFor(IntegerType);
const gtInteger   = greaterFor(IntegerType);
const gteInteger  = greaterEqualFor(IntegerType);
const ltFloat     = lessFor(FloatType);
const lteFloat    = lessEqualFor(FloatType);
const gtFloat     = greaterFor(FloatType);
const gteFloat    = greaterEqualFor(FloatType);
const ltDateTime  = lessFor(DateTimeType);
const lteDateTime = lessEqualFor(DateTimeType);
const gtDateTime  = greaterFor(DateTimeType);
const eqBoolean   = equalFor(BooleanType);

// ---------------------------------------------------------------------------
// Predicate dispatch — outer variant = type family; inner struct = fieldId + op
// ---------------------------------------------------------------------------

/** One filter clause, decoded — derived from its East type, never mirrored. */
type SlicePredicateValue = ValueTypeOf<SlicePredicateType>;

/** A tag outside the East type — only a malformed value carries one. */
function unknownTag(what: string, x: never): never {
    throw new Error(`unknown ${what}: ${(x as variant).type}`);
}

// Each matcher VALIDATES the row value against the predicate family's East type
// (`isValueOf`) before comparing, then uses the already-correct JS value — never
// a blind `String()`/`BigInt()`/`new Date()` coercion. A value that isn't of the
// field's type (a kind-mismatched predicate, or the field absent from the row)
// can't satisfy the predicate → it returns `false` (excludes the row) instead of
// crashing (`BigInt(3.5)`, `new Date(7n)`) or mis-coercing (`String(undefined)`
// → "undefined"). The comparators still come from East's `comparison.ts`.

function matchStringOp(op: ValueTypeOf<SliceStringOpType>, value: unknown): boolean {
    if (!isValueOf(value, StringType)) return false;
    const v = value as ValueTypeOf<StringType>;
    switch (op.type) {
        case "eq":       return eqString(v, op.value);
        case "neq":      return !eqString(v, op.value);
        case "in":       return op.value.has(v);
        case "notIn":    return !op.value.has(v);
        case "contains": return v.includes(op.value);
        // A half-typed regex in a live filter must narrow to nothing, not crash.
        case "matches":  { try { return new RegExp(op.value).test(v); } catch { return false; } }
        case "startsWith": return v.startsWith(op.value);
        case "endsWith":   return v.endsWith(op.value);
        // Presence ops treat whitespace-only as empty (#171).
        case "isEmpty":    return v.trim() === "";
        case "isNotEmpty": return v.trim() !== "";
        default: return unknownTag("string op", op);
    }
}

function matchIntegerOp(op: ValueTypeOf<SliceIntegerOpType>, value: unknown): boolean {
    if (!isValueOf(value, IntegerType)) return false;
    const v = value as ValueTypeOf<IntegerType>;
    switch (op.type) {
        case "eq":  return  eqInteger(v, op.value);
        case "neq": return !eqInteger(v, op.value);
        case "lt":  return  ltInteger(v, op.value);
        case "lte": return lteInteger(v, op.value);
        case "gt":  return  gtInteger(v, op.value);
        case "gte": return gteInteger(v, op.value);
        case "in":  return op.value.has(v);
        default: return unknownTag("integer op", op);
    }
}

function matchFloatOp(op: ValueTypeOf<SliceFloatOpType>, value: unknown): boolean {
    if (!isValueOf(value, FloatType)) return false;
    const v = value as ValueTypeOf<FloatType>;
    switch (op.type) {
        case "lt":  return  ltFloat(v, op.value);
        case "lte": return lteFloat(v, op.value);
        case "gt":  return  gtFloat(v, op.value);
        case "gte": return gteFloat(v, op.value);
        default: return unknownTag("float op", op);
    }
}

function matchDateTimeOp(op: ValueTypeOf<SliceDateTimeOpType>, value: unknown): boolean {
    if (!isValueOf(value, DateTimeType)) return false;
    const v = value as ValueTypeOf<DateTimeType>;
    switch (op.type) {
        case "before": return ltDateTime(v, op.value);
        case "after":  return gtDateTime(v, op.value);
        case "between": return lteDateTime(op.value.from, v) && lteDateTime(v, op.value.to);
        default: return unknownTag("datetime op", op);
    }
}

function matchBooleanOp(op: ValueTypeOf<SliceBooleanOpType>, value: unknown): boolean {
    // `is` is the one Boolean operator.
    return isValueOf(value, BooleanType) && eqBoolean(value as ValueTypeOf<BooleanType>, op.value);
}

/**
 * Whether a row satisfies one Slice filter clause — the engine's own test, the
 * one every `filters` clause and cohort narrows by: the row's value at the
 * clause's field, checked against the clause family's East type (`isValueOf`)
 * and compared with East's comparators. A value of another type, or a field
 * the row lacks, never satisfies it.
 *
 * @param pred - The clause
 * @param row - The row — a struct value, keyed by field id
 * @returns Whether the row satisfies the clause
 */
export function slicePredicateMatches(pred: SlicePredicateValue, row: Record<string, unknown>): boolean {
    const fieldValue = row[pred.value.fieldId];
    switch (pred.type) {
        case "string":   return matchStringOp(pred.value.op, fieldValue);
        case "integer":  return matchIntegerOp(pred.value.op, fieldValue);
        case "float":    return matchFloatOp(pred.value.op, fieldValue);
        case "datetime": return matchDateTimeOp(pred.value.op, fieldValue);
        case "boolean":  return matchBooleanOp(pred.value.op, fieldValue);
        default: return unknownTag("predicate family", pred);
    }
}

// ---------------------------------------------------------------------------
// Range — datetimePreset / datetime / integer / float
// ---------------------------------------------------------------------------

/** A preset's window ending at `now`, on UTC days: East's DateTime is a UTC
 *  instant, so "today" starts at UTC midnight and the rows a preset keeps never
 *  depend on the viewer's timezone. The range pill resolves the same way. */
function resolveDateTimePreset(preset: variant, now: Date): { from: Date; to: Date } {
    const to = now;
    const from = new Date(now);
    switch (preset.type) {
        case "today":   from.setUTCHours(0, 0, 0, 0); return { from, to };
        case "last7d":  from.setUTCDate(from.getUTCDate() - 7);  return { from, to };
        case "last30d": from.setUTCDate(from.getUTCDate() - 30); return { from, to };
        case "last90d": from.setUTCDate(from.getUTCDate() - 90); return { from, to };
        case "ytd":     return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), to };
        default: throw new Error(`unknown datetime preset: ${preset.type}`);
    }
}

// A range whose arm kind doesn't match the rangeFieldId's actual value type is a
// config error; rather than crash (`new Date(7n)`) or silently mis-narrow
// (`BigInt(date)` → epoch millis compared against [0,100]), the mismatched range
// is INERT — the row passes (`true`), so a broken range simply doesn't filter.
function rangeMatches(range: variant, value: unknown, now: Date): boolean {
    switch (range.type) {
        case "datetimePreset": {
            if (!isValueOf(value, DateTimeType)) return true;
            const { from, to } = resolveDateTimePreset(range.value as variant, now);
            const v = value as Date;
            return lteDateTime(from, v) && lteDateTime(v, to);
        }
        case "datetime": {
            if (!isValueOf(value, DateTimeType)) return true;
            const { from, to } = range.value as { from: Date; to: Date };
            const v = value as Date;
            return lteDateTime(from, v) && lteDateTime(v, to);
        }
        case "integer": {
            if (!isValueOf(value, IntegerType)) return true;
            const { from, to } = range.value as { from: bigint; to: bigint };
            const v = value as bigint;
            return lteInteger(from, v) && lteInteger(v, to);
        }
        case "float": {
            if (!isValueOf(value, FloatType)) return true;
            const { from, to } = range.value as { from: number; to: number };
            const v = value as number;
            return lteFloat(from, v) && lteFloat(v, to);
        }
        default: throw new Error(`unknown range tag: ${range.type}`);
    }
}

// ---------------------------------------------------------------------------
// State / Config JS shape (decoded from East values at the impl boundary)
// ---------------------------------------------------------------------------

interface ConfigLike {
    readonly fields: Map<string, variant>;
    readonly rangeFieldId: variant;
    readonly searchFieldIds: ReadonlyArray<string>;
    readonly breakdownFieldIds: ReadonlyArray<string>;
    readonly fieldHints?: Map<string, ReadonlyArray<string>>;
}

interface CohortLike {
    readonly id: string;
    readonly name: string;
    readonly filters: ReadonlyArray<SlicePredicateValue>;
    /** `option<string>` — the cohort's family; absent on a state built before the field existed. */
    readonly group?: variant;
}

/** A cohort's family, or `undefined` for a standalone cohort (tolerates a pre-field state with no `group`). */
export function cohortGroupOf(cohort: { readonly group?: variant | undefined }): string | undefined {
    const g = cohort.group;
    return g !== undefined && g.type === "some" ? (g.value as string) : undefined;
}

interface StateLike {
    readonly range: variant;
    readonly filters: ReadonlyArray<SlicePredicateValue>;
    readonly cohorts: ReadonlyArray<CohortLike>;
    readonly activeCohorts: Set<string>;
    readonly breakdown: variant;
    readonly search: variant;
    readonly visible: variant;
    readonly selectedIndex: variant;
}

// ---------------------------------------------------------------------------
// Search text — what the typeahead reads at a field
// ---------------------------------------------------------------------------

/** The field kinds the typeahead searches. */
function isSearchableKind(kind: string | undefined): boolean {
    return kind === "string" || kind === "text";
}

/**
 * A row's SEARCH text at a field: a `string` field's value; a `text` field's
 * projection — the String its accessor prints (the field's `.east` text, or
 * the author's `text` accessor); `undefined` for any other kind, an absent
 * field, or a projection that throws (fail-open: a row the projection cannot
 * print is simply not a match).
 *
 * @param config - The slice config (its `fields` specs)
 * @param fieldId - The field to read
 * @param row - The row
 * @returns The text the search compares, or `undefined` when the field yields none
 */
export function sliceFieldText(config: Pick<ConfigLike, "fields">, fieldId: string, row: Record<string, unknown>): string | undefined {
    const spec = config.fields.get(fieldId);
    if (spec === undefined) return undefined;
    if (spec.type === "string") {
        const v = row[fieldId];
        return typeof v === "string" ? v : undefined;
    }
    if (spec.type === "text") {
        const accessor = (spec.value as { accessor?: unknown } | null)?.accessor;
        if (typeof accessor !== "function") return undefined;
        try {
            const v = (accessor as (r: unknown) => unknown)(row);
            return typeof v === "string" ? v : undefined;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// matches — composed AND of every active narrowing
// ---------------------------------------------------------------------------

export function sliceMatches(state: StateLike, config: ConfigLike, row: Record<string, unknown>, now: Date): boolean {
    // Range — only applies if both state.range is some and config.rangeFieldId is some
    if (state.range.type === "some" && config.rangeFieldId.type === "some") {
        const fieldId = config.rangeFieldId.value as string;
        if (!rangeMatches(state.range.value as variant, row[fieldId], now)) return false;
    }
    // Filters — all AND-ed
    for (const f of state.filters) {
        if (!slicePredicateMatches(f, row)) return false;
    }
    // Active cohorts — a standalone cohort's filters AND into the chain; the
    // active members of a GROUP are alternatives (the row passes the group when
    // any of them matches), and the groups AND with each other.
    const groups = new Map<string, boolean>();
    for (const cohortId of state.activeCohorts) {
        const cohort = state.cohorts.find(c => eqString(c.id, cohortId));
        if (!cohort) continue;
        const matched = cohort.filters.every(f => slicePredicateMatches(f, row));
        const group = cohortGroupOf(cohort);
        if (group === undefined) {
            if (!matched) return false;
            continue;
        }
        groups.set(group, (groups.get(group) ?? false) || matched);
    }
    for (const passed of groups.values()) {
        if (!passed) return false;
    }
    // Search — case-insensitive substring across the searchable fields: string
    // fields by value, `text` fields through their projection. Resolve them the
    // SAME way the suggestion projection (autoDeriveMatches) does: the
    // configured `searchFieldIds` that are searchable, else fall back to every
    // searchable field. Otherwise a `searchFieldIds` that names only
    // unsearchable fields would make the search exclude every row while the
    // dropdown still offers (fallback) suggestions — a silent dead filter
    // (#129 bug-hunt).
    if (state.search.type === "some") {
        const q = (state.search.value as string).toLowerCase();
        const configured = config.searchFieldIds.filter(id => isSearchableKind(config.fields.get(id)?.type));
        const searchable = configured.length > 0
            ? configured
            : [...config.fields].filter(([, spec]) => isSearchableKind((spec as variant).type)).map(([id]) => id);
        const any = searchable.some(id => {
            const text = sliceFieldText(config, id, row);
            return text !== undefined && text.toLowerCase().includes(q);
        });
        if (!any) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Group keys — a row value's text, spelled and read through East
// ---------------------------------------------------------------------------

/** A DateTime group key's spelling: the ISO-8601 UTC instant with its `Z`, so a
 *  key never depends on a timezone — a `visible` whitelist captured under one
 *  timezone still matches the same instant under another (#120 bug-hunt). */
const GROUP_KEY_INSTANT = tokenizeDateTimeFormat("YYYY-MM-DDTHH:mm:ss.SSSZ");
const printIntegerKey = printFor(IntegerType);
const printFloatKey   = printFor(FloatType);
const printBooleanKey = printFor(BooleanType);
const readIntegerKey  = parseFor(IntegerType);
const readBooleanKey  = parseFor(BooleanType);

/**
 * The group key a row value falls under — the stable text that names its
 * breakdown group, its chart series and its chart x position — as East spells
 * the value: a String is its own key; an Integer, Float or Boolean is spelled
 * as East prints it; a DateTime is its ISO-8601 UTC instant, through East's
 * datetime format. The engine's rows are untyped, so the value's East type is
 * read with `isValueOf`, as the matchers read theirs. A value of none of those
 * types — an absent field, or a field that is not a primitive — keys as
 * JavaScript spells it.
 *
 * @param value - The row's value at the keyed field
 * @returns The group key
 */
export function sliceGroupKey(value: unknown): string {
    if (isValueOf(value, StringType))   return value as ValueTypeOf<StringType>;
    if (isValueOf(value, DateTimeType)) return formatDateTime(value as ValueTypeOf<DateTimeType>, GROUP_KEY_INSTANT);
    if (isValueOf(value, IntegerType))  return printIntegerKey(value as ValueTypeOf<IntegerType>);
    if (isValueOf(value, FloatType))    return printFloatKey(value as ValueTypeOf<FloatType>);
    if (isValueOf(value, BooleanType))  return printBooleanKey(value as ValueTypeOf<BooleanType>);
    return String(value);
}

/** The value a group key names, by the keyed field's primitive kind. */
export interface SliceGroupKeyValues {
    string:   ValueTypeOf<StringType>;
    integer:  ValueTypeOf<IntegerType>;
    boolean:  ValueTypeOf<BooleanType>;
    datetime: ValueTypeOf<DateTimeType>;
}

/**
 * The value a group key names for a field of the given kind — the inverse of
 * {@link sliceGroupKey}, read through East: a String key is the value itself,
 * an Integer or Boolean key is read by East's parser, and a DateTime key by
 * East's datetime format. A Float field has no reading: its groups have no
 * equality predicate to pin.
 *
 * @param kind - The keyed field's primitive kind
 * @param key - The group key
 * @returns The value; `undefined` when the key does not read as one
 */
export function readSliceGroupKey<K extends keyof SliceGroupKeyValues>(kind: K, key: string): SliceGroupKeyValues[K] | undefined {
    switch (kind) {
        case "string":
            return key as SliceGroupKeyValues[K];
        case "integer": {
            const read = readIntegerKey(key);
            return read.success ? read.value as SliceGroupKeyValues[K] : undefined;
        }
        case "boolean": {
            const read = readBooleanKey(key);
            return read.success ? read.value as SliceGroupKeyValues[K] : undefined;
        }
        case "datetime": {
            const read = parseDateTimeFormatted(key, GROUP_KEY_INSTANT);
            return read.success ? read.value as SliceGroupKeyValues[K] : undefined;
        }
        default:
            return undefined;
    }
}

function sliceBreakdownKey(state: StateLike, _config: ConfigLike, row: Record<string, unknown>): variant {
    if (state.breakdown.type !== "some") return none;
    const { fieldId } = state.breakdown.value as { fieldId: string };
    return some(sliceGroupKey(row[fieldId]));
}

// ---------------------------------------------------------------------------
// Series palette — the canonical breakdown swatch colours, assigned by group
// order. Opaque theme-token strings (the renderer resolves them); held here so
// the pure engine can colour groups + series identically (one source of truth
// shared by Slice.Legend and Slice.Chart).
// ---------------------------------------------------------------------------

export const SLICE_SERIES_PALETTE: readonly string[] = [
    "{colors.series.brand}",
    "{colors.series.brandDeep}",
    "{colors.status.warn}",
    "{colors.status.info}",
    "{colors.gray.500}",
    "{colors.gray.400}",
    "{colors.gray.300}",
];

/** Colour for the i-th series (by group order); the `other` roll-up bucket is muted. */
const seriesColor = (i: number): string => SLICE_SERIES_PALETTE[i % SLICE_SERIES_PALETTE.length]!;

/** The muted colour of the top-N `other` roll-up bucket. */
const OTHER_COLOR = "{colors.gray.400}";

/** One ordered breakdown group: its stable key, palette colour, the underlying
 *  group keys it stands for (a singleton, or the rolled-up tail for `other`),
 *  and the total row count across those members. */
interface OrderedGroup {
    readonly key: string;
    readonly color: string;
    readonly members: ReadonlyArray<string>;
    readonly count: number;
}

/**
 * Order breakdown groups by count (desc) and apply the top-N `limit` roll-up:
 * the first `limit` groups keep their palette colour, the tail collapses into a
 * single muted `other` bucket. A non-positive limit means "no limit".
 *
 * This is the ONE source of truth for group identity, order, and colour —
 * `sliceBreakdown` (legend / group chips) and `sliceSeries` (chart series) must
 * agree exactly, or the legend's `visible` whitelist cannot control the chart
 * and the chart draws tail series the legend doesn't list (#162).
 */
function orderedGroups(counts: ReadonlyMap<string, number>, limitOpt: variant): OrderedGroup[] {
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const rawLimit = limitOpt.type === "some" ? Number(limitOpt.value as bigint) : undefined;
    const limit = rawLimit !== undefined && rawLimit > 0 ? rawLimit : undefined;
    if (limit !== undefined && sorted.length > limit) {
        const top = sorted.slice(0, limit);
        const tail = sorted.slice(limit);
        return [
            ...top.map(([key, n], i) => ({ key, color: seriesColor(i), members: [key], count: n })),
            { key: "other", color: OTHER_COLOR, members: tail.map(([k]) => k), count: tail.reduce((sum, [, n]) => sum + n, 0) },
        ];
    }
    return sorted.map(([key, n], i) => ({ key, color: seriesColor(i), members: [key], count: n }));
}

// ---------------------------------------------------------------------------
// breakdown — group narrowed data by the active dimension and count
// ---------------------------------------------------------------------------

export function sliceBreakdown(
    state: StateLike,
    config: ConfigLike,
    data: ReadonlyArray<Record<string, unknown>>,
    now: Date,
): Array<{ key: string; count: bigint; color: string }> {
    if (state.breakdown.type !== "some") return [];
    const bd = state.breakdown.value as { fieldId: string; limit: variant };
    const counts = new Map<string, number>();
    for (const row of data) {
        if (!sliceMatches(state, config, row, now)) continue;
        const key = sliceGroupKey(row[bd.fieldId]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orderedGroups(counts, bd.limit).map(g => ({ key: g.key, count: BigInt(g.count), color: g.color }));
}

// ---------------------------------------------------------------------------
// series — pivot narrowed data into coloured multi-series long format. Groups
// by the active breakdown dimension with the SAME group identity (stable
// sliceGroupKey keys), order, colours, and top-N `other` roll-up as
// `sliceBreakdown` — legend chips and chart series must correspond one-to-one
// (#162). Aggregates `valueField` per x in data order.
// ---------------------------------------------------------------------------

export function sliceSeries(
    state: StateLike,
    config: ConfigLike,
    data: ReadonlyArray<Record<string, unknown>>,
    xField: string,
    valueField: string,
    now: Date,
): Array<{ key: string; color: string; points: Array<{ x: variant; value: number; size: typeof none; color: typeof none }> }> {
    // x key — the same stable spelling as breakdown group keys, so points
    // aggregate per x value (one instant, whichever Date object carries it).
    const xKey = (row: Record<string, unknown>): string => sliceGroupKey(row[xField]);
    // Typed x coordinate (band category / linear number / time date) for the
    // chart's ChartXType; the renderer derives the scale from the arm. Keyed by
    // xKey so points aggregate per x while keeping the original typed value. The
    // arm follows the value's East type, read as the matchers read theirs.
    const xCoord = (row: Record<string, unknown>): variant => {
        const xv = row[xField];
        if (isValueOf(xv, DateTimeType)) return variant("time", xv as ValueTypeOf<DateTimeType>);
        if (isValueOf(xv, IntegerType))  return variant("number", Number(xv as ValueTypeOf<IntegerType>));
        if (isValueOf(xv, FloatType))    return variant("number", xv as ValueTypeOf<FloatType>);
        return variant("category", sliceGroupKey(xv));
    };
    const coords = new Map<string, variant>();
    if (state.breakdown.type !== "some") {
        // No active split: one ungrouped series aggregating valueField per x (in
        // data order), labelled by the value field, in the lead palette colour.
        const xs = new Map<string, number>();
        for (const row of data) {
            if (!sliceMatches(state, config, row, now)) continue;
            const xk = xKey(row);
            if (!coords.has(xk)) coords.set(xk, xCoord(row));
            xs.set(xk, (xs.get(xk) ?? 0) + Number(row[valueField] ?? 0));
        }
        const label = (config.fields.get(valueField)?.value as { label?: string } | undefined)?.label ?? valueField;
        return [{ key: label, color: seriesColor(0), points: [...xs.entries()].map(([x, value]) => ({ x: coords.get(x)!, value, size: none, color: none })) }];
    }
    const bd = state.breakdown.value as { fieldId: string; limit: variant };
    const counts = new Map<string, number>();
    // key → (x → summed value); both Maps preserve insertion (data) order. The
    // group key uses sliceGroupKey — the SAME stable spelling sliceBreakdown
    // uses — so the legend's `visible` whitelist (which stores group keys)
    // actually matches the series keys (#162).
    const byKey = new Map<string, Map<string, number>>();
    for (const row of data) {
        if (!sliceMatches(state, config, row, now)) continue;
        const key = sliceGroupKey(row[bd.fieldId]);
        const xk = xKey(row);
        if (!coords.has(xk)) coords.set(xk, xCoord(row));
        const v = Number(row[valueField] ?? 0);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        let xs = byKey.get(key);
        if (xs === undefined) { xs = new Map(); byKey.set(key, xs); }
        xs.set(xk, (xs.get(xk) ?? 0) + v);
    }
    // Group set / order / colour come from the SAME roll-up as sliceBreakdown
    // (top-N by count desc + a muted `other` tail bucket), so chart series and
    // legend chips agree one-to-one. Colour is assigned over the FULL group
    // order (a series keeps its legend colour even when others are hidden),
    // then series toggled off via the legend (`state.visible`) drop.
    const groups = orderedGroups(counts, bd.limit);
    const visible = state.visible.type === "some" ? (state.visible.value as Set<string>) : undefined;
    return groups
        .map(g => {
            let xs: ReadonlyMap<string, number>;
            if (g.members.length === 1) {
                xs = byKey.get(g.members[0]!)!;
            } else {
                // The `other` bucket: sum the tail groups' values per x, ordered
                // by global first-seen x so the merged series stays in data order.
                const merged = new Map<string, number>();
                for (const m of g.members) {
                    for (const [x, v] of byKey.get(m)!) merged.set(x, (merged.get(x) ?? 0) + v);
                }
                const inOrder = new Map<string, number>();
                for (const xk of coords.keys()) {
                    const v = merged.get(xk);
                    if (v !== undefined) inOrder.set(xk, v);
                }
                xs = inOrder;
            }
            return {
                key: g.key,
                color: g.color,
                points: [...xs.entries()].map(([x, value]) => ({ x: coords.get(x)!, value, size: none, color: none })),
            };
        })
        .filter(s => visible === undefined || visible.has(s.key));
}

// ---------------------------------------------------------------------------
// dimensions — the selectable breakdown dimensions for a config
// ---------------------------------------------------------------------------

export function sliceDimensions(config: ConfigLike): Array<{ fieldId: string; label: string }> {
    return config.breakdownFieldIds.map(fieldId => {
        const spec = config.fields.get(fieldId);
        const label = (spec?.value as { label?: string } | undefined)?.label ?? fieldId;
        return { fieldId, label };
    });
}

// ---------------------------------------------------------------------------
// fields — every filterable field + label + primitive kind (predicate builder)
// ---------------------------------------------------------------------------

export function sliceFields(config: ConfigLike): Array<{ fieldId: string; label: string; kind: string; hints: string[]; format: variant }> {
    // A `text` field is search-only: it has no operator set, so the predicate
    // builder never lists it.
    return [...config.fields.entries()].filter(([, spec]) => (spec as variant).type !== "text").map(([fieldId, spec]) => {
        const kind = (spec as variant).type;
        const payload = (spec as variant).value as { label?: string; format?: variant } | undefined;
        const label = payload?.label ?? fieldId;
        // Explicit autocomplete hints from `Slice.config` (#131); empty when none.
        const hints = [...(config.fieldHints?.get(fieldId) ?? [])];
        // Declared display format (#190); `none` when absent (incl. hand-built
        // test configs predating the field).
        const format = payload?.format ?? none;
        return { fieldId, label, kind, hints, format };
    });
}

// ---------------------------------------------------------------------------
// Platform registry — drop into platformFns to enable Slice.apply.*
// ---------------------------------------------------------------------------

/**
 * Pure JS implementation of `Slice.apply.matches`, `Slice.apply.where`,
 * and `Slice.apply.breakdownKey`, packaged as a `PlatformFunction[]`
 * array suitable for spreading into a `describeEast` `platformFns` option
 * alongside `TestImpl`.
 *
 * @example
 * ```ts
 * import { describeEast, TestImpl } from "@elaraai/east-node-std";
 * import { SliceApplyImpl } from "@elaraai/east-ui";
 *
 * describeEast("MySlice", (test) => { ... }, {
 *     platformFns: [...TestImpl, ...SliceApplyImpl],
 * });
 * ```
 */
import { Slice } from "./index.js";

export const SliceApplyImpl = [
    Slice.apply.matches.implement(
        (_T: unknown) =>
        (state: unknown, config: unknown, row: unknown): boolean =>
            sliceMatches(state as StateLike, config as ConfigLike, row as Record<string, unknown>, new Date()),
    ),
    Slice.apply.where.implement(
        (_T: unknown) =>
        (state: unknown, config: unknown, data: unknown): Array<Record<string, unknown>> => {
            const now = new Date();
            return (data as ReadonlyArray<Record<string, unknown>>).filter(row =>
                sliceMatches(state as StateLike, config as ConfigLike, row, now));
        },
    ),
    Slice.apply.breakdownKey.implement(
        (_T: unknown) =>
        (state: unknown, config: unknown, row: unknown): variant =>
            sliceBreakdownKey(state as StateLike, config as ConfigLike, row as Record<string, unknown>),
    ),
    Slice.apply.breakdown.implement(
        (_T: unknown) =>
        (state: unknown, config: unknown, data: unknown): Array<{ key: string; count: bigint }> =>
            sliceBreakdown(state as StateLike, config as ConfigLike, data as ReadonlyArray<Record<string, unknown>>, new Date()),
    ),
];
