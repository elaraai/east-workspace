/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Row assembly — the shared row envelope (gutter / drill / `makeRow`),
 * subtree normalization and re-parenting, the `.of` accessor override
 * channel, and the eager engines: span rollup bands (union / byStatus),
 * per-bucket heat aggregation and table subtotals.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    OptionType,
    StringType,
    some,
    none,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { ApprovalStateType, type ApprovalStateLiteral } from "../../contracts/approval.js";
import {
    PlanGutterType,
    PlanGutterSwatchType,
    PlanDrillType,
    PlanDrillPointType,
    PlanExpandAxisType,
    type PlanExpandAxisLiteral,
} from "./types.js";
import {
    PlanExpandType,
    PlanRowKindType,
    PlanRowType,
    type PlanRowsValue,
} from "./ir.js";
import { resolveTag, emptyRows } from "./builders.js";

// ============================================================================
// Row envelope — the shared base-input handling
// ============================================================================

/**
 * The drilled-row payload input — see `PlanDrillType`.
 *
 * @property lines - Identity lines
 * @property meter - Optional 0..1 meter fill
 * @property series - Optional level trace points
 * @property events - The named-event line entries
 * @property journey - Optional item key for the journey link
 */
export interface PlanDrillInput {
    /** Identity lines (`"120 t · FILL"`). */
    lines?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional 0..1 meter fill. */
    meter?: SubtypeExprOrValue<FloatType> | number;
    /** Optional level-trace points. */
    series?: SubtypeExprOrValue<ArrayType<PlanDrillPointType>>;
    /** The named-event line entries (`"TRANSFER W31 · −24 t"`). */
    events?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional item key — renders the `open item journey →` link. */
    journey?: SubtypeExprOrValue<StringType>;
}

/**
 * The gutter + row fields shared by every kind factory (flattened into each
 * factory's input bag).
 *
 * @property key - The row key (stable identity; parent keys reference it)
 * @property label - The gutter name
 * @property id - `true` ⇒ the label renders as a mono row id
 * @property sub - The muted mono sub line
 * @property value - The right-aligned mono value slot
 * @property meta - The group meta line
 * @property stacked - Two-line gutter layout
 * @property swatches - Chart-series legend chips
 * @property pinned - Pin the row above the virtualised body, under the ruler
 * @property height - Fixed row-height override (px)
 * @property status - The quiet gutter status dot
 * @property approval - The review verdict (review chrome only)
 * @property drill - The in-place drill expansion payload
 */
export interface PlanRowBaseInput {
    /** The row key (stable identity; parent keys reference it). */
    key: SubtypeExprOrValue<StringType>;
    /** The gutter name. */
    label: SubtypeExprOrValue<StringType>;
    /** `true` ⇒ the label renders as a mono row id (`L1-M03`, `COVERAGE`). */
    id?: SubtypeExprOrValue<BooleanType> | boolean;
    /** The muted mono sub line (`"120 t"`, `"week · 1 lane"`). */
    sub?: SubtypeExprOrValue<StringType>;
    /** The right-aligned mono value slot (`"94.2%"`). */
    value?: SubtypeExprOrValue<StringType>;
    /** The group meta line (`"8 rs · 82%"`). */
    meta?: SubtypeExprOrValue<StringType>;
    /** Two-line gutter layout (label over sub; row min-height 42px). */
    stacked?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Chart-series legend chips printed under the label. */
    swatches?: { color: SubtypeExprOrValue<StringType>; label: SubtypeExprOrValue<StringType> }[];
    /** Pin the row above the virtualised body, under the ruler. */
    pinned?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Fixed row-height override — a CSS px size (`"48px"`, the shared component-height type). */
    height?: SubtypeExprOrValue<StringType>;
    /** The quiet gutter status dot. */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** The review verdict (rendered only with the root's review chrome). */
    approval?: SubtypeExprOrValue<ApprovalStateType> | ApprovalStateLiteral;
    /** The in-place drill expansion payload. */
    drill?: PlanDrillInput;
    /** The expand-in-place developer render (R2) — see {@link PlanExpandInput}. */
    expand?: PlanExpandInput;
}

/** Build the gutter value from a base input. */
function buildGutter(base: PlanRowBaseInput): ExprType<PlanGutterType> {
    return East.value({
        label:    base.label,
        id:       base.id !== undefined ? some(base.id) : none,
        sub:      base.sub !== undefined ? some(base.sub) : none,
        value:    base.value !== undefined ? some(base.value) : none,
        meta:     base.meta !== undefined ? some(base.meta) : none,
        stacked:  base.stacked !== undefined ? some(base.stacked) : none,
        swatches: (base.swatches ?? []).map(s => East.value({ color: s.color, label: s.label }, PlanGutterSwatchType)),
    }, PlanGutterType);
}

/** Build the drill payload from its input. */
function buildDrill(drill: PlanDrillInput): ExprType<PlanDrillType> {
    return East.value({
        lines:   East.value(drill.lines ?? [], ArrayType(StringType)),
        meter:   drill.meter !== undefined ? some(drill.meter) : none,
        series:  drill.series !== undefined ? some(East.value(drill.series, ArrayType(PlanDrillPointType))) : none,
        events:  East.value(drill.events ?? [], ArrayType(StringType)),
        journey: drill.journey !== undefined ? some(drill.journey) : none,
    }, PlanDrillType);
}

/**
 * Builds one drill payload value — the in-place 96px expansion content. A
 * value builder like {@link Plan.run}: use it to put `PlanDrillType` values
 * IN data rows (`drill: some(Plan.drill({ … }))`), so drill presence is a
 * per-row data fact that flows through `Plan.span.of`'s `drill` accessor.
 *
 * @param input - The drill configuration ({@link PlanDrillInput})
 * @returns An East expression of {@link PlanDrillType}
 */
export function createDrill(input: PlanDrillInput): ExprType<PlanDrillType> {
    return buildDrill(input);
}

/**
 * The expand-in-place input (R2) — the developer render + its height and
 * axis treatment.
 *
 * @property render - The developer render — an `East.function([], UIComponentType)` building the mounted body from captured data / bind-handles
 * @property height - The expanded row height, a CSS px size (`"152px"` default; clamped to the canvas)
 * @property axis - How the shared grid + now-line run through the render (`"keep"` default / `"dim"` / `"off"`)
 */
export interface PlanExpandInput {
    /** The developer render — an `East.function([], UIComponentType)` building the mounted body from captured data / bind-handles. */
    render: SubtypeExprOrValue<FunctionType<[], UIComponentType>>;
    /** The expanded row height — a CSS px size (`"152px"` default; clamped to `canvas − strips − ruler`). */
    height?: SubtypeExprOrValue<StringType>;
    /** How the shared grid + now-line run through the render (default `"keep"`). */
    axis?: PlanExpandAxisLiteral | SubtypeExprOrValue<PlanExpandAxisType>;
}

/** Build the expand declaration from its input. */
function buildExpand(input: PlanExpandInput): ExprType<PlanExpandType> {
    return East.value({
        // Pin the exact function type (the `template.make` pattern) so the
        // `component.ts` arm's recursion-marker slot unifies.
        render: East.value(input.render, FunctionType([], UIComponentType)),
        height: input.height !== undefined ? some(input.height) : none,
        axis:   resolveTag(input.axis ?? "keep", PlanExpandAxisType),
    }, PlanExpandType);
}

/** Assemble one row from its base input + kind value, as a 1-row subtree. */
export function makeRow(base: PlanRowBaseInput, kind: ExprType<PlanRowKindType>): PlanRowsValue {
    const row = East.value({
        key:      base.key,
        parent:   none,
        gutter:   buildGutter(base),
        kind,
        pinned:   base.pinned !== undefined ? some(base.pinned) : none,
        height:   base.height !== undefined ? some(base.height) : none,
        status:   base.status !== undefined ? some(resolveTag(base.status, StatusValueType)) : none,
        approval: base.approval !== undefined ? some(resolveTag(base.approval, ApprovalStateType)) : none,
        drill:    base.drill !== undefined ? some(buildDrill(base.drill)) : none,
        expand:   base.expand !== undefined ? some(buildExpand(base.expand)) : none,
    }, PlanRowType);
    return East.value([row], ArrayType(PlanRowType));
}

/**
 * A nested-rows input — a single flattened-subtree expression (a factory /
 * `Plan.rows` result) or a TS array of them.
 */
export type PlanRowsInput =
    | SubtypeExprOrValue<ArrayType<PlanRowType>>
    | SubtypeExprOrValue<ArrayType<PlanRowType>>[];

/** Normalize a nested-rows input into one concatenated subtree expression. */
export function normalizeRows(input: PlanRowsInput | undefined): PlanRowsValue {
    if (input === undefined) return emptyRows();
    if (Array.isArray(input)) {
        return input.reduce<PlanRowsValue>(
            (acc, x) => acc.concat(East.value(x as SubtypeExprOrValue<ArrayType<PlanRowType>>, ArrayType(PlanRowType)) as PlanRowsValue) as PlanRowsValue,
            emptyRows(),
        );
    }
    return East.value(input as SubtypeExprOrValue<ArrayType<PlanRowType>>, ArrayType(PlanRowType)) as PlanRowsValue;
}

/** Re-parent the ROOTS of a flattened subtree (rows with `parent: none`). */
export function reparentRoots(rows: PlanRowsValue, parentKey: SubtypeExprOrValue<StringType>): PlanRowsValue {
    const parentOpt = East.value(some(parentKey), OptionType(StringType));
    return rows.map((_$, r) => East.value({
        key:      r.key,
        parent:   r.parent.hasTag("none").ifElse(() => parentOpt, () => r.parent),
        gutter:   r.gutter,
        kind:     r.kind,
        pinned:   r.pinned,
        height:   r.height,
        status:   r.status,
        approval: r.approval,
        drill:    r.drill,
        expand:   r.expand,
    }, PlanRowType)) as PlanRowsValue;
}

/** The subtree ROOTS of a flattened child array (rows with `parent: none`). */
export function rootsOf(rows: PlanRowsValue): PlanRowsValue {
    return rows.filter((_$, r) => r.parent.hasTag("none")) as PlanRowsValue;
}

/** The per-level group-parent constructor the grouping engine calls per group. */
export type PlanGroupParentFn =
    ExprType<FunctionType<[StringType, StringType, ArrayType<PlanRowType>], ArrayType<PlanRowType>>>;

/**
 * Builds the per-level group-parent constructor shared by every grouped form
 * (`Plan.rows` groups, `span.of` / `heat.of` / `table.of` parents) — one
 * reified East function `(pathKey, label, children) => subtree`: the parent
 * row (its `kind` fully declared by the caller) leads its re-parented
 * children. `meta` optionally builds the gutter meta line from the
 * pre-reparent children (e.g. the `"8 rs"` member count).
 */
export function groupParentFn(
    kind: ExprType<PlanRowKindType>,
    meta?: (
        $: BlockBuilder<ArrayType<PlanRowType>>,
        children: ExprType<ArrayType<PlanRowType>>,
    ) => SubtypeExprOrValue<OptionType<StringType>>,
): PlanGroupParentFn {
    return East.function(
        [StringType, StringType, ArrayType(PlanRowType)],
        ArrayType(PlanRowType),
        ($, pathKey, label, children) => {
            const reparented = $.let(reparentRoots(children as PlanRowsValue, pathKey), ArrayType(PlanRowType));
            const metaValue = meta !== undefined ? meta($, children) : none;
            const metaOpt = $.const(metaValue, OptionType(StringType));
            const parent = $.const({
                key:    pathKey,
                parent: none,
                gutter: {
                    label, id: none, sub: none, value: none,
                    meta: metaOpt,
                    stacked: none, swatches: [],
                },
                kind,
                pinned: none, height: none, status: none, approval: none, drill: none, expand: none,
            }, PlanRowType);
            const out = $.const([parent], ArrayType(PlanRowType));
            return out.concat(reparented);
        },
    );
}

/**
 * Per-row `Option` fields the `.of` accessor forms inject — the expression
 * channel for the row envelope. Accessors return the fields' actual IR types
 * (`Option<…>`), so presence is a per-row data fact; the host config bag
 * never carries expressions of options.
 */
interface PlanRowOverrides {
    sub?: SubtypeExprOrValue<OptionType<StringType>>;
    value?: SubtypeExprOrValue<OptionType<StringType>>;
    status?: SubtypeExprOrValue<OptionType<StatusValueType>>;
    drill?: SubtypeExprOrValue<OptionType<PlanDrillType>>;
    expand?: SubtypeExprOrValue<OptionType<PlanExpandType>>;
}

/** Rebuild a 1-row subtree with accessor-supplied `Option` envelope fields. */
export function applyRowOverrides(rows: PlanRowsValue, o: PlanRowOverrides): PlanRowsValue {
    if (o.sub === undefined && o.value === undefined && o.status === undefined
        && o.drill === undefined && o.expand === undefined) return rows;
    const sub    = o.sub    !== undefined ? East.value(o.sub, OptionType(StringType)) : undefined;
    const value  = o.value  !== undefined ? East.value(o.value, OptionType(StringType)) : undefined;
    const status = o.status !== undefined ? East.value(o.status, OptionType(StatusValueType)) : undefined;
    const drill  = o.drill  !== undefined ? East.value(o.drill, OptionType(PlanDrillType)) : undefined;
    const expand = o.expand !== undefined ? East.value(o.expand, OptionType(PlanExpandType)) : undefined;
    return rows.map((_$, r) => East.value({
        key:    r.key,
        parent: r.parent,
        gutter: East.value({
            label:    r.gutter.label,
            id:       r.gutter.id,
            sub:      sub ?? r.gutter.sub,
            value:    value ?? r.gutter.value,
            meta:     r.gutter.meta,
            stacked:  r.gutter.stacked,
            swatches: r.gutter.swatches,
        }, PlanGutterType),
        kind:     r.kind,
        pinned:   r.pinned,
        height:   r.height,
        status:   status ?? r.status,
        approval: r.approval,
        drill:    drill ?? r.drill,
        expand:   expand ?? r.expand,
    }, PlanRowType)) as PlanRowsValue;
}

/**
 * Assemble a nesting parent — the parent row (its kind fully declared; the
 * renderer computes any derived numbers) leads its re-parented children in
 * the flattened result.
 */
export function assembleNested(
    base: PlanRowBaseInput,
    rows: PlanRowsInput,
    kind: ExprType<PlanRowKindType>,
): PlanRowsValue {
    const children = normalizeRows(rows);
    const parent = East.value({
        key:      base.key,
        parent:   none,
        gutter:   buildGutter(base),
        kind,
        pinned:   base.pinned !== undefined ? some(base.pinned) : none,
        height:   base.height !== undefined ? some(base.height) : none,
        status:   base.status !== undefined ? some(resolveTag(base.status, StatusValueType)) : none,
        approval: base.approval !== undefined ? some(resolveTag(base.approval, ApprovalStateType)) : none,
        drill:    base.drill !== undefined ? some(buildDrill(base.drill)) : none,
        expand:   base.expand !== undefined ? some(buildExpand(base.expand)) : none,
    }, PlanRowType);
    return East.value([parent], ArrayType(PlanRowType)).concat(reparentRoots(children, base.key)) as PlanRowsValue;
}
