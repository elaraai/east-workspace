/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages (#992) — the type of the one record a solution declares,
 * the patch every operator action writes it with, and the change list.
 *
 * The Studio exports types; the solution declares its storage like any record,
 * with one write, a patch, the indexes a page lists its entries by, and the
 * step that carries a record an earlier release wrote:
 *
 * ```ts
 * export const pages = e3.record("pages", Studio.Types.Pages, {
 *     initial: Studio.value([]),
 *     mutations: (mutation) => ({
 *         patch: mutation.patch(),
 *     }),
 *     indexes: (index) => ({
 *         pages_by_kind: index.on(["kind"]),
 *         pages_by_kind_project: index.on(["kind", "project"]),
 *         pages_by_kind_tag: index.on(["kind", "tags"]),
 *         pages_by_kind_title: index.on(["kind", "title"]),
 *     }),
 *     migrations: (migration) => [migration.rows("entry_fields", Studio.migrations.entryFields)],
 * });
 * ```
 *
 * Save, publish, revert, a new page and save-as-template are each one patch
 * through it, computed in East as the diff of the one entry it writes, before
 * and after. A patch carries what it changes as it was, so a write that meets
 * what another write changed since it was drafted fails the record's check and
 * names the page, and nothing is overwritten. The type never depends on the
 * components, so a deploy that adds, changes or removes one runs no migration.
 *
 * An entry is a struct (#1759): what it is — a page or a template — its
 * project, its title and its tags as fields of its own, beside its layout and
 * its published version, so a page lists the entries in columns and narrows
 * them by an index. Each index is led by `kind`, so the pages and the
 * templates are read apart; the one on `kind` alone is how an entry is found
 * among its kind's by its key.
 *
 * An entry's project is its key's and its title its layout's. Every write that
 * builds an entry whole builds it through {@link studioEntry} — a new page, a
 * template saved, a publish, a revert, and `Studio.value` for the entries a
 * solution ships — and a Save changes its placements or its starting filters
 * alone. A writer of the solution's own — a seed written by hand, a reducer —
 * keeps the two as they are: where one leaves them apart, a Save reaches
 * neither, and the next publish or revert puts them back.
 *
 * A placement holds its content (#1669): a component's key, a visual an
 * operator builds, or a text block. A page holds its starting filters too
 * (#1673): the filters every reader of it starts with, which its builder sets
 * over its canvas and saves with it. A record an earlier release wrote is
 * carried by the steps of `Studio.migrations`: `entryFields`, for entries that
 * held no fields of their own — listed alone, as above, by a record that never
 * listed a step, and after `cellContent` by one that listed that step, for
 * placements that held a component's key alone (`studio/migrations.ts`).
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    DictType,
    East,
    FunctionType,
    IntegerType,
    JqType,
    NullType,
    OptionType,
    PatchType,
    type PatchTypeOf,
    SetType,
    StringType,
    StructType,
    VariantType,
    none,
    some,
    variant,
    type ExprType,
} from "@elaraai/east";
import { Editing, SnapGrid } from "@elaraai/east-ui/internal";
import { RecordCommitInfoType } from "@elaraai/e3-types";
import { Record, RecordOutcomeType } from "../bind/record.js";
import { keptTags } from "../utils/tags.js";
import { StudioContentType, contentChange } from "./content.js";
import { StudioKeyType } from "./key.js";

export { StudioKeyType };

// ============================================================================
// Types
// ============================================================================

/**
 * One placement on a page: what it holds, and where it sits on the
 * 12-column grid.
 *
 * @remarks
 * Rows order by their first appearance among the cells, and the cells of a row
 * by their order in the page's `cells` — the SnapGrid's own layout, so a page's
 * cells are the rows the canvas edits.
 *
 * @property key - The placement's identity on the page
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; `none` is its content's height
 * @property align - Where it sits in a taller row
 * @property title - Its title; `none` is its content's own name: its component's, or one made from its visual's view
 * @property content - What it holds: a component's key, a visual or a text block
 */
export const StudioCellType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: SnapGrid.Types.Align,
    title: OptionType(StringType),
    content: StudioContentType,
});

/** Type representing one placement on a page. */
export type StudioCellType = typeof StudioCellType;

/**
 * One of a page's starting filters (#1673): a condition every visual of one
 * source reads through until its reader changes it — what every reader's
 * filters of the page start as, saved with the page.
 *
 * @property key - Its identity on the page, which the builder's editing session keys it by
 * @property source - The key of a listed source
 * @property where - A jq condition over one of its rows
 */
export const StudioPageFilterType = StructType({
    key: StringType,
    source: StringType,
    where: JqType,
});

/** Type representing one of a page's starting filters. */
export type StudioPageFilterType = typeof StudioPageFilterType;

const StudioPageTypeImpl = StructType({
    title: StringType,
    cells: ArrayType(StudioCellType),
    filters: ArrayType(StudioPageFilterType),
});
type StudioPageTypeImpl = typeof StudioPageTypeImpl;

/**
 * Type representing a page's layout.
 *
 * @remarks
 * An interface, so a type that mentions it refers to it by name in
 * declaration output rather than spelling it out: a placement's content is a
 * deep type, and a patch of it deeper, past the length TypeScript will
 * serialize (TS7056) and costly for every reader to hold spelled out.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioPageType extends StudioPageTypeImpl {}

/**
 * A page's layout: its title, its placements and its starting filters.
 *
 * @property title - The page's title
 * @property cells - Its placements, in the order the canvas holds them
 * @property filters - Its starting filters, in the order they were added: what every reader's filters of it start as (#1673)
 */
export const StudioPageType: StudioPageType = StudioPageTypeImpl;

/**
 * A published version of a page.
 *
 * @property version - Its number, counting up from 1
 * @property page - The layout it published
 */
export const StudioLiveType = StructType({
    version: IntegerType,
    page: StudioPageType,
});

/** Type representing a published version of a page. */
export type StudioLiveType = typeof StudioLiveType;

/**
 * What an entry of the pages record is.
 *
 * @property page - A page: drafted in the builder, and published
 * @property template - A layout saved from a page, which new pages start from
 */
export const StudioEntryKindType = VariantType({
    page: NullType,
    template: NullType,
});

/** Type representing what an entry of the pages record is. */
export type StudioEntryKindType = typeof StudioEntryKindType;

const StudioEntryTypeImpl = StructType({
    kind: StudioEntryKindType,
    project: StringType,
    title: StringType,
    tags: SetType(StringType),
    draft: StudioPageType,
    live: OptionType(StudioLiveType),
});
type StudioEntryTypeImpl = typeof StudioEntryTypeImpl;

/**
 * Type representing one entry of the pages record.
 *
 * @remarks
 * An interface, so a type that mentions it refers to it by name in
 * declaration output rather than spelling it out: a placement's content is a
 * deep type, and a patch of it deeper, past the length TypeScript will
 * serialize (TS7056) and costly for every reader to hold spelled out.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioEntryType extends StudioEntryTypeImpl {}

/**
 * One entry of the pages record: a page or a template, with the fields a page
 * lists and narrows the entries by (#1759).
 *
 * @property kind - What it is: a page or a template
 * @property project - Its project: its key's
 * @property title - Its title: its layout's
 * @property tags - What a person tagged it, each a word or two to find it by
 * @property draft - A page's layout as last saved; a template's layout
 * @property live - A page's published version, `none` until its first publish; a template has none
 */
export const StudioEntryType: StudioEntryType = StudioEntryTypeImpl;

const StudioPagesTypeImpl = DictType(StudioKeyType, StudioEntryType);
type StudioPagesTypeImpl = typeof StudioPagesTypeImpl;

/**
 * Type representing the pages record.
 *
 * @remarks
 * An interface, so a type that mentions it refers to it by name in
 * declaration output rather than spelling it out: a placement's content is a
 * deep type, and a patch of it deeper, past the length TypeScript will
 * serialize (TS7056) and costly for every reader to hold spelled out.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioPagesType extends StudioPagesTypeImpl {}

/**
 * The pages record's type — every page and template, by key. A solution
 * declares its record with it: `e3.record("pages", Studio.Types.Pages, {
 * initial: Studio.value([…]), mutations: …, indexes: …, migrations: … })`, its
 * one mutation a patch, its indexes each led by `kind`, and the step that
 * carries a record an earlier release wrote — the module docs spell it out.
 */
export const StudioPagesType: StudioPagesType = StudioPagesTypeImpl;

/**
 * Type representing the pages record's patch.
 *
 * @remarks
 * An interface over the patch's type by name, so a type that mentions it
 * refers to it by name in declaration output rather than spelling it out: a
 * patch of a placement's content is a deep type, past the length TypeScript
 * will serialize (TS7056) and costly for every reader to hold spelled out.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioPagesPatchType extends PatchTypeOf<StudioPagesType> {}

/** The pages record's patch — what every write is. */
export const StudioPagesPatchType: StudioPagesPatchType = PatchType(StudioPagesType);

/**
 * Type representing a batch of the canvas's edits to a page's placements.
 *
 * @remarks
 * An interface, for the reason {@link StudioPagesPatchType} is one.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioCellChangesType extends ReturnType<typeof Editing.Types.ChangeSet<StudioCellType>> {}

/** A batch of the canvas's edits to a page's placements — what its Apply sends ({@link saveCells}). */
export const StudioCellChangesType: StudioCellChangesType = Editing.Types.ChangeSet(StudioCellType);

/**
 * Type representing a batch of the builder's edits to a page's starting filters.
 *
 * @remarks
 * An interface, for the reason {@link StudioPagesPatchType} is one: a jq condition is a deep type.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioPageFilterChangesType extends ReturnType<typeof Editing.Types.ChangeSet<StudioPageFilterType>> {}

/** A batch of the builder's edits to a page's starting filters — what their Apply sends ({@link saveFilters}). */
export const StudioPageFilterChangesType: StudioPageFilterChangesType = Editing.Types.ChangeSet(StudioPageFilterType);

const StudioPagesHandleTypeImpl = StructType({
    read: FunctionType([], StudioPagesType),
    history: FunctionType([], OptionType(ArrayType(RecordCommitInfoType))),
    commit: StructType({
        patch: AsyncFunctionType([StringType, StudioPagesPatchType], RecordOutcomeType),
    }),
});
type StudioPagesHandleTypeImpl = typeof StudioPagesHandleTypeImpl;

/**
 * Type representing the bound pages record.
 *
 * @remarks
 * An interface, so a type that mentions it refers to it by name in
 * declaration output rather than spelling it out: a placement's content is a
 * deep type, and a patch of it deeper, past the length TypeScript will
 * serialize (TS7056) and costly for every reader to hold spelled out.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the empty interface is the point: it attaches a symbol the declaration emitter can reference by name
export interface StudioPagesHandleType extends StudioPagesHandleTypeImpl {}

/**
 * The pages record, bound with its patch — what the builder and the page
 * library read and write through: the bound record's `read`, its `history`,
 * and its patch write awaited. Their factories take these from
 * `Record.bind(pages)`.
 *
 * @property read - The record's current state
 * @property history - Its commit chain, newest first — who changed a page last, for a conflict's words
 * @property commit - Its patch write, awaited: a request id and the patch, answered by the outcome
 */
export const StudioPagesHandleType: StudioPagesHandleType = StudioPagesHandleTypeImpl;

/**
 * The pages record as the Studio's factories take it — a `Record.bind(pages,
 * [pagesPatch])` handle, whose `read`, `history` and patch write they pass on
 * ({@link StudioPagesHandleType}).
 */
export type StudioPagesHandle = ExprType<StructType<{
    read: FunctionType<[], StudioPagesType>;
    history: FunctionType<[], OptionType<ArrayType<typeof RecordCommitInfoType>>>;
    commit: StructType<{ patch: AsyncFunctionType<[typeof StringType, StudioPagesPatchType], RecordOutcomeType> }>;
}>>;

/**
 * One change to a placement.
 *
 * @property cell - The placement's key
 * @property content - What it holds, in the later layout where both hold it
 * @property detail - What changed, such as "row 2 · span 4" or "span 12 → 8"
 */
export const StudioCellChangeType = StructType({
    cell: StringType,
    content: StudioContentType,
    detail: StringType,
});

/** Type representing one change to a placement. */
export type StudioCellChangeType = typeof StudioCellChangeType;

/**
 * One change between two layouts of a page, as {@link pageChanges} lists them.
 *
 * @property filters - Its starting filters changed (#1673): how many it starts with, `0 → 2`, or that they changed
 * @property added - Placed on the page — its row and span
 * @property removed - Taken off the page — the row and span it had
 * @property moved - Moved into another row or a new one, with its row among the rows, or to another place in its row
 * @property resized - Its span changed
 * @property height - Its height changed; `auto` is its content's height
 * @property aligned - Where it sits in a taller row changed
 * @property retitled - Its title changed; `default` is its content's own name
 * @property configured - What it holds changed: a visual's source, view, values, filter or click; a text block's text; or another component
 */
export const StudioChangeType = VariantType({
    filters: StructType({ detail: StringType }),
    added: StudioCellChangeType,
    removed: StudioCellChangeType,
    moved: StudioCellChangeType,
    resized: StudioCellChangeType,
    height: StudioCellChangeType,
    aligned: StudioCellChangeType,
    retitled: StudioCellChangeType,
    configured: StudioCellChangeType,
});

/** Type representing one change between two layouts of a page. */
export type StudioChangeType = typeof StudioChangeType;

/**
 * A page's status.
 *
 * @property live - Published, and its draft is the published layout
 * @property draft - Never published, or its draft has changes the site does not show
 */
export const StudioStatusType = VariantType({
    live: NullType,
    draft: NullType,
});

/** Type representing a page's status. */
export type StudioStatusType = typeof StudioStatusType;

// ============================================================================
// An entry, built
// ============================================================================

/**
 * An entry of the pages record, built: its project is its key's and its title
 * its layout's.
 *
 * @remarks
 * Every write that builds an entry whole builds it through this — a new page,
 * a template saved, a publish, a revert, and the entries a solution ships
 * (`Studio.value`) — so its project and its title are what its key and its
 * layout say, and the record's indexes on them list it where it is. A Save
 * changes an entry's placements or its starting filters alone
 * ({@link withDraft}).
 *
 * A template has no published version: one built with one is refused, naming
 * it, so no reader meets a template that says it is published.
 */
export const studioEntry = East.function(
    [StudioKeyType, StudioEntryKindType, StudioPageType, OptionType(StudioLiveType), SetType(StringType)],
    StudioEntryType,
    ($, key, kind, draft, live, tags) => {
        $.if(kind.hasTag("template").and(() => live.hasTag("some")), ($2) => {
            $2.error(East.str`${East.print(key)} is a template, and a template has no published version`);
        });
        return { kind, project: key.project, title: draft.title, tags, draft, live };
    },
);

/**
 * An entry with its layout replaced: its title follows it, and nothing else
 * changes. What a Save's two sides are built by — the entry as its rows were
 * read and as they are drafted — so its patch reaches the placements or the
 * starting filters it changes, and nothing else of the entry.
 */
const withDraft = East.function(
    [StudioEntryType, StudioPageType],
    StudioEntryType,
    (_$, entry, draft) => ({ kind: entry.kind, project: entry.project, title: draft.title, tags: entry.tags, draft, live: entry.live }),
);

// ============================================================================
// The writes — each one patch through the record's patch mutation
// ============================================================================

/**
 * Publishes a page: its live version becomes its draft, numbered one past the
 * version it replaces, or 1 the first time.
 *
 * @remarks
 * The entry is built whole ({@link studioEntry}). The patch changes the page's
 * live version alone, and carries it as it was: a publish drafted before
 * another one landed is a conflict naming the page. Where a writer of the
 * solution's own left the entry's project or its title apart from its key and
 * its layout, the patch puts them back too.
 */
export const publishPage = East.function(
    [StudioPagesType, StudioKeyType],
    StudioPagesPatchType,
    ($, pages, key) => {
        const entry = $.let(pages.tryGet(key).match({
            some: (_$, found) => found,
            none: ($2) => $2.error(East.str`No page ${East.print(key)}`),
        }), StudioEntryType);
        $.if(entry.kind.hasTag("template"), ($2) => {
            $2.error(East.str`${East.print(key)} is a template, not a page`);
        });
        const version = $.let(entry.live.match({
            some: (_$, live) => live.version.add(1n),
            none: (_$) => East.value(1n),
        }));
        const before = $.let(new Map(), StudioPagesType);
        $(before.insert(key, entry));
        const after = $.let(new Map(), StudioPagesType);
        const published = $.const(studioEntry);
        $(after.insert(key, published(key, entry.kind, entry.draft, some({ version, page: entry.draft }), entry.tags)));
        return East.diff(before, after);
    },
);

/**
 * Reverts a page: its draft becomes its live version's layout.
 *
 * @remarks
 * The patch carries the draft's cells it changes as they were, so a revert that
 * meets cells another save changed is a conflict naming the page.
 */
export const revertPage = East.function(
    [StudioPagesType, StudioKeyType],
    StudioPagesPatchType,
    ($, pages, key) => {
        const entry = $.let(pages.tryGet(key).match({
            some: (_$, found) => found,
            none: ($2) => $2.error(East.str`No page ${East.print(key)}`),
        }), StudioEntryType);
        $.if(entry.kind.hasTag("template"), ($2) => {
            $2.error(East.str`${East.print(key)} is a template, not a page`);
        });
        const live = $.let(entry.live.match({
            some: (_$, found) => found,
            none: ($2) => $2.error(East.str`${East.print(key)} has no published version to revert to`),
        }), StudioLiveType);
        const before = $.let(new Map(), StudioPagesType);
        $(before.insert(key, entry));
        const after = $.let(new Map(), StudioPagesType);
        const reverted = $.const(studioEntry);
        $(after.insert(key, reverted(key, entry.kind, live.page, entry.live, entry.tags)));
        return East.diff(before, after);
    },
);

/**
 * Starts a page: its draft is a layout's cells and starting filters — a
 * template's, as the page library read it — under the title given, or none at
 * all (the blank grid), with the tags given, kept as every record's tags are,
 * and no live version.
 *
 * @remarks
 * It reads nothing of the record: the page library reads it a window at a
 * time (#1762). The patch inserts the page, so a key another write took first
 * — a page's or a template's of the project — is a conflict naming it, which
 * is how a name the project holds is refused.
 */
export const newPage = East.function(
    [StudioKeyType, StringType, OptionType(StudioPageType), SetType(StringType)],
    StudioPagesPatchType,
    ($, key, title, template, tags) => {
        const from = $.let(template.match({
            some: (_$, layout) => layout,
            none: (_$) => East.value({ title, cells: [], filters: [] }, StudioPageType),
        }), StudioPageType);
        const before = $.let(new Map(), StudioPagesType);
        const after = $.let(new Map(), StudioPagesType);
        const entry = $.const(studioEntry);
        const kept = $.const(keptTags);
        $(after.insert(key, entry(key, variant("page", null), { title, cells: from.cells, filters: from.filters }, none, kept(tags))));
        return East.diff(before, after);
    },
);

/**
 * Saves a page's draft as a template, under a key of its own and the title
 * given — its placements and its starting filters, with no tags; the page
 * library lists it in its Templates row.
 *
 * @remarks
 * The patch inserts the template, so a key another write took first is a
 * conflict naming it.
 */
export const saveTemplate = East.function(
    [StudioPagesType, StudioKeyType, StudioKeyType, StringType],
    StudioPagesPatchType,
    ($, pages, from, key, title) => {
        $.if(pages.has(key), ($2) => {
            $2.error(East.str`${East.print(key)} already exists`);
        });
        const page = $.let(pages.tryGet(from).match({
            some: (_$, found) => found.kind.match({
                page: (_$2) => found.draft,
                template: ($2) => $2.error(East.str`${East.print(from)} is a template, not a page`),
            }),
            none: ($2) => $2.error(East.str`No page ${East.print(from)}`),
        }), StudioPageType);
        const before = $.let(new Map(), StudioPagesType);
        const after = $.let(new Map(), StudioPagesType);
        const entry = $.const(studioEntry);
        $(after.insert(key, entry(key, variant("template", null), { title, cells: page.cells, filters: page.filters }, none, new Set())));
        return East.diff(before, after);
    },
);

/** The cells of an entry: a page's draft's, or a template's. */
const draftCellsOf = East.function([StudioEntryType], ArrayType(StudioCellType), (_$, entry) => entry.draft.cells);

/** An entry with its cells replaced, and nothing else changed. */
const withDraftCells = East.function([StudioEntryType, ArrayType(StudioCellType)], StudioEntryType, ($, entry, cells) => {
    const replaced = $.const(withDraft);
    return replaced(entry, { title: entry.draft.title, cells, filters: entry.draft.filters });
});

/** The starting filters of an entry: a page's draft's, or a template's. */
const draftFiltersOf = East.function([StudioEntryType], ArrayType(StudioPageFilterType), (_$, entry) => entry.draft.filters);

/** An entry with its starting filters replaced, and nothing else changed. */
const withDraftFilters = East.function([StudioEntryType, ArrayType(StudioPageFilterType)], StudioEntryType, ($, entry, filters) => {
    const replaced = $.const(withDraft);
    return replaced(entry, { title: entry.draft.title, cells: entry.draft.cells, filters });
});

/**
 * Saves a page's placements: the builder canvas's Apply, which commits its
 * batch of placements to the page's draft as one patch.
 *
 * @remarks
 * `Record.onApply`'s form over a collection inside one entry — the draft's
 * cells, identified by `key`. The patch reaches the cells and nothing else,
 * and cells another write moved since the edit began are a conflict.
 */
export const saveCells = East.asyncFunction(
    [StudioPagesHandleType, StudioKeyType, StudioCellChangesType],
    Editing.Types.ApplyResult,
    ($, handle, key, batch) => {
        const apply = $.const(Record.onApply(handle, { entry: key, get: draftCellsOf, set: withDraftCells, idField: "key" }));
        return apply(batch);
    },
);

/**
 * Saves a page's starting filters (#1673): the builder's Apply of them, which
 * commits their batch to the page's draft as one patch.
 *
 * @remarks
 * `Record.onApply`'s form over a collection inside one entry — the draft's
 * starting filters, identified by `key` — as {@link saveCells} saves its
 * placements. The patch reaches the filters and nothing else, so a Save of
 * the placements beside it is none of its conflict, and filters another
 * write changed since the edit began are one.
 */
export const saveFilters = East.asyncFunction(
    [StudioPagesHandleType, StudioKeyType, StudioPageFilterChangesType],
    Editing.Types.ApplyResult,
    ($, handle, key, batch) => {
        const apply = $.const(Record.onApply(handle, { entry: key, get: draftFiltersOf, set: withDraftFilters, idField: "key" }));
        return apply(batch);
    },
);

// ============================================================================
// The reads
// ============================================================================

/**
 * Where a placement sits: its row's number, counting from 1 in the order rows
 * first appear, its place in the row counting from 1, and its place in
 * reading order counting from 0.
 */
const PlaceType = StructType({ row: IntegerType, position: IntegerType, order: IntegerType });

/** A layout's placements by key, and their keys in reading order. */
const LayoutType = StructType({
    places: DictType(StringType, PlaceType),
    order: ArrayType(StringType),
});

/** Where each placement of a layout sits, as the SnapGrid lays it out. */
const layoutOf = East.function([StudioPageType], LayoutType, ($, page) => {
    const numbers = $.let(new Map(), DictType(StringType, IntegerType));
    const rows = $.let(new Map(), DictType(IntegerType, ArrayType(StringType)));
    $.for(page.cells, ($2, cell) => {
        $2.if(numbers.has(cell.row).not(), ($3) => {
            $3(numbers.insert(cell.row, numbers.size().add(1n)));
            $3(rows.insert(numbers.get(cell.row), East.value([], ArrayType(StringType))));
        });
        $2(rows.get(numbers.get(cell.row)).pushLast(cell.key));
    });
    const places = $.let(new Map(), DictType(StringType, PlaceType));
    const order = $.let([], ArrayType(StringType));
    $.for(rows, ($2, keys, number) => {
        $2.for(keys, ($3, key, index) => {
            $3(places.insertOrUpdate(key, { row: number, position: index.add(1n), order: order.size() }, (_$4, existing) => existing));
            $3(order.pushLast(key));
        });
    });
    return { places, order };
});

/**
 * The changes from one layout of a page to another — what the builder counts
 * and the publish preview lists.
 *
 * @remarks
 * The page's starting filters come first — how many it starts with, or that
 * they changed — then each placement's changes in the later layout's reading
 * order, then the placements it no longer has. A placement moved when its row changed, or when
 * it left the longest run of placements still in their reading order, so a
 * move reports the placement moved and not the ones around it; which of two
 * placements that swapped places moved is ambiguous, and one is reported. A
 * placement whose content changed is configured, its detail saying what
 * changed in words; `sources` is each listed source's name, by its key, and
 * `components` each listed component's, which those words name a visual's
 * source and a component by.
 */
export const pageChanges = East.function(
    [StudioPageType, StudioPageType, DictType(StringType, StringType), DictType(StringType, StringType)],
    ArrayType(StudioChangeType),
    ($, before, after, sources, components) => {
        const layout = $.const(layoutOf);
        const was = $.let(layout(before));
        const now = $.let(layout(after));
        const cellsBefore = $.let(before.cells.toDict((_$2, cell) => cell.key, (_$2, cell) => cell, (_$2, existing) => existing));
        const cellsAfter = $.let(after.cells.toDict((_$2, cell) => cell.key, (_$2, cell) => cell, (_$2, existing) => existing));
        const rowsBefore = $.let(new Set<string>(), SetType(StringType));
        $.for(before.cells, ($2, cell) => {
            $2(rowsBefore.tryInsert(cell.row));
        });

        // The placements both layouts hold in the same row, in the later one's
        // reading order, and where each sat in the earlier one's. The longest
        // run whose earlier places still increase kept its order; the rest
        // moved. One that changed rows moved already, and is left out so it
        // cannot take a neighbour's place in the run.
        const common = $.let(now.order.filter((_$2, key) => cellsBefore.has(key)
            .and(() => East.equal(cellsBefore.get(key).row, cellsAfter.get(key).row))));
        const earlier = $.let(common.map((_$2, key) => was.places.get(key).order));
        const lengths = $.let(new Map(), DictType(IntegerType, IntegerType));
        const previous = $.let(new Map(), DictType(IntegerType, IntegerType));
        $.for(earlier, ($2, place, i) => {
            $2(lengths.insert(i, 1n));
            $2(previous.insert(i, -1n));
            $2.for(earlier, ($3, other, j) => {
                $3.if(j.less(i).and(() => other.less(place)).and(() => lengths.get(j).add(1n).greater(lengths.get(i))), ($4) => {
                    $4(lengths.update(i, lengths.get(j).add(1n)));
                    $4(previous.update(i, j));
                });
            });
        });
        const best = $.let(-1n);
        const longest = $.let(0n);
        $.for(lengths, ($2, length, i) => {
            $2.if(length.greater(longest), ($3) => {
                $3.assign(best, i);
                $3.assign(longest, length);
            });
        });
        const kept = $.let(new Set<string>(), SetType(StringType));
        $.for(earlier, ($2) => {
            $2.if(best.greaterEqual(0n), ($3) => {
                $3(kept.insert(common.get(best)));
                $3.assign(best, previous.get(best));
            });
        });

        const changes = $.let([], ArrayType(StudioChangeType));
        // The page's starting filters, before any placement's change (#1673).
        $.if(East.notEqual(before.filters, after.filters), ($2) => {
            const had = $2.let(before.filters.size());
            const has = $2.let(after.filters.size());
            $2(changes.pushLast(variant("filters", {
                detail: East.equal(had, has).ifElse(() => East.value("changed"), () => East.str`${East.print(had)} → ${East.print(has)}`),
            })));
        });
        $.for(now.order, ($2, key) => {
            const cell = $2.let(cellsAfter.get(key));
            const place = $2.let(now.places.get(key));
            $2.match(cellsBefore.tryGet(key), {
                none: ($3) => {
                    $3(changes.pushLast(variant("added", {
                        cell: key, content: cell.content,
                        detail: East.str`row ${East.print(place.row)} · span ${East.print(cell.span)}`,
                    })));
                },
                some: ($3, old) => {
                    const from = $3.let(was.places.get(key));
                    $3.if(East.notEqual(old.row, cell.row).or(() => kept.has(key).not()), ($4) => {
                        // Into another row, or a new one; its own row moved among
                        // the rows; or a new place in its row.
                        const detail = $4.let(East.notEqual(old.row, cell.row).ifElse(
                            () => rowsBefore.has(cell.row).ifElse(
                                () => East.str`row ${East.print(from.row)} → row ${East.print(place.row)}`,
                                () => East.str`row ${East.print(from.row)} → new row ${East.print(place.row)}`,
                            ),
                            () => East.equal(from.row, place.row).ifElse(
                                () => East.str`row ${East.print(place.row)} · position ${East.print(from.position)} → ${East.print(place.position)}`,
                                () => East.str`row ${East.print(from.row)} → row ${East.print(place.row)}`,
                            ),
                        ));
                        $4(changes.pushLast(variant("moved", { cell: key, content: cell.content, detail })));
                    });
                    $3.if(East.notEqual(old.span, cell.span), ($4) => {
                        $4(changes.pushLast(variant("resized", {
                            cell: key, content: cell.content,
                            detail: East.str`span ${East.print(old.span)} → ${East.print(cell.span)}`,
                        })));
                    });
                    $3.if(East.notEqual(old.height, cell.height), ($4) => {
                        const oldHeight = $4.let(old.height.match({ some: (_$5, px) => East.print(px), none: (_$5) => East.value("auto") }));
                        const newHeight = $4.let(cell.height.match({ some: (_$5, px) => East.print(px), none: (_$5) => East.value("auto") }));
                        $4(changes.pushLast(variant("height", { cell: key, content: cell.content, detail: East.str`height ${oldHeight} → ${newHeight}` })));
                    });
                    $3.if(East.notEqual(old.align, cell.align), ($4) => {
                        const oldAlign = $4.let(old.align.match({ top: (_$5) => East.value("top"), center: (_$5) => East.value("center"), stretch: (_$5) => East.value("stretch") }));
                        const newAlign = $4.let(cell.align.match({ top: (_$5) => East.value("top"), center: (_$5) => East.value("center"), stretch: (_$5) => East.value("stretch") }));
                        $4(changes.pushLast(variant("aligned", { cell: key, content: cell.content, detail: East.str`align ${oldAlign} → ${newAlign}` })));
                    });
                    $3.if(East.notEqual(old.title, cell.title), ($4) => {
                        const oldTitle = $4.let(old.title.match({ some: (_$5, text) => East.str`"${text}"`, none: (_$5) => East.value("default") }));
                        const newTitle = $4.let(cell.title.match({ some: (_$5, text) => East.str`"${text}"`, none: (_$5) => East.value("default") }));
                        $4(changes.pushLast(variant("retitled", { cell: key, content: cell.content, detail: East.str`title ${oldTitle} → ${newTitle}` })));
                    });
                    $3.if(East.notEqual(old.content, cell.content), ($4) => {
                        $4(changes.pushLast(variant("configured", { cell: key, content: cell.content, detail: contentChange(old.content, cell.content, sources, components) })));
                    });
                },
            });
        });
        $.for(was.order, ($2, key) => {
            $2.if(cellsAfter.has(key).not(), ($3) => {
                const cell = $3.let(cellsBefore.get(key));
                const place = $3.let(was.places.get(key));
                $3(changes.pushLast(variant("removed", {
                    cell: key, content: cell.content,
                    detail: East.str`row ${East.print(place.row)} · span ${East.print(cell.span)}`,
                })));
            });
        });
        return changes;
    },
);

/**
 * A page's status: live when it is published and its draft is the published
 * layout, and draft otherwise.
 */
export const pageStatus = East.function(
    [StudioEntryType],
    StudioStatusType,
    (_$, page) => page.live.match({
        some: (_$2, live) => East.equal(live.page, page.draft).ifElse(
            () => East.value(variant("live", null), StudioStatusType),
            () => East.value(variant("draft", null), StudioStatusType),
        ),
        none: (_$2) => East.value(variant("draft", null), StudioStatusType),
    }),
);

/** What the page functions are, on the internal `Studio` namespace — the builder's and the page library's, not a solution's. */
export interface StudioPagesNamespace {
    /** An entry of the pages record, built from its key, what it is, its layout, its published version and its tags ({@link studioEntry}). */
    entry: typeof studioEntry;
    /** Saves a page's placements — the builder canvas's Apply ({@link saveCells}). */
    save: typeof saveCells;
    /** Saves a page's starting filters — the builder's Apply of them ({@link saveFilters}). */
    saveFilters: typeof saveFilters;
    /** Publishes a page ({@link publishPage}). */
    publish: typeof publishPage;
    /** Reverts a page to its live version ({@link revertPage}). */
    revert: typeof revertPage;
    /** Starts a page, from a template's layout or blank, with its tags ({@link newPage}). */
    newPage: typeof newPage;
    /** Saves a page's draft as a template ({@link saveTemplate}). */
    saveTemplate: typeof saveTemplate;
    /** The changes from one layout of a page to another ({@link pageChanges}). */
    changes: typeof pageChanges;
    /** A page's status ({@link pageStatus}). */
    status: typeof pageStatus;
}

/** The page half of the internal `Studio` namespace. */
export const StudioPages: StudioPagesNamespace = {
    entry: studioEntry,
    save: saveCells,
    saveFilters,
    publish: publishPage,
    revert: revertPage,
    newPage,
    saveTemplate,
    changes: pageChanges,
    status: pageStatus,
};
