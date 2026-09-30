/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's inspector (#996) — the selected placement's component, what
 * it reads, its description and its layout, computed in East for the
 * `StudioBuilder` renderer, which draws the inspector in its pane after the
 * canvas. It writes no page: a layout edit is a request the canvas takes as
 * one gesture of the page's editing session, undone, redone, discarded and
 * applied with the rest.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    East,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
    some,
} from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import { StudioComponentType } from "./component.js";
import { StudioCellType } from "./pages.js";

// ============================================================================
// What the inspector shows
// ============================================================================

/**
 * The selected placement's layout, as the canvas draws it.
 *
 * @property span - Its span, in columns of 12
 * @property most - The most span its row leaves it: 12 less the row's other spans
 * @property row - Its row, counting from 1 in the order the rows first appear
 * @property rows - How many rows the page has
 * @property height - Its height in px; `none` is its content's
 * @property align - Where it sits in a taller row
 */
export const InspectorLayoutType = StructType({
    span: IntegerType,
    most: IntegerType,
    row: IntegerType,
    rows: IntegerType,
    height: OptionType(IntegerType),
    align: SnapGrid.Types.Align,
});

/** Type representing the selected placement's layout. */
export type InspectorLayoutType = typeof InspectorLayoutType;

/**
 * The selected placement, as the inspector shows it.
 *
 * @property key - The placement's key — what a layout request names
 * @property name - Its title, else its component's name, else its component's key
 * @property component - Its component's key
 * @property changed - Its component's code changed since the page went live:
 *   its fingerprint differs from the one the live version's cell stored
 * @property reads - The paths of the datasets its component's code reads, whole
 *   or a window at a time — the renderer prints each as its keypath (`.inputs.sales_daily`)
 * @property description - Its component's description, fixed by its developer
 * @property layout - Its layout ({@link InspectorLayoutType})
 */
export const InspectorSelectionType = StructType({
    key: StringType,
    name: StringType,
    component: StringType,
    changed: BooleanType,
    reads: ArrayType(TreePathType),
    description: OptionType(StringType),
    layout: InspectorLayoutType,
});

/** Type representing the selected placement, as the inspector shows it. */
export type InspectorSelectionType = typeof InspectorSelectionType;

/**
 * The inspector, as the `StudioBuilder` renderer draws it.
 *
 * @property selection - The selected placement; `none` when nothing is selected
 * @property onRequest - Asks the canvas for a layout change, which it takes as one gesture
 */
export const StudioInspectorPayloadType = StructType({
    selection: OptionType(InspectorSelectionType),
    onRequest: FunctionType([SnapGrid.Types.Request], NullType),
});

/** Type representing the inspector, as the builder draws it. */
export type StudioInspectorPayloadType = typeof StudioInspectorPayloadType;

/**
 * The selected placement, as the inspector shows it — `none` when nothing is
 * selected, or the page has no placement under the selected key.
 *
 * @remarks
 * `cells` are the page's placements as the canvas draws them, its unsaved
 * drafts in place; `live` the live version's, whose fingerprints say whether a
 * component's code changed since the page went live — a placement the live
 * version does not hold has not gone live, and has not changed. A placement
 * whose component the surface does not list is named by its component's key,
 * reads nothing and has no description.
 */
export const inspectorSelection = East.function(
    [ArrayType(StudioComponentType), ArrayType(StudioCellType), OptionType(ArrayType(StudioCellType)), OptionType(StringType)],
    OptionType(InspectorSelectionType),
    ($, listed, cells, live, selected) => {
        const found = $.let(selected.match({
            some: (_$2, key) => cells.firstMap((_$3, cell) => cell.key.equal(key).ifElse(
                () => East.value(some(cell), OptionType(StudioCellType)),
                () => East.value(none, OptionType(StudioCellType)),
            )),
            none: (_$2) => East.value(none, OptionType(StudioCellType)),
        }), OptionType(StudioCellType));
        $.if(found.hasTag("none"), ($2) => {
            $2.return(East.value(none, OptionType(InspectorSelectionType)));
        });
        const cell = $.let(found.unwrap("some"));
        const component = $.let(listed.firstMap((_$2, c) => c.key.equal(cell.component).ifElse(
            () => East.value(some(c), OptionType(StudioComponentType)),
            () => East.value(none, OptionType(StudioComponentType)),
        )), OptionType(StudioComponentType));
        const name = $.let(cell.title.match({
            some: (_$2, title) => title,
            none: (_$2) => component.match({ some: (_$3, c) => c.name, none: (_$3) => cell.component }),
        }));
        // The fingerprint the live version's cell stored, against its code's now.
        const stored = $.let(live.match({
            some: (_$2, liveCells) => liveCells.firstMap((_$3, c) => c.key.equal(cell.key).ifElse(
                () => East.value(some(c.fingerprint), OptionType(StringType)),
                () => East.value(none, OptionType(StringType)),
            )),
            none: (_$2) => East.value(none, OptionType(StringType)),
        }), OptionType(StringType));
        const changed = $.let(stored.match({
            some: (_$2, fingerprint) => component.match({
                some: (_$3, c) => c.fingerprint.notEqual(fingerprint),
                none: (_$3) => East.value(false),
            }),
            none: (_$2) => East.value(false),
        }));
        const reads = $.let(component.match({
            some: (_$2, c) => c.reads.paths.concat(c.reads.pages),
            none: (_$2) => East.value([], ArrayType(TreePathType)),
        }), ArrayType(TreePathType));
        // Its row among the rows, in the order they first appear, and the room
        // the row's other placements leave it.
        const rows = $.let([], ArrayType(StringType));
        const seen = $.let(new Set<string>(), SetType(StringType));
        const others = $.let(0n);
        $.for(cells, ($2, c) => {
            $2.if(seen.has(c.row).not(), ($3) => {
                $3(seen.insert(c.row));
                $3(rows.pushLast(c.row));
            });
            $2.if(c.row.equal(cell.row).and(() => c.key.notEqual(cell.key)), ($3) => {
                $3.assign(others, others.add(c.span));
            });
        });
        const row = $.let(0n);
        $.for(rows, ($2, r, index) => {
            $2.if(r.equal(cell.row), ($3) => {
                $3.assign(row, index.add(1n));
            });
        });
        return East.value(some({
            key: cell.key,
            name,
            component: cell.component,
            changed,
            reads,
            description: component.match({
                some: (_$2, c) => c.description,
                none: (_$2) => East.value(none, OptionType(StringType)),
            }),
            layout: {
                span: cell.span,
                most: East.value(12n).subtract(others),
                row,
                rows: rows.size(),
                height: cell.height,
                align: cell.align,
            },
        }), OptionType(InspectorSelectionType));
    },
);
