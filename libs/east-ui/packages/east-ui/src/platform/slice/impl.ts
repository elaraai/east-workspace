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
    equalFor, lessFor, lessEqualFor, greaterFor, greaterEqualFor,
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

function matchStringOp(op: variant, value: unknown): boolean {
    const v = String(value);
    switch (op.type) {
        case "eq":       return eqString(v, op.value as string);
        case "neq":      return !eqString(v, op.value as string);
        case "in":       return (op.value as Set<string>).has(v);
        case "notIn":    return !(op.value as Set<string>).has(v);
        case "contains": return v.includes(op.value as string);
        case "matches":  return new RegExp(op.value as string).test(v);
        default: throw new Error(`unknown string op: ${op.type}`);
    }
}

function matchIntegerOp(op: variant, value: unknown): boolean {
    const v = BigInt(value as bigint | number | string);
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
    const v = Number(value);
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
    const v = value instanceof Date ? value : new Date(value as string | number);
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
    return eqBoolean(Boolean(value), op.value as boolean);
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

function rangeMatches(range: variant, value: unknown, now: Date): boolean {
    switch (range.type) {
        case "datetimePreset": {
            const { from, to } = resolveDateTimePreset(range.value as variant, now);
            const v = value instanceof Date ? value : new Date(value as string | number);
            return lteDateTime(from, v) && lteDateTime(v, to);
        }
        case "datetime": {
            const { from, to } = range.value as { from: Date; to: Date };
            const v = value instanceof Date ? value : new Date(value as string | number);
            return lteDateTime(from, v) && lteDateTime(v, to);
        }
        case "integer": {
            const { from, to } = range.value as { from: bigint; to: bigint };
            const v = BigInt(value as bigint | number | string);
            return lteInteger(from, v) && lteInteger(v, to);
        }
        case "float": {
            const { from, to } = range.value as { from: number; to: number };
            const v = Number(value);
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
    // Search — case-insensitive substring across any configured string search field
    if (state.search.type === "some") {
        const q = (state.search.value as string).toLowerCase();
        const any = config.searchFieldIds.some(id => {
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

function sliceBreakdownKey(state: StateLike, _config: ConfigLike, row: Record<string, unknown>): variant {
    if (state.breakdown.type !== "some") return none;
    const { fieldId } = state.breakdown.value as { fieldId: string };
    return some(String(row[fieldId]));
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
        const key = String(row[bd.fieldId]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const limit = bd.limit.type === "some" ? Number(bd.limit.value as bigint) : undefined;
    if (limit !== undefined && sorted.length > limit) {
        const top = sorted.slice(0, limit);
        const other = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);
        return [
            ...top.map(([key, n], i) => ({ key, count: BigInt(n), color: seriesColor(i) })),
            { key: "other", count: BigInt(other), color: "{colors.gray.400}" },
        ];
    }
    return sorted.map(([key, n], i) => ({ key, count: BigInt(n), color: seriesColor(i) }));
}

// ---------------------------------------------------------------------------
// series — pivot narrowed data into coloured multi-series long format. Groups
// by the active breakdown dimension (colour by the same group order as
// `sliceBreakdown`), aggregates `valueField` per x in data order.
// ---------------------------------------------------------------------------

export function sliceSeries(
    state: StateLike,
    config: ConfigLike,
    data: ReadonlyArray<Record<string, unknown>>,
    xField: string,
    valueField: string,
    now: Date,
): Array<{ key: string; color: string; points: Array<{ x: variant; value: number; size: typeof none }> }> {
    // x key — ISO-encode Dates so a renderer time scale can parse them back; all
    // other field kinds stringify (band categories / numeric linear).
    const xKey = (row: Record<string, unknown>): string => { const xv = row[xField]; return xv instanceof Date ? xv.toISOString() : String(xv); };
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
        return [{ key: label, color: seriesColor(0), points: [...xs.entries()].map(([x, value]) => ({ x: coords.get(x)!, value, size: none })) }];
    }
    const keyField = (state.breakdown.value as { fieldId: string }).fieldId;
    const counts = new Map<string, number>();
    // key → (x → summed value); both Maps preserve insertion (data) order.
    const byKey = new Map<string, Map<string, number>>();
    for (const row of data) {
        if (!sliceMatches(state, config, row, now)) continue;
        const key = String(row[keyField]);
        const xk = xKey(row);
        if (!coords.has(xk)) coords.set(xk, xCoord(row));
        const v = Number(row[valueField] ?? 0);
        counts.set(key, (counts.get(key) ?? 0) + 1);
        let xs = byKey.get(key);
        if (xs === undefined) { xs = new Map(); byKey.set(key, xs); }
        xs.set(xk, (xs.get(xk) ?? 0) + v);
    }
    // Colour order matches sliceBreakdown: by count desc. Colour is assigned over
    // the FULL group order (so a series keeps its legend colour even when others
    // are hidden), then series toggled off via the legend (`state.visible`) drop.
    const ordered = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!);
    const visible = state.visible.type === "some" ? (state.visible.value as Set<string>) : undefined;
    return ordered
        .map((key, i) => ({
            key,
            color: seriesColor(i),
            points: [...byKey.get(key)!.entries()].map(([x, value]) => ({ x: coords.get(x)!, value, size: none })),
        }))
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

export function sliceFields(config: ConfigLike): Array<{ fieldId: string; label: string; kind: string }> {
    return [...config.fields.entries()].map(([fieldId, spec]) => {
        const kind = (spec as variant).type;
        const label = ((spec as variant).value as { label?: string } | undefined)?.label ?? fieldId;
        return { fieldId, label, kind };
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
