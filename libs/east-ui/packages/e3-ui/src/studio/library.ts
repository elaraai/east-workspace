/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Library>` (#997) — a project's templates and pages, and where
 * new pages start.
 *
 * The library is a component of its own, apart from the builder, headerless
 * with one toolbar:
 * the search over both rows, Sort · Name, the pages' Grid · List and the
 * primary "+ New page in <project>". Beside it the projects the record holds
 * and the project's pages; under it the Templates — Blank grid, then the
 * project's templates — and the Pages, each row a `<Library
 * variant="gallery">` whose cards' media are their layouts' wireframes. The
 * frame is the `StudioLibrary` renderer's, and the two galleries draw no
 * toolbar of their own (`toolbar: false`).
 *
 * A new page — from the toolbar's button, the dashed last card or a template's
 * card — takes a name and a template, and is one commit on the record
 * (`Studio.newPage`). "Open in builder →" opens a page in the builder: it
 * writes the builder's open page ({@link builderKeys}) and tells the host.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
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
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    Library,
    Reactive,
    SnapGrid,
    State,
    Text,
    UIComponentType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
} from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { StudioComponentType } from "./component.js";
import { StudioCellType, StudioKeyType, StudioPages, StudioPagesType, pageStatus, type StudioPagesPatchType } from "./pages.js";
import { PalettePageType, builderKeys, palettePages } from "./palette.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A page of the project, as the page library's Pages row draws it.
 *
 * @property page - The page's name in the project
 * @property title - Its title
 * @property live - Whether it is live: published, its draft its live layout
 * @property cells - Its draft's placements — its card's wireframe
 */
export const StudioLibraryPageType = StructType({
    page: StringType,
    title: StringType,
    live: BooleanType,
    cells: ArrayType(StudioCellType),
});

/** Type representing a page as the Pages row draws it. */
export type StudioLibraryPageType = typeof StudioLibraryPageType;

/**
 * A template, as the page library's Templates row draws it.
 *
 * @property name - The template's name in the project; `""` for Blank grid
 * @property title - Its title
 * @property summary - What it places — "KPI rail ×4 · Revenue trend"
 * @property cells - Its placements — its card's wireframe
 */
export const StudioLibraryTemplateType = StructType({
    name: StringType,
    title: StringType,
    summary: StringType,
    cells: ArrayType(StudioCellType),
});

/** Type representing a template as the Templates row draws it. */
export type StudioLibraryTemplateType = typeof StudioLibraryTemplateType;

/**
 * How the page library orders its templates and pages — by name.
 *
 * @property az - A to Z, the record's key order
 * @property za - Z to A
 */
export const StudioLibrarySortType = VariantType({
    az: NullType,
    za: NullType,
});

/** Type representing how the page library orders its rows. */
export type StudioLibrarySortType = typeof StudioLibrarySortType;

/**
 * The New page popover, which hangs from the toolbar's New page button however
 * it opens.
 *
 * @property closed - Not open
 * @property open - Open, starting from a template — its name; `""` for Blank grid
 */
export const StudioLibraryPopoverType = VariantType({
    closed: NullType,
    open: StringType,
});

/** Type representing the New page popover. */
export type StudioLibraryPopoverType = typeof StudioLibraryPopoverType;

/**
 * A new page, as the popover asks for it.
 *
 * @property name - Its name in the project, which is its title too
 * @property template - The template it starts from; `none` for Blank grid
 */
export const StudioLibraryNewPageType = StructType({
    name: StringType,
    template: OptionType(StringType),
});

/** Type representing a new page as the popover asks for it. */
export type StudioLibraryNewPageType = typeof StudioLibraryNewPageType;

/**
 * The `StudioLibrary` renderer's payload.
 *
 * @property project - The project it shows
 * @property projects - The projects the record holds, and the surface's own, in name order
 * @property pages - The project's pages, for the pane, in the order Sort gives
 * @property current - The page open in the builder, when it is the shown project's; `""` otherwise
 * @property templates - The project's templates, for the popover's picker, in name order
 * @property taken - The names the project holds, pages and templates — a new one must be none of them
 * @property counts - How many pages and templates (Blank grid counted) the project holds, and how many pages the search shows
 * @property query - The search's text
 * @property sort - How the rows are ordered
 * @property layout - How the Pages row lays its cards out
 * @property popover - The New page popover
 * @property templatesView - Draws the Templates row
 * @property pagesView - Draws the Pages row
 * @property onQuery - Sets the search
 * @property onSort - Sets the order
 * @property onLayout - Sets the Pages row's layout
 * @property onProject - Shows another project
 * @property onOpen - Opens a page of the project in the builder
 * @property onPopover - Opens or closes the New page popover
 * @property onCreate - Makes a new page, one commit; `none` when it was made, else what refused it
 */
export const StudioLibraryPayloadType = StructType({
    project: StringType,
    projects: ArrayType(StringType),
    pages: ArrayType(PalettePageType),
    current: StringType,
    templates: ArrayType(StructType({ name: StringType, title: StringType })),
    taken: SetType(StringType),
    counts: StructType({ pages: IntegerType, templates: IntegerType, shownPages: IntegerType }),
    query: StringType,
    sort: StudioLibrarySortType,
    layout: Library.Types.Layout,
    popover: StudioLibraryPopoverType,
    templatesView: FunctionType([], UIComponentType),
    pagesView: FunctionType([], UIComponentType),
    onQuery: FunctionType([StringType], NullType),
    onSort: FunctionType([StudioLibrarySortType], NullType),
    onLayout: FunctionType([Library.Types.Layout], NullType),
    onProject: FunctionType([StringType], NullType),
    onOpen: FunctionType([StringType], NullType),
    onPopover: FunctionType([StudioLibraryPopoverType], NullType),
    onCreate: AsyncFunctionType([StudioLibraryNewPageType], OptionType(StringType)),
});

/** Type representing the `StudioLibrary` renderer's payload. */
export type StudioLibraryPayloadType = typeof StudioLibraryPayloadType;

// ============================================================================
// What the page library shows
// ============================================================================

/** The projects the record holds, and the surface's own, in name order. */
export const libraryProjects = East.function(
    [StudioPagesType, StringType],
    ArrayType(StringType),
    ($, pages, home) => {
        const projects = $.let(new Set<string>(), SetType(StringType));
        $(projects.insert(home));
        $.for(pages, ($2, _entry, key) => {
            $2(projects.tryInsert(key.project));
        });
        const listed = $.let([], ArrayType(StringType));
        $.for(projects, ($2, project) => {
            $2(listed.pushLast(project));
        });
        return listed;
    },
);

/**
 * What a layout places, as its card's meta line says: each component's name,
 * counted when it is placed more than once — "KPI rail ×4 · Revenue trend" —
 * in the order they first appear. A component the surface does not list is
 * named by its key.
 */
export const layoutSummary = East.function(
    [ArrayType(StudioComponentType), ArrayType(StudioCellType)],
    StringType,
    ($, components, cells) => {
        const order = $.let([], ArrayType(StringType));
        const counts = $.let(new Map(), DictType(StringType, IntegerType));
        $.for(cells, ($2, cell) => {
            $2.if(counts.has(cell.component).not(), ($3) => {
                $3(order.pushLast(cell.component));
            });
            $2(counts.insertOrUpdate(cell.component, 1n, (_$3, n) => n.add(1n)));
        });
        const parts = $.let([], ArrayType(StringType));
        $.for(order, ($2, key) => {
            const name = $2.let(components.firstMap((_$3, c) => c.key.equal(key).ifElse(
                () => East.value(some(c.name), OptionType(StringType)),
                () => East.value(none, OptionType(StringType)),
            )).match({
                some: (_$3, found) => found,
                none: (_$3) => key,
            }));
            const count = $2.let(counts.get(key));
            $2(parts.pushLast(count.greater(1n).ifElse(
                () => East.str`${name} ×${East.print(count)}`,
                () => name,
            )));
        });
        return parts.stringJoin(" · ");
    },
);

/** A project's pages, in name order: each one's name, title, whether it is live, and its draft's placements. */
export const libraryPages = East.function(
    [StudioPagesType, StringType],
    ArrayType(StudioLibraryPageType),
    ($, pages, project) => {
        const listed = $.let([], ArrayType(StudioLibraryPageType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project), ($3) => {
                $3.match(entry, {
                    page: ($4, page) => {
                        $4(listed.pushLast({
                            page: key.page,
                            title: page.draft.title,
                            live: pageStatus(page).hasTag("live"),
                            cells: page.draft.cells,
                        }));
                    },
                });
            });
        });
        return listed;
    },
);

/** A project's templates, in name order, each with what it places. */
export const libraryTemplates = East.function(
    [StudioPagesType, StringType, ArrayType(StudioComponentType)],
    ArrayType(StudioLibraryTemplateType),
    ($, pages, project, components) => {
        const listed = $.let([], ArrayType(StudioLibraryTemplateType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(project), ($3) => {
                $3.match(entry, {
                    template: ($4, layout) => {
                        $4(listed.pushLast({
                            name: key.page,
                            title: layout.title,
                            summary: layoutSummary(components, layout.cells),
                            cells: layout.cells,
                        }));
                    },
                });
            });
        });
        return listed;
    },
);

/**
 * What refused a write that makes an entry under a new name — a new page, a
 * template — or `none` when it committed. A name another write took first is
 * a conflict; a write that got no answer may have committed, and says so.
 */
export const nameWriteRefusal = East.function(
    [RecordOutcomeType, StringType],
    OptionType(StringType),
    ($, outcome, name) => {
        const refused = $.let(none, OptionType(StringType));
        $.match(outcome, {
            conflict: ($2) => { $2.assign(refused, some(East.str`Another write took the name ${name} first — choose another`)); },
            invalid: ($2, refusal) => { $2.assign(refused, some(refusal.message)); },
            failed: ($2, refusal) => { $2.assign(refused, some(East.str`The write failed: ${refusal.stderr}`)); },
            timed_out: ($2) => { $2.assign(refused, some("The write ran out of time and wrote nothing")); },
            transport: ($2, lost) => { $2.assign(refused, some(East.str`The write got no answer, so it may have been made — ${lost.message}`)); },
        });
        return refused;
    },
);

// ============================================================================
// The renderer's carrier
// ============================================================================

/**
 * Internal {@link EastUI.component} carrier. The React renderer registers
 * against this in `@elaraai/e3-ui-components` via `implementUIComponent`.
 */
export const StudioLibraryComponent = EastUI.component("StudioLibrary", StudioLibraryPayloadType, { optional: true });

// ============================================================================
// <Studio.Library>
// ============================================================================

/** The pages record, bound with its patch mutation — what the page library reads and a new page commits through. */
type StudioPagesHandle = ExprType<StructType<{
    read: FunctionType<[], StudioPagesType>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, StudioPagesPatchType], RecordOutcomeType> }>;
}>>;

/**
 * `<Studio.Library>` options.
 *
 * @property pages - The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`
 * @property components - The components the surface lists — what a layout's summary names
 * @property project - The project it shows first
 * @property id - Names the builder whose open page it writes, when a surface holds two
 * @property onOpen - Told when a page opens in the builder, with its key — the host shows the builder
 */
export interface StudioLibraryOptions {
    /** The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`. */
    pages: StudioPagesHandle;
    /** The components the surface lists — what a layout's summary names. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project it shows first. */
    project: SubtypeExprOrValue<StringType>;
    /** Names the builder whose open page it writes — needed only when one surface holds two builders. */
    id?: string;
    /** Told when a page opens in the builder, with its key — the host shows the builder. */
    onOpen?: SubtypeExprOrValue<FunctionType<[StudioKeyType], NullType>>;
}

/**
 * A project's templates and pages, and where new pages start.
 *
 * @remarks
 * - **The toolbar**, one row: the search "Search N pages and M templates…",
 *   which narrows both rows by title; Sort · Name, A to Z (the record's key
 *   order) or Z to A; the Pages row's Grid · List; and "+ New page in
 *   <project>".
 * - **The pane**: the projects the record holds, the one shown in the brand;
 *   then the project's pages, each with its status dot — ● live, ○ draft —
 *   the one open in the builder in the strong ink, a click opening one in the
 *   builder; and the legend.
 * - **Templates**, "clone to start a page": Blank grid, then the project's
 *   templates, four across, each with its wireframe, its title and what it
 *   places; a click starts a new page from it.
 * - **Pages**, "N in <project>": two across, each with its wireframe at its
 *   start, its title and status, how many components it places, and "Open in
 *   builder →"; a dashed card last starts a new page.
 * - **A new page** takes a name the project does not hold and a template, or
 *   Blank grid, in a popover under the New page button — which a template's
 *   card and the dashed card open too, their template picked — and is one
 *   commit on the record; a name another write took first is refused in the
 *   popover.
 *
 * The project shown, the search, the order, the Pages row's layout and the
 * popover are the page library's own State; the page it opens is the
 * builder's, shared by `id` with the builder's screens.
 *
 * @param options - The bound record, the listed components and the project ({@link StudioLibraryOptions})
 * @returns An East expression of type `UIComponentType`
 *
 * @example
 * ```tsx
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * export const library = ui("library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const record     = $.let(Record.bind(pages, [pagesPatch]));
 *         return <Studio.Library pages={record} components={components} project="Ops console" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: StudioLibraryOptions): ExprType<UIComponentType> {
    const keys = builderKeys(options.id);
    const own = options.id === undefined ? "studio.library" : `studio.library.${options.id}`;
    const hostOpen = options.onOpen === undefined
        ? East.function([StudioKeyType], NullType, (_$) => { /* no host to tell */ })
        : East.value(options.onOpen, FunctionType([StudioKeyType], NullType));
    return Reactive.Root(East.function([], UIComponentType, ($) => {
        const record = $.let(options.pages);
        const pages = $.let(record.read());
        const components = $.let(East.value(options.components, ArrayType(StudioComponentType)));
        const home = $.let(East.value(options.project, StringType));
        const tellHost = $.const(hostOpen);

        // The page library's own view: the project it shows, the search, the
        // order, the Pages row's layout and the New page popover.
        const shown = $.let(State.bind([StringType], `${own}.project`, home));
        const project = $.let(shown.read());
        const searched = $.let(State.bind([StringType], `${own}.query`, ""));
        const query = $.let(searched.read());
        const needle = $.let(query.lowerCase());
        const ordered = $.let(State.bind([StudioLibrarySortType], `${own}.sort`, East.value(variant("az", null), StudioLibrarySortType)));
        const sort = $.let(ordered.read());
        const laid = $.let(State.bind([Library.Types.Layout], `${own}.layout`, East.value(variant("grid", null), Library.Types.Layout)));
        const layout = $.let(laid.read());
        const popover = $.let(State.bind([StudioLibraryPopoverType], `${own}.popover`, East.value(variant("closed", null), StudioLibraryPopoverType)));

        // The builder's open page and its selection, as its screens share
        // them — the open page the project's first to begin with.
        const first = $.let(East.value({ project: home, page: "" }, StudioKeyType));
        $.for(pages, ($2, entry, key) => {
            $2.if(key.project.equal(home).and(() => first.page.equal("")).and(() => entry.hasTag("page")), ($3) => {
                $3.assign(first, key);
            });
        });
        const open = $.let(State.bind([StudioKeyType], keys.page, first));
        const openKey = $.let(open.read());
        const selection = $.let(State.bind([SnapGrid.Types.UiState], keys.ui, SnapGrid.uiState()));

        // The rows: the search narrows them by title, and Sort orders them by
        // name — the record's key order, or its reverse.
        const za = $.let(sort.hasTag("za"));
        const everyPage = $.let(libraryPages(pages, project));
        const everyTemplate = $.let(libraryTemplates(pages, project, components));
        const matchingPages = $.let(everyPage.filter((_$2, p) => p.title.lowerCase().contains(needle)));
        const pageRows = $.let(za.ifElse(() => matchingPages.reverse(), () => matchingPages));
        const byName = $.let(palettePages(pages, project));
        const paneRows = $.let(za.ifElse(() => byName.reverse(), () => byName));
        const matchingTemplates = $.let(everyTemplate.filter((_$2, t) => t.title.lowerCase().contains(needle)));
        const orderedTemplates = $.let(za.ifElse(() => matchingTemplates.reverse(), () => matchingTemplates));
        // Blank grid is built in, first; its name is none a template can have.
        const blank = $.let(East.value({ name: "", title: "Blank grid", summary: "12-col · empty", cells: [] }, StudioLibraryTemplateType));
        const templateRows = $.let(East.value("blank grid").contains(needle).ifElse(
            () => East.value([blank], ArrayType(StudioLibraryTemplateType)).concat(orderedTemplates),
            () => orderedTemplates,
        ));
        const taken = $.let(new Set<string>(), SetType(StringType));
        $.for(pages, ($2, _entry, key) => {
            $2.if(key.project.equal(project), ($3) => {
                $3(taken.insert(key.page));
            });
        });

        const onQuery = $.const(East.function([StringType], NullType, ($2, text) => {
            $2(searched.write(text));
        }));
        const onSort = $.const(East.function([StudioLibrarySortType], NullType, ($2, next) => {
            $2(ordered.write(next));
        }));
        const onLayout = $.const(East.function([Library.Types.Layout], NullType, ($2, next) => {
            $2(laid.write(next));
        }));
        const onProject = $.const(East.function([StringType], NullType, ($2, next) => {
            $2(shown.write(next));
        }));
        const onPopover = $.const(East.function([StudioLibraryPopoverType], NullType, ($2, next) => {
            $2(popover.write(next));
        }));
        // A page opens in the builder, with nothing selected, and the host is told.
        const onOpen = $.const(East.function([StringType], NullType, ($2, name) => {
            const key = $2.let({ project, page: name }, StudioKeyType);
            $2(open.write(key));
            $2(selection.write(SnapGrid.uiState()));
            $2(tellHost(key));
        }));
        // A template's card starts a new page from it, Blank grid's from
        // nothing, and the dashed card from nothing too — each opening the
        // popover under the New page button.
        const startFrom = $.const(East.function([StringType], NullType, ($2, name) => {
            $2(popover.write(variant("open", name)));
        }));
        const startBlank = $.const(East.function([], NullType, ($2) => {
            $2(popover.write(variant("open", "")));
        }));
        // A new page: one commit inserting it, its draft the template's placements.
        const onCreate = $.const(East.asyncFunction([StudioLibraryNewPageType], OptionType(StringType), ($2, request) => {
            const key = $2.let({ project, page: request.name }, StudioKeyType);
            const from = $2.let(request.template.match({
                some: (_$3, name) => East.value(some({ project, page: name }), OptionType(StudioKeyType)),
                none: (_$3) => East.value(none, OptionType(StudioKeyType)),
            }), OptionType(StudioKeyType));
            const outcome = $2.let(record.commit.patch("", StudioPages.newPage(pages, key, request.name, from)));
            return nameWriteRefusal(outcome, request.name);
        }));

        const templatesView = $.const(East.function([], UIComponentType, (_$2) => Library.Root(templateRows, {
            id: `${own}.templates`,
            variant: "gallery",
            toolbar: false,
            item: (t) => ({
                key: t.name,
                label: t.title,
                sublabel: t.summary,
                media: SnapGrid.Root(t.cells, {
                    variant: "wireframe",
                    cell: (c) => SnapGrid.cell({
                        key: c.key, row: c.row, span: c.span,
                        // At a twelfth of the page's scale; a content-height placement a KPI's.
                        height: some(c.height.match({ some: (_$3, px) => px.divide(12n), none: (_$3) => East.value(12n) })),
                        content: Text.Root(c.component),
                    }),
                }),
                draggable: false,
            }),
            onCardClick: startFrom,
            style: { columns: 4n, mediaSize: "80px" },
        })));
        const pagesView = $.const(East.function([], UIComponentType, (_$2) => Library.Root(pageRows, {
            id: `${own}.pages`,
            variant: "gallery",
            toolbar: false,
            layout,
            item: (p) => ({
                key: p.page,
                label: p.title,
                sublabel: p.cells.size().equal(1n).ifElse(
                    () => East.value("1 component"),
                    () => East.str`${East.print(p.cells.size())} components`,
                ),
                status: p.live.ifElse(
                    () => some(Library.status("Live", "success")),
                    () => some(Library.status("Draft", "neutral", true)),
                ),
                media: SnapGrid.Root(p.cells, {
                    variant: "wireframe",
                    cell: (c) => SnapGrid.cell({
                        key: c.key, row: c.row, span: c.span,
                        height: some(c.height.match({ some: (_$3, px) => px.divide(12n), none: (_$3) => East.value(12n) })),
                        content: Text.Root(c.component),
                    }),
                }),
                action: "Open in builder →",
                draggable: false,
            }),
            onCardClick: onOpen,
            addLabel: "New page from template",
            onAdd: startBlank,
            style: { columns: 2n, mediaPlacement: "start", mediaSize: "156px" },
        })));

        return StudioLibraryComponent.Root({
            project,
            projects: libraryProjects(pages, home),
            pages: paneRows,
            current: openKey.project.equal(project).ifElse(() => openKey.page, () => East.value("")),
            templates: everyTemplate.map((_$2, t) => ({ name: t.name, title: t.title })),
            taken,
            counts: { pages: everyPage.size(), templates: everyTemplate.size().add(1n), shownPages: pageRows.size() },
            query,
            sort,
            layout,
            popover: popover.read(),
            templatesView,
            pagesView,
            onQuery,
            onSort,
            onLayout,
            onProject,
            onOpen,
            onPopover,
            onCreate,
        });
    }));
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Library>` — a project's templates and pages, and where new
 * pages start. See {@link createLibrary}.
 */
export const StudioLibrary: JsxTag<OptionsProps<typeof createLibrary>> = optionsTag(createLibrary);
