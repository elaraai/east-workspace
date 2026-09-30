/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Canvas>` (#995) — the builder's canvas: the open page's grid, its
 * history and the controls around it.
 *
 * The canvas is the SnapGrid's editing canvas over the open page's cells, in
 * the builder's frame: one toolbar across its width, then the panes — the
 * palette, the inspector — beside the canvas column, where the selection bar
 * names the selected placement over the grid panel. Every gesture is a draft
 * of the page's editing session, and Apply is one patch commit on the page.
 * The builder's screens share the open page, the selection, and the design
 * width and zoom through State keys named by the builder's `id`
 * ({@link builderKeys}) — and the page's cells as the canvas draws them
 * (#996), so the palette counts and the inspector reads what it shows, and
 * the inspector's edits reach the canvas as requests on the shared selection;
 * and an Apply the publish preview asks of it (#998), which it answers when
 * its drafts land or cannot.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    East,
    NullType,
    OptionType,
    SetType,
    StringType,
    StructType,
    none,
    some,
    variant,
    type ExprType,
    type FunctionType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    Button,
    EastUI,
    EmptyState,
    Reactive,
    SnapGrid,
    State,
    Status,
    Text,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import type { RecordOutcomeType } from "../bind/record.js";
import { StudioComponentType, dispatchComponent } from "./component.js";
import { nameWriteRefusal } from "./library.js";
import { StudioCellType, StudioKeyType, StudioPages, StudioPagesType, pageChanges, type StudioPagesPatchType } from "./pages.js";
import { BuilderCellsType, builderKeys } from "./palette.js";

// ============================================================================
// What a placement's tile shows
// ============================================================================

/**
 * A listed component, as its placements' tiles show it on the canvas.
 *
 * @property frame - Drawn in a tile frame, or bare
 * @property name - Its name — a placement's label when it has no title of its own
 * @property icon - Its icon, in the selection bar
 * @property meta - Its key and the datasets it reads, in the selection bar
 */
export const CanvasTileType = StructType({
    frame: BooleanType,
    name: StringType,
    icon: StringType,
    meta: StringType,
});

/**
 * Each listed component's tile, by key: framed or bare, its name and icon,
 * and its meta line — its key and the datasets and records its code reads,
 * joined with ` · ` ("revenue_trend · sales_daily"). A key two components
 * share keeps the first one's tile.
 */
export const canvasTiles = East.function(
    [ArrayType(StudioComponentType)],
    DictType(StringType, CanvasTileType),
    ($, components) => {
        const tiles = $.let(new Map(), DictType(StringType, CanvasTileType));
        $.for(components, ($2, component) => {
            const reads = $2.let(component.reads.paths.concat(component.reads.pages)
                .map((_$3, path) => path.get(path.size().subtract(1n)).unwrap("field")));
            const meta = $2.let(reads.size().equal(0n).ifElse(
                () => component.key,
                () => East.str`${component.key} · ${reads.stringJoin(" · ")}`,
            ));
            $2(tiles.insertOrUpdate(component.key, {
                frame: component.frame.hasTag("card"),
                name: component.name,
                icon: component.icon,
                meta,
            }, (_$3, existing) => existing));
        });
        return tiles;
    },
);

// ============================================================================
// Save as template — the toolbar's item
// ============================================================================

/**
 * The `StudioSaveTemplate` renderer's payload — the builder toolbar's Save as
 * template: its button, and the popover beside it that names the template.
 *
 * @property title - The open page's title — the popover's head names it, and offers a name from it
 * @property enabled - Whether the open entry is a page, which it saves; a template is not saved again
 * @property taken - The names the project holds, pages and templates — the template's must be none of them
 * @property onSave - Saves the open page, as last saved, as a template under a name — one commit; `none` when it was saved, else what refused it
 */
export const StudioSaveTemplatePayloadType = StructType({
    title: StringType,
    enabled: BooleanType,
    taken: SetType(StringType),
    onSave: AsyncFunctionType([StringType], OptionType(StringType)),
});

/** Type representing the `StudioSaveTemplate` renderer's payload. */
export type StudioSaveTemplatePayloadType = typeof StudioSaveTemplatePayloadType;

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioSaveTemplateComponent = EastUI.component("StudioSaveTemplate", StudioSaveTemplatePayloadType, { optional: true });

// ============================================================================
// <Studio.Canvas>
// ============================================================================

/** The pages record, bound with its patch mutation — what the canvas reads, and its Apply and Save as template commit through. */
type StudioPagesHandle = ExprType<StructType<{
    read: FunctionType<[], StudioPagesType>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, StudioPagesPatchType], RecordOutcomeType> }>;
}>>;

/**
 * `<Studio.Canvas>` options.
 *
 * @property pages - The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`
 * @property components - The components the surface lists, in palette order
 * @property project - The project whose pages the canvas opens
 * @property id - Names the builder whose open page, selection and view it shares, when a surface holds two
 * @property panes - The panes beside the canvas, under its toolbar — the palette, the inspector
 * @property onPreview - Opens the preview
 * @property onPublish - Opens the preview with the publish panel
 */
export interface StudioCanvasOptions {
    /** The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`. */
    pages: StudioPagesHandle;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose pages the canvas opens. */
    project: SubtypeExprOrValue<StringType>;
    /** Names the builder whose open page, selection and view it shares — needed only when one surface holds two builders. */
    id?: string;
    /** The panes beside the canvas, under its toolbar — `<Studio.Palette>` before it, the inspector after it. */
    panes?: {
        /** The pane before the canvas. */
        start?: SubtypeExprOrValue<UIComponentType>;
        /** The pane after it. */
        end?: SubtypeExprOrValue<UIComponentType>;
    };
    /** Opens the preview — the toolbar's Preview; omitted, the button is disabled. */
    onPreview?: SubtypeExprOrValue<FunctionType<[], NullType>>;
    /** Opens the preview with the publish panel — the toolbar's Publish; omitted, the button is disabled. */
    onPublish?: SubtypeExprOrValue<FunctionType<[], NullType>>;
}

/**
 * The builder's canvas: the open page's grid, its history and the controls
 * around it.
 *
 * @remarks
 * - **The grid.** The open page's draft cells — a template's cells — on the
 *   SnapGrid's editing canvas, each placement its component's own UI, framed
 *   or bare, named by its title or its component's name. A component dropped
 *   from the palette becomes a placement at its span, fitted to the row, and
 *   stores its component's fingerprint.
 * - **The session.** Every move, resize, drop and removal is a draft; the
 *   history item undoes, redoes, discards and applies. Apply is one patch
 *   commit on the page (`Studio.save`), and a save another landed first is a
 *   conflict, in the history item's words. The publish preview asks for the
 *   same Apply through the builder's shared State, before it publishes.
 * - **The toolbar.** The page's status — ○ Draft until it is published,
 *   ● Live while its draft is its live layout, Live · edited once they differ
 *   — then the grid chip and the time of the last save; the width readout,
 *   the zoom, the history item, Desktop · Tablet, Save as template, Preview
 *   and Publish. Save as template names a template and saves the open page,
 *   as last saved, as it — one commit, a name the project holds refused.
 * - **The selection bar** names the selected placement: its component's icon
 *   and name, its key and what it reads.
 * - **The panes** sit beside the canvas under the toolbar — the palette
 *   before it, the inspector after it; a Dock pane collapses to its rail and
 *   the grid takes the room.
 *
 * The open page, the selection, and the design width and zoom are State the
 * builder's screens share by `id`, and so are the page's cells as the canvas
 * draws them, its unsaved drafts in place; the open page begins as the
 * project's first page. A page the record does not hold is a placeholder
 * that says so.
 *
 * @param options - The bound record, the listed components, the project, the panes and the preview callbacks ({@link StudioCanvasOptions})
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
 *         return <Studio.Canvas pages={record} components={components} project="ops"
 *             panes={{ start: <Studio.Palette pages={record.read()} components={components} project="ops" /> }} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createCanvas(options: StudioCanvasOptions): ExprType<UIComponentType> {
    const keys = builderKeys(options.id);
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const record = $.let(options.pages);
        const pages = $.let(record.read());
        const components = $.let(East.value(options.components, ArrayType(StudioComponentType)));
        const project = $.let(East.value(options.project, StringType));

        // The open page, the selection, and the design width and zoom, shared
        // with the builder's other screens; the open page begins as the
        // project's first.
        const first = $.let(East.value({ project, page: "" }, StudioKeyType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project).and(() => first.page.equal("")).and(() => entry.hasTag("page")), ($3) => {
                $3.assign(first, key);
            });
        });
        const open = $.let(State.bind([StudioKeyType], keys.page, first));
        const openKey = $.let(open.read());
        const selection = $.let(State.bind([SnapGrid.Types.UiState], keys.ui, SnapGrid.uiState()));
        const view = $.let(State.bind([SnapGrid.Types.ViewState], keys.view, SnapGrid.viewState()));
        // The Apply the preview asks for before it publishes, and the answer.
        const applying = $.let(State.bind([SnapGrid.Types.ApplyState], keys.apply, East.value(variant("idle", null), SnapGrid.Types.ApplyState)));
        // The page's cells as the canvas draws them — its drafts in place —
        // with the page they are of, for the palette's counts and the inspector.
        const drafted = $.let(State.bind([OptionType(BuilderCellsType)], keys.cells, none));
        const onDrafted = $.const(East.function([ArrayType(StudioCellType)], NullType, ($2, drawn) => {
            $2(drafted.write(some({ page: openKey, cells: drawn })));
        }));

        $.if(pages.has(openKey).not(), ($2) => {
            $2.return(EmptyState.Root({
                title: Text.Root("No page open"),
                description: Text.Root(East.str`${project} has no page ${openKey.page}. Open a page from the palette's Pages tab, or start one from the page library.`),
                icon: { prefix: "fas", name: "file-circle-question" },
            }));
        });
        const entry = $.let(pages.get(openKey));
        const cells = $.let(entry.match({
            page: (_$2, page) => page.draft.cells,
            template: (_$2, layout) => layout.cells,
        }), ArrayType(StudioCellType));
        const tiles = $.let(canvasTiles(components));

        // ○ Draft until it is published; ● Live while its draft is its live
        // layout; Live · edited once their layouts differ.
        const status = $.let(entry.match({
            page: (_$2, page) => page.live.match({
                none: (_$3) => Status.Root({ label: "Draft", ring: true, showIcon: false }),
                some: (_$3, live) => pageChanges(live.page, page.draft).size().equal(0n).ifElse(
                    () => Status.Root({ label: "Live", value: "success", showIcon: false }),
                    () => Status.Root({ label: "Live · edited", value: "warning", showIcon: false }),
                ),
            }),
            template: (_$2) => Status.Root({ label: "Template", showIcon: false }),
        }), UIComponentType);

        // Save as template: the open page, as last saved, under a name the
        // project does not hold — one commit.
        const taken = $.let(new Set<string>(), SetType(StringType));
        $.for(pages, ($2, _found, key) => {
            $2.if(key.project.equal(openKey.project), ($3) => {
                $3(taken.insert(key.page));
            });
        });
        const onSave = $.const(East.asyncFunction([StringType], OptionType(StringType), ($2, name) => {
            const outcome = $2.let(record.commit.patch("", StudioPages.saveTemplate(pages, openKey, { project: openKey.project, page: name }, name)));
            return nameWriteRefusal(outcome, name);
        }));
        const saveTemplate = $.let(StudioSaveTemplateComponent.Root({
            title: entry.match({ page: (_$2, page) => page.draft.title, template: (_$2, layout) => layout.title }),
            enabled: entry.hasTag("page"),
            taken,
            onSave,
        }));

        return SnapGrid.Root(cells, {
            cell: (cell) => SnapGrid.cell({
                key: cell.key,
                row: cell.row,
                span: cell.span,
                height: cell.height,
                align: cell.align,
                // A frameless component renders bare; one the surface does not
                // list is its placeholder, in a tile.
                frame: tiles.tryGet(cell.component).match({
                    some: (_$2, tile) => tile.frame,
                    none: (_$2) => East.value(true),
                }),
                label: cell.title.match({
                    some: (_$2, title) => some(title),
                    none: (_$2) => tiles.tryGet(cell.component).match({
                        some: (_$3, tile) => some(tile.name),
                        none: (_$3) => East.value(none, OptionType(StringType)),
                    }),
                }),
                icon: tiles.tryGet(cell.component).match({
                    some: (_$2, tile) => some(tile.icon),
                    none: (_$2) => East.value(none, OptionType(StringType)),
                }),
                meta: tiles.tryGet(cell.component).match({
                    some: (_$2, tile) => some(tile.meta),
                    none: (_$2) => some(cell.component),
                }),
                content: dispatchComponent(components, cell.component),
            }),
            edit: {
                key: "key", row: "row", span: "span", height: "height", align: "align",
                // A component dropped from the palette: a placement at its
                // span, storing its fingerprint; the canvas fits the span.
                create: ($2, card, at) => {
                    const component = $2.let(components.filter((_$3, c) => c.key.equal(card.key)).get(0n));
                    return {
                        key: at.key,
                        row: at.row,
                        span: component.span,
                        height: none,
                        align: variant("top", null),
                        title: none,
                        component: component.key,
                        fingerprint: component.fingerprint,
                    };
                },
            },
            editing: { onApply: StudioPages.save(record, openKey), onDrafted },
            ui: selection,
            view,
            apply: applying,
            sources: [keys.components],
            guides: true,
            width: "1440px",
            widths: [
                { label: "Desktop", icon: "desktop", width: "1440px" },
                { label: "Tablet", icon: "tablet-screen-button", width: "1024px" },
            ],
            toolbar: {
                start: [status],
                end: [
                    saveTemplate,
                    Button.Root("Preview", {
                        variant: "outline",
                        ...(options.onPreview !== undefined ? { onClick: options.onPreview } : { disabled: true }),
                    }),
                    Button.Root("Publish", {
                        variant: "outline",
                        ...(options.onPublish !== undefined ? { onClick: options.onPublish } : { disabled: true }),
                    }),
                ],
            },
            ...(options.panes !== undefined ? { panes: options.panes } : {}),
            height: "fill",
        });
    }));
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Canvas>` — the builder's canvas: the open page's grid, its history
 * and the controls around it. See {@link createCanvas}.
 */
export const StudioCanvas: JsxTag<OptionsProps<typeof createCanvas>> = optionsTag(createCanvas);
