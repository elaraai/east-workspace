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
 * draws) can compose against typed accessors when needed.
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
    equalFor, lessFor, lessEqualFor, greaterFor, greaterEqualFor, isValueOf,
    StringType, IntegerType, FloatType, DateTimeType, BooleanType,
} from "@elaraai/east";

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

interface PredicateBody {
    readonly fieldId: string;
    readonly op: variant;
}

// Each matcher VALIDATES the row value against the predicate family's East type
// (`isValueOf`) before comparing, then uses the already-correct JS value — never
// a blind `String()`/`BigInt()`/`new Date()` coercion. A value that isn't of the
// field's type (a kind-mismatched predicate, or the field absent from the row)
// can't satisfy the predicate → it returns `false` (excludes the row) instead of
// crashing (`BigInt(3.5)`, `new Date(7n)`) or mis-coercing (`String(undefined)`
// → "undefined"). The comparators still come from East's `comparison.ts`.

function matchStringOp(op: variant, value: unknown): boolean {
    if (!isValueOf(value, StringType)) return false;
    const v = value as string;
    switch (op.type) {
        case "eq":       return eqString(v, op.value as string);
        case "neq":      return !eqString(v, op.value as string);
        case "in":       return (op.value as Set<string>).has(v);
        case "notIn":    return !(op.value as Set<string>).has(v);
        case "contains": return v.includes(op.value as string);
        // A half-typed regex in a live filter must narrow to nothing, not crash.
        case "matches":  { try { return new RegExp(op.value as string).test(v); } catch { return false; } }
        default: throw new Error(`unknown string op: ${op.type}`);
    }
}

function matchIntegerOp(op: variant, value: unknown): boolean {
    if (!isValueOf(value, IntegerType)) return false;
    const v = value as bigint;
    switch (op.type) {
        case "eq":  return  eqInteger(v, op.value as bigint);
        case "neq": return !eqInteger(v, op.value as bigint);
        case "lt":  return  ltInteger(v, op.value as bigint);
        case "lte": return lteInteger(v, op.value as bigint);
        case "gt":  return  gtInteger(v, op.value as bigint);
        case "gte": return gteInteger(v, op.value as bigint);
        case "in":  return (op.value as Set<bigint>).has(v);
        default: throw new Error(`unknown integer op: ${op.type}`);
    }
}

function matchFloatOp(op: variant, value: unknown): boolean {
    if (!isValueOf(value, FloatType)) return false;
    const v = value as number;
    const d = op.value as number;
    switch (op.type) {
        case "lt":  return  ltFloat(v, d);
        case "lte": return lteFloat(v, d);
        case "gt":  return  gtFloat(v, d);
        case "gte": return gteFloat(v, d);
        default: throw new Error(`unknown float op: ${op.type}`);
    }
}

function matchDateTimeOp(op: variant, value: unknown): boolean {
    if (!isValueOf(value, DateTimeType)) return false;
    const v = value as Date;
    switch (op.type) {
        case "before": return ltDateTime(v, op.value as Date);
        case "after":  return gtDateTime(v, op.value as Date);
        case "between": {
            const { from, to } = op.value as { from: Date; to: Date };
            return lteDateTime(from, v) && lteDateTime(v, to);
        }
        default: throw new Error(`unknown datetime op: ${op.type}`);
    }
}

function matchBooleanOp(op: variant, value: unknown): boolean {
    if (op.type !== "is") throw new Error(`unknown boolean op: ${op.type}`);
    if (!isValueOf(value, BooleanType)) return false;
    return eqBoolean(value as boolean, op.value as boolean);
}

function predicateMatches(pred: variant, row: Record<string, unknown>): boolean {
    const body = pred.value as PredicateBody;
    const fieldValue = row[body.fieldId];
    switch (pred.type) {
        case "string":   return matchStringOp(body.op, fieldValue);
        case "integer":  return matchIntegerOp(body.op, fieldValue);
        case "float":    return matchFloatOp(body.op, fieldValue);
        case "datetime": return matchDateTimeOp(body.op, fieldValue);
        case "boolean":  return matchBooleanOp(body.op, fieldValue);
        default: throw new Error(`unknown predicate family: ${pred.type}`);
    }
}

// ---------------------------------------------------------------------------
// Range — datetimePreset / datetime / integer / float
// ---------------------------------------------------------------------------

function resolveDateTimePreset(preset: variant, now: Date): { from: Date; to: Date } {
    const to = now;
    const from = new Date(now);
    switch (preset.type) {
        case "today":   from.setHours(0, 0, 0, 0); return { from, to };
        case "last7d":  from.setDate(from.getDate() - 7);  return { from, to };
        case "last30d": from.setDate(from.getDate() - 30); return { from, to };
        case "last90d": from.setDate(from.getDate() - 90); return { from, to };
        case "ytd":     return { from: new Date(now.getFullYear(), 0, 1), to };
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
    readonly filters: ReadonlyArray<variant>;
}

interface StateLike {
    readonly range: variant;
    readonly filters: ReadonlyArray<variant>;
    readonly cohorts: ReadonlyArray<CohortLike>;
    readonly activeCohorts: Set<string>;
    readonly breakdown: variant;
    readonly search: variant;
    readonly visible: variant;
    readonly selectedIndex: variant;
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
        if (!predicateMatches(f, row)) return false;
    }
    // Active cohorts — each cohort's filters AND-ed into the chain
    for (const cohortId of state.activeCohorts) {
        const cohort = state.cohorts.find(c => eqString(c.id, cohortId));
        if (!cohort) continue;
        for (const f of cohort.filters) {
            if (!predicateMatches(f, row)) return false;
        }
    }
    // Search — case-insensitive substring across the searchable string fields.
    // Resolve them the SAME way the suggestion projection (autoDeriveMatches) does:
    // the configured `searchFieldIds` that are string-typed, else fall back to
    // every string field. Otherwise a `searchFieldIds` that names only non-string
    // fields would make the search exclude every row while the dropdown still
    // offers (fallback) suggestions — a silent dead filter (#129 bug-hunt).
    if (state.search.type === "some") {
        const q = (state.search.value as string).toLowerCase();
        const configured = config.searchFieldIds.filter(id => config.fields.get(id)?.type === "string");
        const searchable = configured.length > 0
            ? configured
            : [...config.fields].filter(([, spec]) => (spec as variant).type === "string").map(([id]) => id);
        const any = searchable.some(id => {
            const v = row[id];
            return typeof v === "string" && v.toLowerCase().includes(q);
        });
        if (!any) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// breakdownKey — stringified row value at the active breakdown's field
// ---------------------------------------------------------------------------

/** Stable, locale/timezone-independent group key for a row value — Dates encode
 *  as ISO (matching `sliceSeries`' `xKey`) so a `visible` whitelist captured under
 *  one timezone still matches the same instant under another (#120 bug-hunt). */
function breakdownKeyOf(value: unknown): string {
    return value instanceof Date ? value.toISOString() : String(value);
}

function sliceBreakdownKey(state: StateLike, _config: ConfigLike, row: Record<string, unknown>): variant {
    if (state.breakdown.type !== "some") return none;
    const { fieldId } = state.breakdown.value as { fieldId: string };
    return some(breakdownKeyOf(row[fieldId]));
}

// ---------------------------------------------------------------------------
// Series palette — the canonical breakdown swatch colours, assigned by group
// order. Opaque theme-token strings (the renderer resolves them); held here so
// the pure engine can colour groups + series identically (one source of truth
// shared by Slice.Legend and Slice.Chart).
// ---------------------------------------------------------------------------

export const SLICE_SERIES_PALETTE: readonly string[] = [
    "{colors.brand.600}",
    "{colors.brand.800}",
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
        const key = breakdownKeyOf(row[bd.fieldId]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orderedGroups(counts, bd.limit).map(g => ({ key: g.key, count: BigInt(g.count), color: g.color }));
}

// ---------------------------------------------------------------------------
// series — pivot narrowed data into coloured multi-series long format. Groups
// by the active breakdown dimension with the SAME group identity (stable
// breakdownKeyOf keys), order, colours, and top-N `other` roll-up as
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
    // x key — same stable encoding as breakdown group keys (ISO for Dates) so a
    // renderer time scale can parse them back; other kinds stringify.
    const xKey = (row: Record<string, unknown>): string => breakdownKeyOf(row[xField]);
    // Typed x coordinate (band category / linear number / time date) for the
    // chart's ChartXType; the renderer derives the scale from the arm. Keyed by
    // xKey so points aggregate per x while keeping the original typed value.
    const xCoord = (row: Record<string, unknown>): variant => {
        const xv = row[xField];
        if (xv instanceof Date) return variant("time", xv);
        if (typeof xv === "number" || typeof xv === "bigint") return variant("number", Number(xv));
        return variant("category", String(xv));
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
    // group key uses breakdownKeyOf — the SAME stable encoding sliceBreakdown
    // uses (ISO for Dates) — so the legend's `visible` whitelist (which stores
    // group keys) actually matches the series keys (#162).
    const byKey = new Map<string, Map<string, number>>();
    for (const row of data) {
        if (!sliceMatches(state, config, row, now)) continue;
        const key = breakdownKeyOf(row[bd.fieldId]);
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

export function sliceFields(config: ConfigLike): Array<{ fieldId: string; label: string; kind: string; hints: string[] }> {
    return [...config.fields.entries()].map(([fieldId, spec]) => {
        const kind = (spec as variant).type;
        const label = ((spec as variant).value as { label?: string } | undefined)?.label ?? fieldId;
        // Explicit autocomplete hints from `Slice.config` (#131); empty when none.
        const hints = [...(config.fieldHints?.get(fieldId) ?? [])];
        return { fieldId, label, kind, hints };
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
