/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Studio's pages (#992) — the type of the one record a solution declares,
 * the patch every operator action writes it with, and the change list.
 *
 * The Studio exports types; the solution declares its storage like any record,
 * with one write, a patch:
 *
 * ```ts
 * export const pages      = e3.record("pages", Studio.Types.Pages, new Map());
 * export const pagesPatch = e3.mutation.patch(pages);
 * ```
 *
 * Save, publish, revert, a new page and save-as-template are each one patch
 * through it, computed in East as the diff of the one entry it writes, before
 * and after. A patch carries what it changes as it was, so a write that meets
 * what another write changed since it was drafted fails the record's check and
 * names the page, and nothing is overwritten. The type never depends on the
 * components, so a deploy that adds, changes or removes one runs no migration.
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
    PatchType,
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
import { SnapGrid } from "@elaraai/east-ui/internal";
import { Record } from "../bind/record.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A page's key: the project it belongs to, and its name in the project. A
 * project's pages are one contiguous run in key order.
 *
 * @property project - The project
 * @property page - The page's name in the project
 */
export const StudioKeyType = StructType({
    project: StringType,
    page: StringType,
});

/** Type representing a page's key. */
export type StudioKeyType = typeof StudioKeyType;

/**
 * One placement on a page: a component's key, where it sits on the 12-column
 * grid, and its code's fingerprint when the page was saved.
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
 * @property title - Its title; `none` is its component's name
 * @property component - The key of the component it places
 * @property fingerprint - Its component's fingerprint when the page was saved
 */
export const StudioCellType = StructType({
    key: StringType,
    row: StringType,
    span: IntegerType,
    height: OptionType(IntegerType),
    align: SnapGrid.Types.Align,
    title: OptionType(StringType),
    component: StringType,
    fingerprint: StringType,
});

/** Type representing one placement on a page. */
export type StudioCellType = typeof StudioCellType;

/**
 * A page's layout: its title and its placements.
 *
 * @property title - The page's title
 * @property cells - Its placements, in the order the canvas holds them
 */
export const StudioPageType = StructType({
    title: StringType,
    cells: ArrayType(StudioCellType),
});

/** Type representing a page's layout. */
export type StudioPageType = typeof StudioPageType;

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
 * A page: the layout the builder edits, and the version the site shows.
 *
 * @property draft - The layout as last saved
 * @property live - The published version; `none` until the first publish
 */
export const StudioPageEntryType = StructType({
    draft: StudioPageType,
    live: OptionType(StudioLiveType),
});

/** Type representing a page. */
export type StudioPageEntryType = typeof StudioPageEntryType;

/**
 * One entry of the pages record.
 *
 * @property page - A page, drafted and published
 * @property template - A layout saved from a page, which new pages start from
 */
export const StudioEntryType = VariantType({
    page: StudioPageEntryType,
    template: StudioPageType,
});

/** Type representing one entry of the pages record. */
export type StudioEntryType = typeof StudioEntryType;

/**
 * The pages record's type — every page and template, by key. A solution
 * declares its record with it: `e3.record("pages", Studio.Types.Pages, new Map())`.
 */
export const StudioPagesType = DictType(StudioKeyType, StudioEntryType);

/** Type representing the pages record. */
export type StudioPagesType = typeof StudioPagesType;

/** The pages record's patch — what every write is. */
export const StudioPagesPatchType = PatchType(StudioPagesType);

/** Type representing the pages record's patch. */
export type StudioPagesPatchType = typeof StudioPagesPatchType;

/**
 * One change to a placement.
 *
 * @property cell - The placement's key
 * @property component - The key of the component it places
 * @property detail - What changed, such as "row 2 · span 4" or "span 12 → 8"
 */
export const StudioCellChangeType = StructType({
    cell: StringType,
    component: StringType,
    detail: StringType,
});

/** Type representing one change to a placement. */
export type StudioCellChangeType = typeof StudioCellChangeType;

/**
 * One change between two layouts of a page, as {@link pageChanges} lists them.
 *
 * @property added - Placed on the page — its row and span
 * @property removed - Taken off the page — the row and span it had
 * @property moved - Moved into another row or a new one, with its row among the rows, or to another place in its row
 * @property resized - Its span changed
 * @property height - Its height changed; `auto` is its content's height
 * @property aligned - Where it sits in a taller row changed
 * @property retitled - Its title changed; `default` is its component's name
 */
export const StudioChangeType = VariantType({
    added: StudioCellChangeType,
    removed: StudioCellChangeType,
    moved: StudioCellChangeType,
    resized: StudioCellChangeType,
    height: StudioCellChangeType,
    aligned: StudioCellChangeType,
    retitled: StudioCellChangeType,
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
// The writes — each one patch through the record's patch mutation
// ============================================================================

/**
 * Publishes a page: its live version becomes its draft, numbered one past the
 * version it replaces, or 1 the first time.
 *
 * @remarks
 * The patch changes the page's live version alone, and carries it as it was:
 * a publish drafted before another one landed is a conflict naming the page.
 *
 * @example
 * ```ts
 * import { East, NullType } from "@elaraai/east";
 * import { Studio } from "@elaraai/e3-ui";
 *
 * // In the builder: the publish button commits the patch.
 * const publish = $.const(East.function([], NullType, $ => {
 *     $(record.mutate.patch(Studio.publish(record.read(), open)));
 * }));
 * ```
 */
export const publishPage = East.function(
    [StudioPagesType, StudioKeyType],
    StudioPagesPatchType,
    ($, pages, key) => {
        const entry = $.let(pages.tryGet(key).match({
            some: (_$, found) => found,
            none: ($2) => $2.error(East.str`No page ${East.print(key)}`),
        }), StudioEntryType);
        const page = $.let(entry.match({
            page: (_$, found) => found,
            template: ($2) => $2.error(East.str`${East.print(key)} is a template, not a page`),
        }), StudioPageEntryType);
        const version = $.let(page.live.match({
            some: (_$, live) => live.version.add(1n),
            none: (_$) => East.value(1n),
        }));
        const before = $.let(new Map(), StudioPagesType);
        $(before.insert(key, entry));
        const after = $.let(new Map(), StudioPagesType);
        $(after.insert(key, variant("page", { draft: page.draft, live: some({ version, page: page.draft }) })));
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
        const page = $.let(entry.match({
            page: (_$, found) => found,
            template: ($2) => $2.error(East.str`${East.print(key)} is a template, not a page`),
        }), StudioPageEntryType);
        const live = $.let(page.live.match({
            some: (_$, found) => found,
            none: ($2) => $2.error(East.str`${East.print(key)} has no published version to revert to`),
        }), StudioLiveType);
        const before = $.let(new Map(), StudioPagesType);
        $(before.insert(key, entry));
        const after = $.let(new Map(), StudioPagesType);
        $(after.insert(key, variant("page", { draft: live.page, live: page.live })));
        return East.diff(before, after);
    },
);

/**
 * Starts a page: its draft is a template's cells under the title given, or no
 * cells at all (the blank grid), and it has no live version.
 *
 * @remarks
 * The patch inserts the page, so a key another write took first is a conflict
 * naming it.
 */
export const newPage = East.function(
    [StudioPagesType, StudioKeyType, StringType, OptionType(StudioKeyType)],
    StudioPagesPatchType,
    ($, pages, key, title, template) => {
        $.if(pages.has(key), ($2) => {
            $2.error(East.str`${East.print(key)} already exists`);
        });
        const cells = $.let(template.match({
            some: (_$, from) => pages.tryGet(from).match({
                some: (_$2, found) => found.match({
                    template: (_$3, layout) => layout.cells,
                    page: ($3) => $3.error(East.str`${East.print(from)} is a page, not a template`),
                }),
                none: ($2) => $2.error(East.str`No template ${East.print(from)}`),
            }),
            none: (_$) => East.value([], ArrayType(StudioCellType)),
        }), ArrayType(StudioCellType));
        const before = $.let(new Map(), StudioPagesType);
        const after = $.let(new Map(), StudioPagesType);
        $(after.insert(key, variant("page", { draft: { title, cells }, live: none })));
        return East.diff(before, after);
    },
);

/**
 * Saves a page's draft as a template, under a key of its own and the title
 * given; the page library lists it in its Templates row.
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
            some: (_$, found) => found.match({
                page: (_$2, entry) => entry,
                template: ($2) => $2.error(East.str`${East.print(from)} is a template, not a page`),
            }),
            none: ($2) => $2.error(East.str`No page ${East.print(from)}`),
        }), StudioPageEntryType);
        const before = $.let(new Map(), StudioPagesType);
        const after = $.let(new Map(), StudioPagesType);
        $(after.insert(key, variant("template", { title, cells: page.draft.cells })));
        return East.diff(before, after);
    },
);

/** The cells of an entry: a page's draft's, or a template's. */
const draftCellsOf = East.function([StudioEntryType], ArrayType(StudioCellType), (_$, entry) => entry.match({
    page: (_$2, page) => page.draft.cells,
    template: (_$2, layout) => layout.cells,
}));

/** An entry with its cells replaced, and nothing else changed. */
const withDraftCells = East.function([StudioEntryType, ArrayType(StudioCellType)], StudioEntryType, (_$, entry, cells) => entry.match({
    page: (_$2, page) => East.value(variant("page", { draft: { title: page.draft.title, cells }, live: page.live }), StudioEntryType),
    template: (_$2, layout) => East.value(variant("template", { title: layout.title, cells }), StudioEntryType),
}));

/** The pages record, bound — what a save commits through. */
type StudioPagesHandle = ExprType<StructType<{ read: FunctionType<[], StudioPagesType> }>>;

/**
 * Saves the page open in the builder: the canvas's Apply, which commits its
 * batch of placements to the page's draft as one patch.
 *
 * @remarks
 * `Record.onApply`'s form over a collection inside one entry — the draft's
 * cells, identified by `key`. The patch reaches the cells and nothing else,
 * and cells another write moved since the edit began are a conflict.
 *
 * @param handle - The pages record, bound with its patch mutation — `Record.bind(pages, [pagesPatch])`
 * @param key - The open page's key
 * @returns The canvas's `editing.onApply`, an async East function over `Editing.Types.ChangeSet(Studio.Types.Cell)`
 *
 * @example
 * ```tsx
 * import { Reactive, SnapGrid } from "@elaraai/east-ui";
 * import { Record, Studio } from "@elaraai/e3-ui";
 *
 * <Reactive>{$ => {
 *     const record = $.let(Record.bind(pages, [pagesPatch]));
 *     const cells  = $.let(record.read().get(open).match({ page: (_$, p) => p.draft.cells, template: (_$, t) => t.cells }));
 *     return <SnapGrid data={cells} cell={c => SnapGrid.cell({ key: c.key, row: c.row, span: c.span, content: Studio.dispatch(components, c.component) })}
 *         edit={{ key: "key", row: "row", span: "span", height: "height" }}
 *         editing={{ onApply: Studio.save(record, open) }} />;
 * }}</Reactive>
 * ```
 */
function savePage(handle: StudioPagesHandle, key: SubtypeExprOrValue<StudioKeyType>) {
    return Record.onApply(handle, { entry: key, get: draftCellsOf, set: withDraftCells, idField: "key" });
}

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
 * Each placement's changes come in the later layout's reading order, then the
 * placements it no longer has. A placement moved when its row changed, or when
 * it left the longest run of placements still in their reading order, so a
 * move reports the placement moved and not the ones around it; which of two
 * placements that swapped places moved is ambiguous, and one is reported. A
 * change to a placement's component's fingerprint is not a layout change and
 * is not listed.
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Studio } from "@elaraai/e3-ui";
 *
 * // "N changes since vN": the draft against the live version.
 * const count = page.live.match({
 *     some: (_$, live) => Studio.changes(live.page, page.draft).size(),
 *     none: (_$) => East.value(0n),
 * });
 * ```
 */
export const pageChanges = East.function(
    [StudioPageType, StudioPageType],
    ArrayType(StudioChangeType),
    ($, before, after) => {
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
        $.for(now.order, ($2, key) => {
            const cell = $2.let(cellsAfter.get(key));
            const place = $2.let(now.places.get(key));
            $2.match(cellsBefore.tryGet(key), {
                none: ($3) => {
                    $3(changes.pushLast(variant("added", {
                        cell: key, component: cell.component,
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
                        $4(changes.pushLast(variant("moved", { cell: key, component: cell.component, detail })));
                    });
                    $3.if(East.notEqual(old.span, cell.span), ($4) => {
                        $4(changes.pushLast(variant("resized", {
                            cell: key, component: cell.component,
                            detail: East.str`span ${East.print(old.span)} → ${East.print(cell.span)}`,
                        })));
                    });
                    $3.if(East.notEqual(old.height, cell.height), ($4) => {
                        const oldHeight = $4.let(old.height.match({ some: (_$5, px) => East.print(px), none: (_$5) => East.value("auto") }));
                        const newHeight = $4.let(cell.height.match({ some: (_$5, px) => East.print(px), none: (_$5) => East.value("auto") }));
                        $4(changes.pushLast(variant("height", { cell: key, component: cell.component, detail: East.str`height ${oldHeight} → ${newHeight}` })));
                    });
                    $3.if(East.notEqual(old.align, cell.align), ($4) => {
                        const oldAlign = $4.let(old.align.match({ top: (_$5) => East.value("top"), center: (_$5) => East.value("center"), stretch: (_$5) => East.value("stretch") }));
                        const newAlign = $4.let(cell.align.match({ top: (_$5) => East.value("top"), center: (_$5) => East.value("center"), stretch: (_$5) => East.value("stretch") }));
                        $4(changes.pushLast(variant("aligned", { cell: key, component: cell.component, detail: East.str`align ${oldAlign} → ${newAlign}` })));
                    });
                    $3.if(East.notEqual(old.title, cell.title), ($4) => {
                        const oldTitle = $4.let(old.title.match({ some: (_$5, text) => East.str`"${text}"`, none: (_$5) => East.value("default") }));
                        const newTitle = $4.let(cell.title.match({ some: (_$5, text) => East.str`"${text}"`, none: (_$5) => East.value("default") }));
                        $4(changes.pushLast(variant("retitled", { cell: key, component: cell.component, detail: East.str`title ${oldTitle} → ${newTitle}` })));
                    });
                },
            });
        });
        $.for(was.order, ($2, key) => {
            $2.if(cellsAfter.has(key).not(), ($3) => {
                const cell = $3.let(cellsBefore.get(key));
                const place = $3.let(was.places.get(key));
                $3(changes.pushLast(variant("removed", {
                    cell: key, component: cell.component,
                    detail: East.str`row ${East.print(place.row)} · span ${East.print(cell.span)}`,
                })));
            });
        });
        return changes;
    },
);

/**
 * How many pages place each component — "Used in N" — counting a page once
 * whether its draft, its live version or both place it. Templates are not
 * pages and are not counted.
 */
export const componentUsage = East.function(
    [StudioPagesType],
    DictType(StringType, IntegerType),
    ($, pages) => {
        const counts = $.let(new Map(), DictType(StringType, IntegerType));
        $.for(pages, ($2, entry) => {
            $2.match(entry, {
                page: ($3, page) => {
                    const placed = $3.let(new Set<string>(), SetType(StringType));
                    $3.for(page.draft.cells, ($4, cell) => {
                        $4(placed.tryInsert(cell.component));
                    });
                    $3.match(page.live, {
                        some: ($4, live) => {
                            $4.for(live.page.cells, ($5, cell) => {
                                $5(placed.tryInsert(cell.component));
                            });
                        },
                    });
                    $3.for(placed, ($4, component) => {
                        $4(counts.insertOrUpdate(component, 1n, (_$5, existing) => existing.add(1n)));
                    });
                },
            });
        });
        return counts;
    },
);

/**
 * A page's status: live when it is published and its draft is the published
 * layout, and draft otherwise.
 */
export const pageStatus = East.function(
    [StudioPageEntryType],
    StudioStatusType,
    (_$, page) => page.live.match({
        some: (_$2, live) => East.equal(live.page, page.draft).ifElse(
            () => East.value(variant("live", null), StudioStatusType),
            () => East.value(variant("draft", null), StudioStatusType),
        ),
        none: (_$2) => East.value(variant("draft", null), StudioStatusType),
    }),
);

/** What the page functions are, on the `Studio` namespace. */
export interface StudioPagesNamespace {
    /** Saves the page open in the builder — the canvas's Apply ({@link savePage}). */
    save: typeof savePage;
    /** Publishes a page ({@link publishPage}). */
    publish: typeof publishPage;
    /** Reverts a page to its live version ({@link revertPage}). */
    revert: typeof revertPage;
    /** Starts a page, from a template or blank ({@link newPage}). */
    newPage: typeof newPage;
    /** Saves a page's draft as a template ({@link saveTemplate}). */
    saveTemplate: typeof saveTemplate;
    /** The changes from one layout of a page to another ({@link pageChanges}). */
    changes: typeof pageChanges;
    /** How many pages place each component ({@link componentUsage}). */
    usage: typeof componentUsage;
    /** A page's status ({@link pageStatus}). */
    status: typeof pageStatus;
}

/** The page half of the `Studio` namespace. */
export const StudioPages: StudioPagesNamespace = {
    save: savePage,
    publish: publishPage,
    revert: revertPage,
    newPage,
    saveTemplate,
    changes: pageChanges,
    usage: componentUsage,
    status: pageStatus,
};
