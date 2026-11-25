/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Studio.Library>` (#997, #1762) — the pages and the templates as cards, in
 * a grid its rail narrows, and where new pages start.
 *
 * The page library is a component of its own, apart from the builder: an
 * interface — the rail's chrome over its `slice`, whose `rows` source pages
 * the pages and whose `templates` source, where it has one, the templates, each
 * from the pages record through its indexes; the record's patch write, which a
 * new page is one commit through; the listed components, which a layout's
 * summary names; the project a new page starts in; the page open in the
 * builder; and who to tell when another is asked for — which the
 * `StudioLibrary` renderer draws in a `BuilderFrame`: one toolbar holding
 * Pages · Templates, the rail and New page, over the cards. It has no pane.
 *
 * It reads the record a window at a time, through the slice, and never whole.
 * A page's card, and a new page once it commits, tell the host (`onOpen`),
 * which shows the page in its builder: the page library opens nothing itself,
 * and shares no store entry with a builder (#1668).
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
    StringType,
    StructType,
    none,
    some,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import {
    EastUI,
    RecordSlicesChromeType,
    optionsTag,
    type JsxTag,
    type OptionsProps,
    type RecordSlicesChromeOptions,
    type UIComponentType,
} from "@elaraai/east-ui/internal";
import { RecordOutcomeType } from "../bind/record.js";
import { libraryRows, librarySlice, sliceSourceScopes } from "../utils/record-sources.js";
import { StudioComponentType, componentNames } from "./component.js";
import { viewWords } from "./content.js";
import { StudioCellType, StudioEntryType, StudioKeyType, StudioPagesHandleType, type StudioPagesHandle } from "./pages.js";

// ============================================================================
// Types
// ============================================================================

/**
 * The pages record's patch write, as the page library takes it from the
 * record's `Record.bind` handle: what a new page is one commit through. The
 * page library reads the record through its slice alone, a window at a time,
 * so it takes nothing else of the handle.
 *
 * @property commit - The record's patch write, awaited: a request id and the patch, answered by the outcome
 */
export const StudioPagesWriteType = StructType({
    commit: StudioPagesHandleType.fields.commit,
});

/** Type representing the pages record's patch write. */
export type StudioPagesWriteType = typeof StudioPagesWriteType;

/**
 * The `StudioLibrary` renderer's payload — the page library's interface.
 *
 * @property pages - The pages record's patch write — what a new page commits through
 * @property slice - The rail's chrome: the narrowing of the pages and the templates, whose `rows` and `templates` sources the renderer pages its cards through
 * @property components - The components the surface lists — what a layout's summary names
 * @property project - The project a new page starts in while the rail has chosen none
 * @property page - The page open in the builder, whose card is marked; `none`, no card is marked
 * @property onOpen - Told when a page is asked for, and when a new page commits, with its key — the host shows it in its builder
 * @property id - Keeps the library's frame apart from another's on its surface; `none` for the one library
 */
export const StudioLibraryPayloadType = StructType({
    pages: StudioPagesWriteType,
    slice: RecordSlicesChromeType,
    components: ArrayType(StudioComponentType),
    project: StringType,
    page: OptionType(StudioKeyType),
    onOpen: FunctionType([StudioKeyType], NullType),
    id: OptionType(StringType),
});

/** Type representing the `StudioLibrary` renderer's payload. */
export type StudioLibraryPayloadType = typeof StudioLibraryPayloadType;

// ============================================================================
// What the page library shows
// ============================================================================

/** What a layout places of one thing: the words it is shown in, and how many. */
const PlacedType = StructType({ words: StringType, count: IntegerType });

/**
 * What a layout places, as its card's meta line says: each component's name,
 * a visual by its view ("Column chart") and a text block as "Text", counted
 * when placed more than once — "KPI rail ×4 · Revenue trend" — in the order
 * they first appear. A component the surface does not list is named by its
 * key.
 *
 * @remarks
 * Placements are counted by what they are — a component by its key, a visual
 * by its view, a text block — never by the words they are shown in: two
 * components of one name are two entries, and a component named "Text" is
 * none of the text blocks.
 */
export const layoutSummary = East.function(
    [ArrayType(StudioComponentType), ArrayType(StudioCellType)],
    StringType,
    ($, components, cells) => {
        const listed = $.let(componentNames(components));
        const order = $.let([], ArrayType(StringType));
        const placed = $.let(new Map(), DictType(StringType, PlacedType));
        $.for(cells, ($2, cell) => {
            // What it is, told from every other kind of content by its prefix; and the words it is shown in.
            const identity = $2.let(cell.content.match({
                component: (_$3, key) => East.str`component:${key}`,
                visual: (_$3, visual) => East.str`visual:${viewWords(visual.view)}`,
                text: (_$3) => East.value("text"),
            }));
            const words = $2.let(cell.content.match({
                component: (_$3, key) => listed.tryGet(key).match({
                    some: (_$4, name) => name,
                    none: (_$4) => key,
                }),
                visual: (_$3, visual) => viewWords(visual.view),
                text: (_$3) => East.value("Text"),
            }));
            $2.if(placed.has(identity).not(), ($3) => {
                $3(order.pushLast(identity));
            });
            $2(placed.insertOrUpdate(identity, { words, count: 1n }, (_$3, held) => ({ words: held.words, count: held.count.add(1n) })));
        });
        const parts = $.let([], ArrayType(StringType));
        $.for(order, ($2, identity) => {
            const held = $2.let(placed.get(identity));
            $2(parts.pushLast(held.count.greater(1n).ifElse(
                () => East.str`${held.words} ×${East.print(held.count)}`,
                () => held.words,
            )));
        });
        return parts.stringJoin(" · ");
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
 * @property pages - The pages record, bound — `Record.bind(pages)`: its patch write, which a new page commits through
 * @property slice - The narrowing: `{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(pages, { indexes }), scope: { kind: ["page"] }, … }, templates: { …, scope: { kind: ["template"] } } }) }`
 * @property components - The components the surface lists — what a layout's summary names
 * @property project - The project a new page starts in while the rail has chosen none
 * @property page - The page open in the builder, whose card is marked
 * @property onOpen - Told when a page is asked for, and when a new page commits, with its key — the host shows it in its builder
 * @property id - Keeps the library's frame apart from another's, when a surface holds two
 */
export interface StudioLibraryOptions {
    /** The pages record, bound — `Record.bind(pages)`: its patch write, which a new page commits through. The page library never reads it whole. */
    pages: StudioPagesHandle;
    /**
     * The narrowing, and where the cards come from: `slice={{ slice }}` over
     * `Slice.bindRecords(key, { rows: { source: Data.bindPaged(pages, {
     * indexes: [...] }), scope: { kind: ["page"] }, … }, templates: { source,
     * scope: { kind: ["template"] }, … } })`. Its `rows` source is the pages
     * and its `templates` source, which it may leave out, the templates — each
     * paged from the pages record through its indexes, and scoped by what an
     * entry is. Its rail — one, in the toolbar — narrows them: by the start of a
     * title, by project, by tag. `Slice.bind` and `Slice.bindRecord` are
     * refused.
     */
    slice: RecordSlicesChromeOptions;
    /** The components the surface lists — what a layout's summary names. */
    components: SubtypeExprOrValue<ArrayType<StudioComponentType>>;
    /** The project a new page starts in while the rail has chosen none: what New page's popover offers. */
    project: SubtypeExprOrValue<StringType>;
    /** The page open in the builder, whose card is marked — the value the host gives its builder's `page`. Omitted, no card is marked. */
    page?: SubtypeExprOrValue<StudioKeyType>;
    /**
     * Told when a page's card is pressed, and when a new page commits, with
     * the page's key. The host shows it in its builder: it navigates, or writes
     * the state its builder's `page` reads. The page library opens nothing
     * itself.
     */
    onOpen: SubtypeExprOrValue<FunctionType<[StudioKeyType], NullType>>;
    /** Keeps the library's frame apart from another's — needed only when one surface holds two. */
    id?: string;
}

/** How a refusal writes the slice a page library takes. */
const SLICE_CALL = "slice={{ slice: Slice.bindRecords(key, { rows: { source: Data.bindPaged(pages, { indexes: [...] }), scope: { kind: [\"page\"] }, … }, " +
    "templates: { source: …, scope: { kind: [\"template\"] }, … } }) }}";

/** What each source lists, by its name: the entries of one kind. */
const KINDS: Readonly<Record<string, string>> = { rows: "page", templates: "template" };

/**
 * The project's pages and templates, as cards in a grid, and where new pages
 * start.
 *
 * @remarks
 * - **The toolbar**, one row: Pages · Templates, where `slice` has a
 *   `templates` source; the rail — the fields the shown view's source lists,
 *   its search, its presets and `N of M pages` — then New page, which follows
 *   the rail: with one project chosen it reads "New page in Ops console" and
 *   starts there; otherwise its popover asks for the project, offering
 *   `project`.
 * - **The cards**, a grid as many across as fit: a page, or a template, a
 *   card, read a window at a time in the order e3 returns them — a wireframe
 *   of its layout; its title; what it places, "KPI rail ×2 · Revenue trend";
 *   its tags; and its project and how many components it places. A press on a
 *   page's card asks the host for it, and the page the host says is open is
 *   marked; a press on a template's card opens New page, starting from it.
 *   Nothing says Live or Draft.
 * - **A new page** takes a name, its project where the rail has chosen none,
 *   and tags, in a popover under New page, and is one commit through the
 *   record's patch write: its layout a template's, or a blank grid. A name the
 *   project holds, a page's or a template's, is refused by the commit, in the
 *   popover. Once it commits, the host is told the new page.
 *
 * The open page is the host's, which gives it to the page library and to its
 * `<Studio.Builder>` as `page` and changes it in `onOpen`. The two are surfaces
 * of their own — a `ui()` each: the library pages the record, and a surface
 * that pages a record never loads it whole, which the builder does. The page
 * library draws no border around itself.
 *
 * @param options - The bound record, the slice, the listed components, the project, the open page, who to tell and the library's name ({@link StudioLibraryOptions})
 * @returns An East expression of type `UIComponentType`
 * @throws {Error} When `slice` is left out, is not `{ slice: Slice.bindRecords(…) }`, has no `rows` source or one beside it other than `templates`, or a source does not page the pages record's entries scoped by what an entry is
 *
 * @example
 * ```tsx
 * import { East, NullType } from "@elaraai/east";
 * import { Reactive, Slice, State, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Record, Studio, ui } from "@elaraai/e3-ui";
 *
 * // The page library: the pages and the templates as cards, narrowed by its rail. The surface holds the open page,
 * // which its builder — a surface of its own — shows.
 * export const library = ui("library", [], East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const components = $.let([kpiRail, revenueTrend, breakdownBars]);
 *         const pages      = $.let(Record.bind(d.pages));
 *         const rows       = $.let(Data.bindPaged(d.pages, { indexes: ["pages_by_kind", "pages_by_kind_project", "pages_by_kind_tag", "pages_by_kind_title"] }));
 *         const slice      = $.let(Slice.bindRecords("ops.library", {
 *             rows:      { source: rows, label: "Pages", scope: { kind: ["page"] }, search: ["title", "project", "tags"],
 *                          fields: { title: { label: "Name" }, project: { label: "Project" }, tags: { label: "Tag" } } },
 *             templates: { source: rows, label: "Templates", scope: { kind: ["template"] }, search: ["title"], fields: { title: { label: "Name" } } },
 *         }));
 *         const open       = $.let(State.bind([Studio.Types.Key], "studio.open", { project: "Ops console", page: "Overview" }));
 *         const go         = $.const(East.function([Studio.Types.Key], NullType, ($2, key) => { $2(open.write(key)); }));
 *         return <Studio.Library pages={pages} components={components} project="Ops console" slice={{ slice }}
 *             page={open.read()} onOpen={go} />;
 *     }}</Reactive>
 * )));
 * ```
 */
function createLibrary(options: StudioLibraryOptions): ExprType<UIComponentType> {
    // The slice's sources are the pages and the templates: a source beside them is refused, naming it.
    const { slice, sources, chrome } = librarySlice(options.slice as RecordSlicesChromeOptions | undefined, {
        builder: "Studio.Library", names: ["rows", "templates"], what: "the pages and the templates", call: SLICE_CALL, cards: "the pages and the templates",
    });
    for (const name of sources.names) {
        libraryRows(slice, name, {
            builder: "Studio.Library", call: SLICE_CALL, row: StudioEntryType, key: StudioKeyType,
            rows: "the pages record's entries", record: "the pages record, of Studio.Types.Pages",
        });
        // Each source lists one kind of entry: the pages, or the templates.
        if (!sliceSourceScopes(slice, name).includes("kind")) {
            throw new Error(`Studio.Library: \`slice\`'s \`${name}\` source lists the ${KINDS[name]}s alone — scope it by what an entry is, ` +
                `scope: { kind: ["${KINDS[name]}"] }: ${SLICE_CALL}`);
        }
    }
    return StudioLibraryComponent.Root({
        pages: { commit: { patch: options.pages.commit.patch } },
        slice: chrome,
        components: options.components,
        project: options.project,
        page: options.page === undefined ? none : some(options.page),
        onOpen: options.onOpen,
        id: options.id === undefined ? none : some(options.id),
    });
}

// ============================================================================
// Tag
// ============================================================================

/**
 * `<Studio.Library>` — the pages and the templates as cards, in a grid its rail
 * narrows, and where new pages start. See {@link createLibrary}.
 */
export const StudioLibrary: JsxTag<OptionsProps<typeof createLibrary>> = optionsTag(createLibrary);
