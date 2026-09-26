/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Row assembly (#822) — the ONE row envelope every canvas row is built by
 * ({@link planRow}), the gutter and expand values, the row streams the kind
 * factories return, and the re-basing that places a hand-built stream under a
 * series.
 *
 * Rows are an ordered stream (`Array<PlanRow>`) with typed ids
 * ({@link PlanRowIdType}). A kind factory's rows carry PROVISIONAL ids — an
 * `entry` with no series yet (`series: ""`) whose path is the factory `key`s
 * that lead to the row — and `Plan.series.rows` names the series and places
 * them ({@link REBASE_ROWS}).
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    East,
    ArrayType,
    BooleanType,
    OptionType,
    StringType,
    variant,
    some,
    none,
} from "@elaraai/east";

import { StatusValueType, type StatusValueLiteral } from "../../feedback/status/types.js";
import { ApprovalStateType, type ApprovalStateLiteral } from "../../contracts/approval.js";
import {
    PlanGutterType,
    PlanGutterSwatchType,
    PlanExpandAxisType,
    type PlanExpandAxisLiteral,
    PlanExpandType,
    PlanRowIdType,
    PlanRowKindType,
    PlanRowType,
    type PlanRowEditsType,
    PlanRowsCollectionType,
    type PlanRowsValue,
    type PlanAxisKindLiteral,
} from "./types.js";
import { resolveTag } from "./builders.js";

// ============================================================================
// The envelope — every row is built here
// ============================================================================

/**
 * Every field of a row, each given ONCE — the input of {@link planRow}.
 *
 * @remarks
 * The optional `Option` fields are the row's `Option`s themselves (an
 * accessor's result is a per-row data fact, so presence is too); omitted ⇒
 * `none`. The two flags default to `false` (#824).
 */
export interface PlanRowFields {
    /** The row's id. */
    id: SubtypeExprOrValue<PlanRowIdType>;
    /** The id of the row it nests under (`none` at the top of a stream). */
    parent: SubtypeExprOrValue<OptionType<PlanRowIdType>>;
    /** The gutter identity. */
    gutter: SubtypeExprOrValue<PlanGutterType>;
    /** The row kind. */
    kind: SubtypeExprOrValue<PlanRowKindType>;
    /** Initial collapse of a row with children (default `false`). */
    collapsed?: SubtypeExprOrValue<BooleanType>;
    /** Pin above the virtualised body (default `false`). */
    pinned?: SubtypeExprOrValue<BooleanType>;
    /** Fixed row-height override (CSS px). */
    height?: SubtypeExprOrValue<OptionType<StringType>>;
    /** The gutter status dot. */
    status?: SubtypeExprOrValue<OptionType<StatusValueType>>;
    /** The review verdict. */
    approval?: SubtypeExprOrValue<OptionType<ApprovalStateType>>;
    /** The expand-in-place declaration. */
    expand?: SubtypeExprOrValue<OptionType<PlanExpandType>>;
    /** The gestures the row takes (#880) — none by default. */
    edits?: SubtypeExprOrValue<PlanRowEditsType>;
}

/** A row that takes no gesture — every row but an editable series' (#880, #825). */
const NO_EDITS = { verdict: false, drop: false, move: none };

/**
 * THE row envelope (#822) — an entry's row, a derived parent, a section header,
 * a hand-built row and a re-based one are all built by this one constructor, so
 * the row's fields are spelled in exactly one place.
 *
 * @remarks
 * Each field expression appears once in the value it builds. A caller that
 * needs a value in two fields (an id that is also a child's parent) binds it
 * first — East has no common-subexpression elimination, so a spliced
 * expression is evaluated at every use.
 *
 * @param f - The row's fields ({@link PlanRowFields})
 * @returns The row
 */
export function planRow(f: PlanRowFields): ExprType<PlanRowType> {
    return East.value({
        id:        f.id,
        parent:    f.parent,
        gutter:    f.gutter,
        kind:      f.kind,
        collapsed: f.collapsed ?? false,
        pinned:    f.pinned ?? false,
        height:    f.height ?? none,
        status:    f.status ?? none,
        approval:  f.approval ?? none,
        expand:    f.expand ?? none,
        edits:     f.edits ?? NO_EDITS,
    }, PlanRowType);
}

/**
 * The gutter's fields — the label, and the `Option`s a series reads per entry.
 *
 * @property label - The row name
 * @property id - Render the label as a mono row id
 * @property sub - The muted sub line
 * @property value - The right-aligned value slot
 * @property meta - The group meta line
 * @property stacked - Two-line layout
 * @property swatches - Chart legend chips
 */
export interface PlanGutterFields {
    /** The row name. */
    label: SubtypeExprOrValue<StringType>;
    /** Render the label as a mono row id. */
    id?: SubtypeExprOrValue<BooleanType> | boolean;
    /** The muted sub line — the field's `Option`. */
    sub?: SubtypeExprOrValue<OptionType<StringType>>;
    /** The right-aligned value slot — the field's `Option`. */
    value?: SubtypeExprOrValue<OptionType<StringType>>;
    /** The group meta line — the field's `Option`. */
    meta?: SubtypeExprOrValue<OptionType<StringType>>;
    /** Two-line layout (label over sub). */
    stacked?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Chart legend chips. */
    swatches?: { color: SubtypeExprOrValue<StringType>; label: SubtypeExprOrValue<StringType> }[];
}

/**
 * Build a gutter value.
 *
 * @param f - The gutter's fields ({@link PlanGutterFields})
 * @returns The gutter
 */
export function planGutter(f: PlanGutterFields): ExprType<PlanGutterType> {
    return East.value({
        label:    f.label,
        id:       f.id ?? false,
        sub:      f.sub ?? none,
        value:    f.value ?? none,
        meta:     f.meta ?? none,
        stacked:  f.stacked ?? false,
        swatches: (f.swatches ?? []).map(s => East.value({ color: s.color, label: s.label }, PlanGutterSwatchType)),
    }, PlanGutterType);
}

// ============================================================================
// Row base input — what a hand-built row is written with
// ============================================================================

/**
 * The gutter + row fields shared by every kind factory (flattened into each
 * factory's input bag).
 *
 * @property key - The row's key — its path segment (a nested row's path is its parents' keys, then its own)
 * @property label - The gutter name
 * @property id - `true` ⇒ the label renders as a mono row id
 * @property sub - The muted mono sub line
 * @property value - The right-aligned mono value slot
 * @property meta - The group meta line
 * @property stacked - Two-line gutter layout
 * @property swatches - Chart-series legend chips
 * @property collapsed - Initial collapse of a row with nested `rows`
 * @property pinned - Pin the row above the virtualised body, under the ruler
 * @property height - Fixed row-height override (px)
 * @property status - The quiet gutter status dot
 * @property approval - The review verdict (review chrome only)
 * @property expand - The expand-in-place declaration
 */
export interface PlanRowBaseInput {
    /** The row's key — its path segment. Keys must be unique among a row's siblings. */
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
    /** Initial collapse of a row with nested `rows` (renderer state thereafter). */
    collapsed?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Pin the row above the virtualised body, under the ruler. */
    pinned?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Fixed row-height override — a CSS px size (`"48px"`, the shared component-height type). */
    height?: SubtypeExprOrValue<StringType>;
    /** The quiet gutter status dot. */
    status?: SubtypeExprOrValue<StatusValueType> | StatusValueLiteral;
    /** The review verdict (rendered only with the root's review chrome). */
    approval?: SubtypeExprOrValue<ApprovalStateType> | ApprovalStateLiteral;
    /** The expand-in-place declaration (R2) — see {@link PlanExpandInput}; the render is the root's `expandRender`. */
    expand?: PlanExpandInput;
}

/**
 * The expand-in-place input (R2) — a pure-data declaration: presence marks
 * the row expandable; the mounted body is the ROOT's `expandRender`
 * resolver, called with the row's id when the control fires.
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

/** A hand-built row's gutter, from its base input's plain fields. */
function baseGutter(base: PlanRowBaseInput): ExprType<PlanGutterType> {
    return planGutter({
        label: base.label,
        ...(base.id !== undefined ? { id: base.id } : {}),
        ...(base.sub !== undefined ? { sub: some(base.sub) } : {}),
        ...(base.value !== undefined ? { value: some(base.value) } : {}),
        ...(base.meta !== undefined ? { meta: some(base.meta) } : {}),
        ...(base.stacked !== undefined ? { stacked: base.stacked } : {}),
        ...(base.swatches !== undefined ? { swatches: base.swatches } : {}),
    });
}

/**
 * A hand-built row's PROVISIONAL id — an `entry` with no series yet, at its
 * own key. `Plan.series.rows` names its series and places it
 * ({@link REBASE_ROWS}); a factory nesting it prefixes its own key.
 */
function literalId(key: SubtypeExprOrValue<StringType>): ExprType<PlanRowIdType> {
    return East.value(variant("entry", { series: "", path: [key] }), PlanRowIdType);
}

/** A hand-built row — one row from its base input and its kind, at the top of its own stream. */
function literalRow(base: PlanRowBaseInput, kind: ExprType<PlanRowKindType>): ExprType<PlanRowType> {
    return planRow({
        id:        literalId(base.key),
        parent:    none,
        gutter:    baseGutter(base),
        kind,
        collapsed: base.collapsed ?? false,
        pinned:    base.pinned ?? false,
        height:    base.height !== undefined ? some(base.height) : none,
        status:    base.status !== undefined ? some(resolveTag(base.status, StatusValueType)) : none,
        approval:  base.approval !== undefined ? some(resolveTag(base.approval, ApprovalStateType)) : none,
        expand:    base.expand !== undefined ? some(buildExpand(base.expand)) : none,
    });
}

/** An empty row stream. */
export function emptyRows(): PlanRowsValue {
    return East.value([], PlanRowsCollectionType);
}

/**
 * One hand-built row as a one-row stream.
 *
 * @param base - The row's base input
 * @param kind - The row's kind
 * @returns The stream
 */
export function makeRow(base: PlanRowBaseInput, kind: ExprType<PlanRowKindType>): PlanRowsValue {
    return East.value([literalRow(base, kind)], PlanRowsCollectionType);
}

/**
 * A nested-rows input — a factory result (one row stream) or a TS array of
 * them, in order. Kinded factory results ({@link PlanRowsValue}) carry their
 * axis kind through, so a parent takes the union of its children's kinds.
 *
 * @typeParam K - The kind inferred from the kinded streams in the input
 */
export type PlanRowsInput<K extends PlanAxisKindLiteral = never> =
    | ExprType<PlanRowsCollectionType>
    | PlanRowsValue<K>
    | (ExprType<PlanRowsCollectionType> | PlanRowsValue<K>)[];

/**
 * Normalize a nested-rows input into ONE stream — the authored siblings
 * concatenated in order. Accepts any kind (the caller re-brands its result).
 *
 * @param input - The nested rows, or none
 * @returns The stream
 */
export function normalizeRows(input: PlanRowsInput<PlanAxisKindLiteral> | undefined): PlanRowsValue {
    if (input === undefined) return emptyRows();
    if (Array.isArray(input)) {
        return input.reduce<PlanRowsValue>(
            (acc, x) => acc.concat(x as ExprType<PlanRowsCollectionType>) as PlanRowsValue,
            emptyRows(),
        );
    }
    return input as PlanRowsValue;
}

// ============================================================================
// Re-basing — placing a stream under a series, a path and a parent
// ============================================================================

/** One id re-based: its series named, its path prefixed. */
const rebaseId = East.function(
    [PlanRowIdType, StringType, ArrayType(StringType)],
    PlanRowIdType,
    (_$, id, series, prefix) => id.match({
        entry:   (_$2, e) => East.value(variant("entry", { series, path: prefix.concat(e.path) }), PlanRowIdType),
        section: (_$2, s) => East.value(variant("section", { series, path: prefix.concat(s.path) }), PlanRowIdType),
    }),
);

/**
 * Re-base a row stream — every id and parent id given the `series` and the
 * `prefix` path, and every row at the top of the stream (`parent: none`)
 * nested under `parent`.
 *
 * @remarks
 * How a hand-built stream lands on a canvas: `Plan.series.rows` names its
 * series (the ids were provisional, `series: ""`), a factory's nested `rows:`
 * are placed under their parent's key, and a stream under an entry is placed
 * at that entry's path. Reified once and CALLED, so each argument is evaluated
 * once, and each row is rebuilt by the one envelope ({@link planRow}).
 */
export const REBASE_ROWS = East.function(
    [PlanRowsCollectionType, StringType, ArrayType(StringType), OptionType(PlanRowIdType)],
    PlanRowsCollectionType,
    ($, rows, series, prefix, parent) => {
        const rebase = $.const(rebaseId);
        return rows.map((_$2, r) => planRow({
            id:        rebase(r.id, series, prefix),
            parent:    r.parent.match({
                some: (_$3, p) => East.value(some(rebase(p, series, prefix)), OptionType(PlanRowIdType)),
                none: (_$3) => parent,
            }),
            gutter:    r.gutter,
            kind:      r.kind,
            collapsed: r.collapsed,
            pinned:    r.pinned,
            height:    r.height,
            status:    r.status,
            approval:  r.approval,
            expand:    r.expand,
            edits:     r.edits,
        }));
    },
);

/**
 * A parent row followed by its children, the children re-based under it: each
 * child's path gains the parent's key in front, and the children at the top of
 * their stream nest under the parent.
 */
const NEST_ROWS = East.function(
    [PlanRowType, PlanRowsCollectionType],
    PlanRowsCollectionType,
    ($, parentRow, children) => {
        const prefix = $.let(parentRow.id.match({
            entry:   (_$2, e) => e.path,
            section: (_$2, s) => s.path,
        }), ArrayType(StringType));
        const nested = $.let(REBASE_ROWS(children, "", prefix, some(parentRow.id)), PlanRowsCollectionType);
        const out = $.let([parentRow], PlanRowsCollectionType);
        $(out.append(nested));
        return out;
    },
);

/**
 * Assemble a nesting parent — the parent row (its kind fully declared; the
 * renderer computes any derived numbers) followed by its children, re-based
 * under it.
 *
 * @param base - The parent's base input
 * @param rows - The nested child streams
 * @param kind - The parent's kind
 * @returns The stream — the parent, then its subtree
 */
export function assembleNested(
    base: PlanRowBaseInput,
    rows: PlanRowsInput<PlanAxisKindLiteral>,
    kind: ExprType<PlanRowKindType>,
): PlanRowsValue {
    return NEST_ROWS(literalRow(base, kind), normalizeRows(rows)) as PlanRowsValue;
}
