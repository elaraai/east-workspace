/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Inspector>` (#996) — the selected placement's component, what it
 * reads, its description and its layout, in the builder's pane after the
 * canvas.
 *
 * The inspector is a screen of the builder, a headerless pane of its own: a
 * `<Dock>` on the canvas's end edge whose tab row holds "Inspector" and its
 * collapse control, over the `StudioInspector` renderer. It reads the
 * builder's shared State ({@link builderKeys}) — the open page, the canvas's
 * selection and the placements as the canvas draws them — and the pages
 * record's value, and writes no page: a layout edit is a request on the
 * shared selection, which the canvas takes as one gesture of the page's
 * editing session, undone, redone, discarded and applied with the rest.
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
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    Dock,
    EastUI,
    Reactive,
    SnapGrid,
    State,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import { TreePathType } from "@elaraai/e3-types";
import { StudioComponentType } from "./component.js";
import { StudioCellType, StudioKeyType, StudioPagesType } from "./pages.js";
import { BuilderCellsType, builderKeys } from "./palette.js";

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
 * The `StudioInspector` renderer's payload.
 *
 * @property selection - The selected placement; `none` when nothing is selected
 * @property onRequest - Asks the canvas for a layout change — written to the builder's shared selection
 */
export const StudioInspectorPayloadType = StructType({
    selection: OptionType(InspectorSelectionType),
    onRequest: FunctionType([SnapGrid.Types.Request], NullType),
});

/** Type representing the `StudioInspector` renderer's payload. */
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

// ============================================================================
// The renderer's carrier
// ============================================================================

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioInspectorComponent = EastUI.component("StudioInspector", StudioInspectorPayloadType, { optional: true });

// ============================================================================
// <Studio.Inspector>
// ============================================================================

/**
 * `<Studio.Inspector>` options.
 *
 * @property pages - The pages record's value — a bound record's `read()`
 * @property components - The components the surface lists
 * @property project - The project whose pages the builder opens
 * @property id - Names the builder whose open page, selection and drafted placements it shares, when a surface holds two
 */
export interface StudioInspectorOptions {
    /** The pages record's value — `Record.bind(pages, [pagesPatch]).read()`. */
    pages: SubtypeExprOrValue<StudioPagesType>;
    /** The components the surface lists. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose pages the builder opens. */
    project: SubtypeExprOrValue<StringType>;
    /** Names the builder whose open page, selection and drafted placements it shares — needed only when one surface holds two builders. */
    id?: string;
}

/**
 * The builder's inspector: the selected placement's component, what it
 * reads, its description and its layout.
 *
 * @remarks
 * - **The pane** is 300px, headerless: its tab row holds "Inspector" and its
 *   collapse control. Collapsed, it is a 44px rail — the sliders tile, in the
 *   brand while a placement is selected, its span badge ("8/12"), "Inspector"
 *   and the placement's name, or "Nothing selected".
 * - **The selection** names the placement — its title, else its component's
 *   name — and its component's key, with "logic changed since this page went
 *   live" when the component's code has changed since.
 * - **Data** lists the datasets its component's code reads; **Configuration**
 *   is its description, fixed by its developer.
 * - **Layout** sets its span, held to its row's room; its row, a full row's or
 *   one past the last making a new row; its height, auto or px; and its
 *   alignment. Each is a request on the builder's shared selection, which the
 *   canvas takes as one gesture of the page's session — the history item
 *   undoes and applies it with the rest.
 *
 * The open page, the selection and the placements as the canvas draws them
 * are State the builder's screens share by `id`; with no canvas drawing the
 * open page, the inspector reads its saved placements.
 *
 * @param options - The record's value, the listed components and the project ({@link StudioInspectorOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const record     = $.let(Record.bind(pages, [pagesPatch]));
 *         return <Studio.Canvas pages={record} components={components} project="ops" panes={{
 *             start: <Studio.Palette pages={record.read()} components={components} project="ops" />,
 *             end:   <Studio.Inspector pages={record.read()} components={components} project="ops" />,
 *         }} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createInspector(options: StudioInspectorOptions): ExprType<UIComponentType> {
    const keys = builderKeys(options.id);
    const pagesValue = East.value(options.pages, StudioPagesType);
    const componentsValue = East.value(options.components, ArrayType(StudioComponentType));
    const projectValue = East.value(options.project, StringType);
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const pages = $.let(pagesValue);
        const project = $.let(projectValue);
        const listed = $.let(componentsValue);

        // The open page, as every screen of the builder binds it — the
        // project's first to begin with — its selection, and its placements
        // as the canvas draws them.
        const first = $.let({ project, page: "" }, StudioKeyType);
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project).and(() => first.page.equal("")).and(() => entry.hasTag("page")), ($3) => {
                $3.assign(first, key);
            });
        });
        const open = $.let(State.bind([StudioKeyType], keys.page, first));
        const openKey = $.let(open.read());
        const selection = $.let(State.bind([SnapGrid.Types.UiState], keys.ui, SnapGrid.uiState()));
        const drafted = $.let(State.bind([OptionType(BuilderCellsType)], keys.cells, none));

        const entry = $.let(pages.tryGet(openKey));
        const saved = $.let(entry.match({
            some: (_$2, found) => found.match({
                page: (_$3, page) => page.draft.cells,
                template: (_$3, layout) => layout.cells,
            }),
            none: (_$2) => East.value([], ArrayType(StudioCellType)),
        }), ArrayType(StudioCellType));
        const cells = $.let(drafted.read().match({
            some: (_$2, drawn) => East.equal(drawn.page, openKey).ifElse(() => drawn.cells, () => saved),
            none: (_$2) => saved,
        }), ArrayType(StudioCellType));
        const live = $.let(entry.match({
            some: (_$2, found) => found.match({
                page: (_$3, page) => page.live.match({
                    some: (_$4, version) => East.value(some(version.page.cells), OptionType(ArrayType(StudioCellType))),
                    none: (_$4) => East.value(none, OptionType(ArrayType(StudioCellType))),
                }),
                template: (_$3) => East.value(none, OptionType(ArrayType(StudioCellType))),
            }),
            none: (_$2) => East.value(none, OptionType(ArrayType(StudioCellType))),
        }), OptionType(ArrayType(StudioCellType)));
        const shown = $.let(inspectorSelection(listed, cells, live, selection.read().selected));

        // A layout edit is a request on the shared selection: the canvas takes
        // it as one gesture of the page's session.
        const onRequest = $.const(East.function([SnapGrid.Types.Request], NullType, ($2, request) => {
            $2(selection.write(SnapGrid.uiState({ selected: request.key, request })));
        }));

        return Dock.Root([StudioInspectorComponent.Root({ selection: shown, onRequest })], {
            icon: "sliders",
            label: "Inspector",
            badge: shown.match({
                some: (_$2, placement) => East.str`${East.print(placement.layout.span)}/12`,
                none: (_$2) => East.value(""),
            }),
            active: shown.hasTag("some"),
            detail: shown.match({
                some: (_$2, placement) => placement.name,
                none: (_$2) => East.value("Nothing selected"),
            }),
            expandedSize: "300px",
            railSize: "44px",
            side: "end",
            surface: "shell",
        });
    }));
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Inspector>` — the builder's inspector: the selected placement's
 * component, what it reads, its description and its layout. See
 * {@link createInspector}.
 */
export const StudioInspector: JsxTag<OptionsProps<typeof createInspector>> = optionsTag(createInspector);
