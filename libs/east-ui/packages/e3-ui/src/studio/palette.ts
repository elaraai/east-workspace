/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Palette>` (#994) — the builder's palette: the components a surface
 * lists, grouped by category, and the project's pages, in one pane.
 *
 * The palette is a screen of the builder, a headerless pane of its own: a
 * `<Dock>` whose tab row holds "Components · Pages" and its collapse control,
 * each tab a `<Library>`. The builder's screens share what is open and what
 * is selected through State keys named by the builder's `id`
 * ({@link builderKeys}): the open page, and the canvas's selection — the
 * palette reads both, and writes them when a card is clicked. It reads the
 * pages record's value and never writes it.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    East,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    Dock,
    Library,
    Reactive,
    SnapGrid,
    State,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import { StudioComponentType } from "./component.js";
import { StudioCellType, StudioKeyType, StudioPagesType, pageStatus } from "./pages.js";

// ============================================================================
// The builder's shared keys
// ============================================================================

/**
 * The names a builder's screens share, by the builder's `id`: the State keys
 * of the open page and of the canvas's selection, and the drag-source ids of
 * the palette's two libraries.
 *
 * @remarks
 * Every builder screen binds the same keys, so screens mounted apart from
 * `<Studio>` with the same `id` open one page and select one placement
 * together, as `Slice.bind` shares a slice by key.
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The keys and ids
 */
export function builderKeys(id: string | undefined): {
    /** The open page's State key — a `Studio.Types.Key`. */
    page: string;
    /** The canvas's selection's State key — a `SnapGrid.Types.UiState`. */
    ui: string;
    /** The components library's drag-source id — what the canvas lists in its `sources`. */
    components: string;
    /** The pages library's id. */
    pages: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        page: `studio.builder${suffix}.page`,
        ui: `studio.builder${suffix}.ui`,
        components: `studio.components${suffix}`,
        pages: `studio.pages${suffix}`,
    };
}

// ============================================================================
// Types
// ============================================================================

/**
 * A listed component, as its palette card shows it.
 *
 * @property meta - The meta line: the datasets its code reads, or, placed, `ON CANVAS · ×N`
 * @property placed - Whether the canvas has one of its placements selected
 */
export const PaletteCardType = StructType({ meta: StringType, placed: BooleanType });

/**
 * A page of the project, as the palette's Pages tab lists it.
 *
 * @property page - The page's name in the project
 * @property title - Its title
 * @property meta - Its status: `LIVE · Vn`, `DRAFT · Vn LIVE` or `DRAFT`
 * @property live - Whether it is live
 */
export const PalettePageType = StructType({
    page: StringType,
    title: StringType,
    meta: StringType,
    live: BooleanType,
});

// ============================================================================
// What the palette shows
// ============================================================================

/**
 * Each listed component's card, by key: its meta line and whether it is
 * placed. A card's meta line names the datasets its component reads, joined
 * with ` · `; the component the selected placement places is placed, and its
 * line counts the page's placements of it instead. A key two components
 * share keeps the first one's card.
 */
export const paletteCards = East.function(
    [ArrayType(StudioComponentType), ArrayType(StudioCellType), OptionType(StringType)],
    DictType(StringType, PaletteCardType),
    ($, listed, cells, selectedCell) => {
        const placements = $.let(new Map(), DictType(StringType, IntegerType));
        $.for(cells, ($2, cell) => {
            $2(placements.insertOrUpdate(cell.component, 1n, (_$3, count) => count.add(1n)));
        });
        // The component the selected placement places.
        const selected = $.let(selectedCell.match({
            some: (_$2, cellKey) => cells.firstMap((_$3, cell) => cell.key.equal(cellKey).ifElse(
                () => East.value(some(cell.component), OptionType(StringType)),
                () => East.value(none, OptionType(StringType)),
            )),
            none: (_$2) => East.value(none, OptionType(StringType)),
        }), OptionType(StringType));
        const cards = $.let(new Map(), DictType(StringType, PaletteCardType));
        $.for(listed, ($2, component) => {
            const reads = $2.let(component.reads.paths.concat(component.reads.pages)
                .map((_$3, path) => path.get(path.size().subtract(1n)).unwrap("field")));
            const placed = $2.let(East.equal(selected, some(component.key)));
            const count = $2.let(placements.tryGet(component.key).match({
                some: (_$3, n) => n,
                none: (_$3) => East.value(0n),
            }));
            const meta = $2.let(placed.ifElse(
                () => East.str`ON CANVAS · ×${East.print(count)}`,
                () => reads.size().equal(0n).ifElse(() => East.value("no data"), () => reads.stringJoin(" · ")),
            ));
            $2(cards.insertOrUpdate(component.key, { meta, placed }, (_$3, existing) => existing));
        });
        return cards;
    },
);

/**
 * A project's pages, in key order, as the palette's Pages tab lists them —
 * each with its title and its status. Templates and other projects' pages are
 * not listed.
 */
export const palettePages = East.function(
    [StudioPagesType, StringType],
    ArrayType(PalettePageType),
    ($, pages, project) => {
        const listed = $.let([], ArrayType(PalettePageType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project), ($3) => {
                $3.match(entry, {
                    page: ($4, page) => {
                        const live = $4.let(pageStatus(page).hasTag("live"));
                        const meta = $4.let(page.live.match({
                            some: (_$5, version) => live.ifElse(
                                () => East.str`LIVE · V${East.print(version.version)}`,
                                () => East.str`DRAFT · V${East.print(version.version)} LIVE`,
                            ),
                            none: (_$5) => East.value("DRAFT"),
                        }));
                        $4(listed.pushLast({ page: key.page, title: page.draft.title, meta, live }));
                    },
                });
            });
        });
        return listed;
    },
);

// ============================================================================
// <Studio.Palette>
// ============================================================================

/**
 * `<Studio.Palette>` options.
 *
 * @property pages - The pages record's value — a bound record's `read()`
 * @property components - The components the surface lists, in palette order
 * @property project - The project whose pages the palette lists and opens
 * @property id - Names the builder whose open page and selection it shares, when a surface holds two
 */
export interface StudioPaletteOptions {
    /** The pages record's value — `Record.bind(pages, [pagesPatch]).read()`. */
    pages: SubtypeExprOrValue<StudioPagesType>;
    /** The components the surface lists, in palette order. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project whose pages the palette lists and opens. */
    project: SubtypeExprOrValue<StringType>;
    /** Names the builder whose open page and selection it shares — needed only when one surface holds two builders. */
    id?: string;
}

/**
 * The builder's palette: the components the surface lists, grouped by
 * category, and the project's pages.
 *
 * @remarks
 * - **Components.** Every listed component but the deprecated, in the
 *   surface's order, grouped by category, with a Filter menu over category,
 *   tags and collections. A card shows the component's icon, its name, the
 *   datasets its code reads, and a lock — what it shows is fixed by its
 *   developer. A card drags onto the canvas, which lists the palette's
 *   `components` id ({@link builderKeys}) in its `sources`. The component the
 *   canvas has selected is placed, `ON CANVAS · ×N` — N the open page's
 *   placements of it; a click selects its first placement.
 * - **Pages.** The project's pages in key order, each with its status —
 *   `LIVE · Vn`, `DRAFT · Vn LIVE` or `DRAFT` — and a status dot. The open
 *   page is placed; a click opens a page.
 * - **Collapsed**, the pane is a rail: the expand control, its icon, the
 *   number of components and its name.
 *
 * The open page and the selection are State the builder's screens share by
 * `id`; the open page begins as the project's first page.
 *
 * @param options - The record's value, the listed components and the project ({@link StudioPaletteOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East, UIComponentType } from "@elaraai/east";
 * import { Reactive } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * export const builder = ui("builder", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const record     = $.let(Record.bind(pages, [pagesPatch]));
 *         return <Studio.Palette pages={record.read()} components={components} project="ops" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createPalette(options: StudioPaletteOptions): ExprType<UIComponentType> {
    const keys = builderKeys(options.id);
    const pagesValue = East.value(options.pages, StudioPagesType);
    const componentsValue = East.value(options.components, ArrayType(StudioComponentType));
    const projectValue = East.value(options.project, StringType);
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const pages = $.let(pagesValue);
        const project = $.let(projectValue);
        const listed = $.let(componentsValue.filter((_$2, component) => component.deprecated.not()));
        const projectPages = $.let(palettePages(pages, project));

        // The open page and the canvas's selection, shared with the builder's
        // other screens; the open page begins as the project's first.
        const first = $.let(projectPages.size().equal(0n).ifElse(
            () => East.value({ project, page: "" }, StudioKeyType),
            () => East.value({ project, page: projectPages.get(0n).page }, StudioKeyType),
        ));
        const open = $.let(State.bind([StudioKeyType], keys.page, first));
        const selection = $.let(State.bind([SnapGrid.Types.UiState], keys.ui, SnapGrid.uiState()));
        const openKey = $.let(open.read());

        // The open page's placements — its draft's, or a template's.
        const cells = $.let(pages.tryGet(openKey).match({
            some: (_$2, entry) => entry.match({
                page: (_$3, page) => page.draft.cells,
                template: (_$3, layout) => layout.cells,
            }),
            none: (_$2) => East.value([], ArrayType(StudioCellType)),
        }), ArrayType(StudioCellType));
        const cards = $.let(paletteCards(listed, cells, selection.read().selected));

        // A card's click selects the component's first placement on the page.
        const selectFirst = $.const(East.function([StringType], NullType, ($2, component) => {
            const placement = $2.let(cells.firstMap((_$3, cell) => cell.component.equal(component).ifElse(
                () => East.value(some(cell.key), OptionType(StringType)),
                () => East.value(none, OptionType(StringType)),
            )));
            $2.match(placement, {
                some: ($3, cellKey) => { $3(selection.write(SnapGrid.uiState({ selected: cellKey }))); },
            });
        }));
        // A page's click opens it, with nothing selected.
        const openPage = $.const(East.function([StringType], NullType, ($2, name) => {
            $2(open.write({ project, page: name }));
            $2(selection.write(SnapGrid.uiState()));
        }));

        return Dock.Root([], {
            icon: "shapes",
            label: "Components",
            badge: East.print(listed.size()),
            expandedSize: "264px",
            railSize: "44px",
            side: "start",
            surface: "shell",
            tabs: [
                {
                    key: "components",
                    label: "Components",
                    body: [Library.Root(listed, {
                        id: keys.components,
                        item: (component) => ({
                            key: component.key,
                            label: component.name,
                            sublabel: cards.get(component.key).meta,
                            icon: component.icon,
                            trailing: some(Library.glyph("lock", "Logic fixed by the developer")),
                            placed: cards.get(component.key).placed,
                        }),
                        groupBy: [{ key: "category", label: "Category", value: (component) => component.category }],
                        filters: [
                            { key: "category", label: "Category", values: (component) => [component.category] },
                            { key: "tags", label: "Tags", values: (component) => component.tags },
                            { key: "collections", label: "Collections", values: (component) => component.collections },
                        ],
                        search: (component) => East.str`${component.name} ${component.category} ${component.tags.stringJoin(" ")}`,
                        noun: { singular: "component", plural: "components" },
                        onCardClick: selectFirst,
                        style: { height: "fill", virtualization: false },
                    })],
                },
                {
                    key: "pages",
                    label: "Pages",
                    body: [Library.Root(projectPages, {
                        id: keys.pages,
                        item: (page) => ({
                            key: page.page,
                            label: page.title,
                            sublabel: page.meta,
                            icon: "file-lines",
                            draggable: false,
                            trailing: page.live.ifElse(
                                () => some(Library.glyph("circle", "Live", "success")),
                                () => some(Library.glyph("circle", "Draft", "neutral")),
                            ),
                            placed: page.page.equal(openKey.page),
                        }),
                        search: (page) => page.title,
                        noun: { singular: "page", plural: "pages" },
                        onCardClick: openPage,
                        style: { height: "fill", virtualization: false },
                    })],
                },
            ],
        });
    }));
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Palette>` — the builder's palette: the listed components by
 * category, and the project's pages. See {@link createPalette}.
 */
export const StudioPalette: JsxTag<OptionsProps<typeof createPalette>> = optionsTag(createPalette);
