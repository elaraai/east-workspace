/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Library>` (#997) — a project's templates and pages, and where
 * new pages start.
 *
 * The page library is a component of its own, apart from the builder: an
 * interface — the pages record bound with its patch, the listed components,
 * the project it shows first, the builder it opens pages in, and who to tell —
 * which the `StudioLibrary` renderer draws, headerless with one toolbar: the
 * search over both rows, Sort · Name, the pages' Grid · List and the primary
 * "+ New page in <project>"; beside it the projects the record holds and the
 * project's pages; under it the Templates — Blank grid, then the project's
 * templates — and the Pages, each card a wireframe of its layout.
 *
 * A new page — from the toolbar's button, the dashed last card or a template's
 * card — takes a name and a template, and is one commit on the record.
 * "Open in builder →" opens a page in the builder: it writes the builder's
 * open page ({@link builderKeys}) and tells the host.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
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
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { StudioComponentType } from "./component.js";
import { StudioCellType, StudioKeyType, StudioPagesHandleType, StudioPagesType, pageStatus, type StudioPagesHandle } from "./pages.js";

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
 * The `StudioLibrary` renderer's payload — the page library's interface.
 *
 * @property pages - The pages record, bound with its patch — what it reads, and a new page commits through
 * @property components - The components the surface lists — what a layout's summary names
 * @property project - The project it shows first
 * @property id - Names the builder whose open page it writes; `none` for the one builder
 * @property onOpen - Told when a page opens in the builder, with its key — the host shows the builder
 */
export const StudioLibraryPayloadType = StructType({
    pages: StudioPagesHandleType,
    components: ArrayType(StudioComponentType),
    project: StringType,
    id: OptionType(StringType),
    onOpen: OptionType(FunctionType([StudioKeyType], NullType)),
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
 * The project shown, the search, the order and the Pages row's layout are the
 * page library's own; the page it opens is the builder's, shared by `id` with
 * a `<Studio.Builder>`. The page library draws no border around itself.
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
 * // The page library: the project's pages and templates, and where new pages start.
 * export const library = ui("library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const pages      = $.let(Record.bind(d.pages, [d.pagesPatch]));
 *         return <Studio.Library pages={pages} components={components} project="Ops console" />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: StudioLibraryOptions): ExprType<UIComponentType> {
    return StudioLibraryComponent.Root({
        pages: { read: options.pages.read, history: options.pages.history, commit: { patch: options.pages.commit.patch } },
        components: options.components,
        project: options.project,
        id: options.id === undefined ? none : some(options.id),
        onOpen: options.onOpen === undefined ? none : some(options.onOpen),
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Library>` — a project's templates and pages, and where new
 * pages start. See {@link createLibrary}.
 */
export const StudioLibrary: JsxTag<OptionsProps<typeof createLibrary>> = optionsTag(createLibrary);
