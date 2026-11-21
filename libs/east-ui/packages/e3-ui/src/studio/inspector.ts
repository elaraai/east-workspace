/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's inspector (#996) — the selected placement's content — its
 * component, what it reads and its description; its visual's view and source;
 * or its text block (#1669) — and its layout, computed in East for the
 * `StudioBuilder` renderer, which draws the inspector in its pane after the
 * canvas: its Configure tab over the placement itself, the sources the
 * surface lists and each view's editors (#1672), and its Layout tab. It
 * writes no page: an edit — of its layout, or of what it holds — is a request
 * the canvas takes as one gesture of the page's editing session, undone,
 * redone, discarded and applied with the rest.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
} from "@elaraai/east";
import { SnapGrid } from "@elaraai/east-ui/internal";
import { StudioComponentType, componentNames, readNames } from "./component.js";
import { contentWords, viewWords } from "./content.js";
import { StudioViewEditorType } from "./editors.js";
import { StudioCellType } from "./pages.js";
import { StudioSourceType, sourceName } from "./source.js";

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
 * What the selected placement holds, as the inspector shows it.
 *
 * @property component - A developer's component: its key; the data its code
 *   reads, whole or a window at a time, each named in words ({@link
 *   readNames}: "Sales daily") — never its keypath; and its description, fixed
 *   by its developer
 * @property visual - A visual: its view in words ("Column chart"), and its
 *   source's name — its source's key where the surface lists none of that key
 * @property text - A text block
 */
export const InspectorContentType = VariantType({
    component: StructType({ key: StringType, reads: ArrayType(StringType), description: OptionType(StringType) }),
    visual: StructType({ view: StringType, source: StringType }),
    text: NullType,
});

/** Type representing what the selected placement holds. */
export type InspectorContentType = typeof InspectorContentType;

/**
 * The selected placement, as the inspector shows it.
 *
 * @property key - The placement's key — what a layout request names
 * @property name - Its title, else its content's own name (`contentWords`):
 *   its component's name, else its component's key; its visual's view and
 *   source; "Text"
 * @property content - What it holds ({@link InspectorContentType})
 * @property layout - Its layout ({@link InspectorLayoutType})
 * @property cell - The placement itself, as the canvas draws it — what the Configure tab edits (#1672)
 */
export const InspectorSelectionType = StructType({
    key: StringType,
    name: StringType,
    content: InspectorContentType,
    layout: InspectorLayoutType,
    cell: StudioCellType,
});

/** Type representing the selected placement, as the inspector shows it. */
export type InspectorSelectionType = typeof InspectorSelectionType;

/**
 * The inspector, as the `StudioBuilder` renderer draws it.
 *
 * @property selection - The selected placement; `none` when nothing is selected
 * @property sources - The sources the surface lists, in order: what a visual's source is picked from, and its fields placed from (#1672)
 * @property editors - Each view's editors, which the Configure tab draws a visual's from (`studioEditors`, #1672)
 * @property onRequest - Asks the canvas for a change — of the placement's layout, or a field of it — which it takes as one gesture
 */
export const StudioInspectorPayloadType = StructType({
    selection: OptionType(InspectorSelectionType),
    sources: ArrayType(StudioSourceType),
    editors: ArrayType(StudioViewEditorType),
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
 * drafts in place; `sources` each listed source's name, by its key. A
 * placement whose component the surface does not list is named by its
 * component's key, reads nothing and has no description.
 */
export const inspectorSelection = East.function(
    [ArrayType(StudioComponentType), DictType(StringType, StringType), ArrayType(StudioCellType), OptionType(StringType)],
    OptionType(InspectorSelectionType),
    ($, listed, sources, cells, selected) => {
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
        // The component it places, when it places one the surface lists.
        const component = $.let(cell.content.match({
            component: (_$2, key) => listed.firstMap((_$3, c) => c.key.equal(key).ifElse(
                () => East.value(some(c), OptionType(StudioComponentType)),
                () => East.value(none, OptionType(StudioComponentType)),
            )),
            visual: (_$2) => East.value(none, OptionType(StudioComponentType)),
            text: (_$2) => East.value(none, OptionType(StudioComponentType)),
        }), OptionType(StudioComponentType));
        const name = $.let(cell.title.match({
            some: (_$2, title) => title,
            none: (_$2) => contentWords(cell.content, sources, componentNames(listed)),
        }));
        const content = $.let(cell.content.match({
            component: (_$2, key) => East.value(variant("component", {
                key,
                reads: component.match({
                    some: (_$3, c) => readNames(c.reads),
                    none: (_$3) => East.value([], ArrayType(StringType)),
                }),
                description: component.match({
                    some: (_$3, c) => c.description,
                    none: (_$3) => East.value(none, OptionType(StringType)),
                }),
            }), InspectorContentType),
            visual: (_$2, visual) => East.value(variant("visual", {
                view: viewWords(visual.view),
                source: sourceName(visual.source, sources),
            }), InspectorContentType),
            text: (_$2) => East.value(variant("text", null), InspectorContentType),
        }), InspectorContentType);
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
            content,
            layout: {
                span: cell.span,
                most: East.value(12n).subtract(others),
                row,
                rows: rows.size(),
                height: cell.height,
                align: cell.align,
            },
            cell,
        }), OptionType(InspectorSelectionType));
    },
);
