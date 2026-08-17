/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Row assembly — the shared row envelope (gutter / drill / `makeRow`),
 * subtree normalization and re-parenting, the `.of` accessor override
 * channel, and the group-parent constructor every grouped form shares.
 *
 * Subtrees are KEYED collections (`Dict<String, PlanRow>`), so composition is
 * `union` with an explicit conflict policy rather than `concat`: every step
 * states what happens on a collision instead of one resolver at the end
 * absorbing all of them, and a row can no longer appear twice (#568).
 *
 * @packageDocumentation
 */

import {
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

import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { ApprovalStateType, type ApprovalStateLiteral } from "../../contracts/approval.js";
import {
    PlanGutterType,
    PlanGutterSwatchType,
    PlanDrillType,
    PlanDrillPointType,
    PlanExpandAxisType,
    type PlanExpandAxisLiteral,
    PlanExpandType,
    PlanRowKindType,
    PlanRowType,
    PlanRowsCollectionType,
    type PlanRowsValue,
} from "./types.js";
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
    /** The expand-in-place declaration (R2) — see {@link PlanExpandInput}; the render is the root's `expandRender`. */
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
 * The expand-in-place input (R2) — a pure-data declaration: presence marks
 * the row expandable; the mounted body is the ROOT's `expandRender`
 * resolver, called with the row ref when the control fires.
 *
 * @property height - The developer region's minimum height, a CSS px size (renderer default when omitted)
 * @property axis - How the shared grid + now-line run through the focused row's plot (`"keep"` default / `"dim"` / `"off"`)
 */
export interface PlanExpandInput {
    /** The developer region's minimum height — a CSS px size (`"152px"`; renderer default when omitted). */
    height?: SubtypeExprOrValue<StringType>;
    /** How the shared grid + now-line run through the focused row's plot (default `"keep"`). */
    axis?: PlanExpandAxisLiteral | SubtypeExprOrValue<PlanExpandAxisType>;
}

/** Build the expand declaration from its input. */
function buildExpand(input: PlanExpandInput): ExprType<PlanExpandType> {
    return East.value({
        height: input.height !== undefined ? some(input.height) : none,
        axis:   resolveTag(input.axis ?? "keep", PlanExpandAxisType),
    }, PlanExpandType);
}

/**
 * Row composition is LAST WINS — a later copy of a synthesized row (a group
 * parent a second paged window re-emits) replaces the earlier one. Declared
 * once and passed to every `union`, so the policy is stated at each step
 * rather than assumed.
 */
export const LAST_WINS = East.function(
    [PlanRowType, PlanRowType, StringType], PlanRowType,
    (_$, _existing, incoming) => incoming);

/** Assemble one row from its base input + kind value, as a 1-row subtree.
 *  Keying it HERE is where uniqueness becomes structural: a factory cannot
 *  emit two rows under one key. */
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
    return East.value(new Map([[base.key, row]]), PlanRowsCollectionType);
}

/**
 * A nested-rows input — a single flattened-subtree expression (a factory /
 * `Plan.rows` result) or a TS array of them.
 */
export type PlanRowsInput =
    | SubtypeExprOrValue<PlanRowsCollectionType>
    | SubtypeExprOrValue<PlanRowsCollectionType>[];

/** Normalize a nested-rows input into ONE subtree — the authored siblings
 *  unioned, last wins on a repeated key. */
export function normalizeRows(input: PlanRowsInput | undefined): PlanRowsValue {
    if (input === undefined) return emptyRows();
    if (Array.isArray(input)) {
        return input.reduce<PlanRowsValue>(
            (acc, x) => acc.union(
                East.value(x as SubtypeExprOrValue<PlanRowsCollectionType>, PlanRowsCollectionType),
                LAST_WINS) as PlanRowsValue,
            emptyRows(),
        );
    }
    return East.value(input as SubtypeExprOrValue<PlanRowsCollectionType>, PlanRowsCollectionType) as PlanRowsValue;
}

/** Re-parent the ROOTS of a subtree (rows with `parent: none`). Values only —
 *  re-parenting never renames a row, so the keys are untouched and any
 *  author-written `links` / grandchild `parent` refs keep pointing. */
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

/** The subtree ROOTS of a child collection (rows with `parent: none`). */
export function rootsOf(rows: PlanRowsValue): PlanRowsValue {
    return rows.filter((_$, r) => r.parent.hasTag("none")) as PlanRowsValue;
}

/** The per-level group-parent constructor the grouping engine calls per group. */
export type PlanGroupParentFn =
    ExprType<FunctionType<[StringType, StringType, PlanRowsCollectionType], PlanRowsCollectionType>>;

/**
 * Builds the per-level group-parent constructor shared by every grouped form
 * — one reified East function `(pathKey, label, children) => subtree`: the
 * parent row (its `kind` fully declared by the caller) joined with its
 * re-parented children in one keyed collection.
 *
 * @remarks
 * The parent's POSITION is no longer load-bearing — its key orders it, and the
 * renderer walks the tree from the roots. `meta` is a CONSTANT gutter meta line
 * (the `.of` aggregate tag); anything derived from the members — the `"8 rs"`
 * count — is computed renderer-side, because a parent synthesized per paged
 * window would otherwise bake THAT window's count into the row (#568).
 *
 * @param kind - The parent row's fully-declared kind
 * @param meta - Optional constant gutter meta line
 * @returns The reified `(pathKey, label, children) => subtree` function
 */
export function groupParentFn(
    kind: ExprType<PlanRowKindType>,
    meta?: SubtypeExprOrValue<OptionType<StringType>>,
): PlanGroupParentFn {
    return East.function(
        [StringType, StringType, PlanRowsCollectionType],
        PlanRowsCollectionType,
        ($, pathKey, label, children) => {
            const reparented = $.let(reparentRoots(children as PlanRowsValue, pathKey), PlanRowsCollectionType);
            const metaOpt = $.const(meta ?? none, OptionType(StringType));
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
            const out = $.let(new Map([[pathKey, parent]]), PlanRowsCollectionType);
            $(out.unionInPlace(reparented, LAST_WINS));
            return out;
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
    approval?: SubtypeExprOrValue<OptionType<ApprovalStateType>>;
    drill?: SubtypeExprOrValue<OptionType<PlanDrillType>>;
    expand?: SubtypeExprOrValue<OptionType<PlanExpandType>>;
    pinned?: SubtypeExprOrValue<OptionType<BooleanType>>;
}

/** Rebuild a 1-row subtree with accessor-supplied `Option` envelope fields. */
export function applyRowOverrides(rows: PlanRowsValue, o: PlanRowOverrides): PlanRowsValue {
    if (o.sub === undefined && o.value === undefined && o.status === undefined
        && o.approval === undefined
        && o.drill === undefined && o.expand === undefined && o.pinned === undefined) return rows;
    const sub    = o.sub    !== undefined ? East.value(o.sub, OptionType(StringType)) : undefined;
    const value  = o.value  !== undefined ? East.value(o.value, OptionType(StringType)) : undefined;
    const status = o.status !== undefined ? East.value(o.status, OptionType(StatusValueType)) : undefined;
    const approval = o.approval !== undefined ? East.value(o.approval, OptionType(ApprovalStateType)) : undefined;
    const drill  = o.drill  !== undefined ? East.value(o.drill, OptionType(PlanDrillType)) : undefined;
    const expand = o.expand !== undefined ? East.value(o.expand, OptionType(PlanExpandType)) : undefined;
    const pinned = o.pinned !== undefined ? East.value(o.pinned, OptionType(BooleanType)) : undefined;
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
        pinned:   pinned ?? r.pinned,
        height:   r.height,
        status:   status ?? r.status,
        approval: approval ?? r.approval,
        drill:    drill ?? r.drill,
        expand:   expand ?? r.expand,
    }, PlanRowType)) as PlanRowsValue;
}

/**
 * Assemble a nesting parent — the parent row (its kind fully declared; the
 * renderer computes any derived numbers) joined with its re-parented children
 * in one keyed collection.
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
    return East.value(new Map([[base.key, parent]]), PlanRowsCollectionType)
        .union(reparentRoots(children, base.key), LAST_WINS) as PlanRowsValue;
}
