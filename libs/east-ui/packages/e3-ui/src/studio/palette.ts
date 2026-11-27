/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's palette (#994) — what it shows of the components a surface
 * lists and of the project's pages, computed in East for the `StudioBuilder`
 * renderer, which draws the palette: the components by category, and the
 * project's pages, in one pane beside the canvas.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BooleanType,
    DictType,
    East,
    IntegerType,
    OptionType,
    StringType,
    StructType,
    none,
    some,
} from "@elaraai/east";
import { StudioComponentType, readNames } from "./component.js";
import { StudioCellType, StudioPagesType, pageStatus } from "./pages.js";

// ============================================================================
// The builder's keys
// ============================================================================

/**
 * The names a builder's palette takes from its `id`: the drag-source ids of
 * its two libraries, which tell two builders on one surface apart.
 *
 * @remarks
 * The page open in a builder is not among them: its host gives it as `page`
 * and hears of another in `onOpen` (#1668).
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The ids
 */
export function builderKeys(id: string | undefined): {
    /** The palette's components library's drag-source id — what the canvas takes cards from. */
    components: string;
    /** The palette's pages library's id. */
    pages: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
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
 * placed. A card's meta line names the data its component reads in words
 * ({@link readNames}), joined with ` · `; the component the selected placement places is placed, and its
 * line counts the page's placements of it instead. A key two components
 * share keeps the first one's card. A placement that holds a visual or a
 * text block places no component, and counts for none.
 */
export const paletteCards = East.function(
    [ArrayType(StudioComponentType), ArrayType(StudioCellType), OptionType(StringType)],
    DictType(StringType, PaletteCardType),
    ($, listed, cells, selectedCell) => {
        const placements = $.let(new Map(), DictType(StringType, IntegerType));
        $.for(cells, ($2, cell) => {
            $2.match(cell.content, {
                component: ($3, key) => {
                    $3(placements.insertOrUpdate(key, 1n, (_$4, count) => count.add(1n)));
                },
            });
        });
        // The component the selected placement places, when it places one.
        const selected = $.let(selectedCell.match({
            some: (_$2, cellKey) => cells.firstMap((_$3, cell) => cell.key.equal(cellKey).ifElse(
                () => cell.content.match({
                    component: (_$4, key) => East.value(some(key), OptionType(StringType)),
                    visual: (_$4) => East.value(none, OptionType(StringType)),
                    text: (_$4) => East.value(none, OptionType(StringType)),
                }),
                () => East.value(none, OptionType(StringType)),
            )),
            none: (_$2) => East.value(none, OptionType(StringType)),
        }), OptionType(StringType));
        const cards = $.let(new Map(), DictType(StringType, PaletteCardType));
        $.for(listed, ($2, component) => {
            const reads = $2.let(readNames(component.reads));
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
            $2.if(key.project.equal(project).and(() => entry.kind.hasTag("page")), ($3) => {
                const live = $3.let(pageStatus(entry).hasTag("live"));
                const meta = $3.let(entry.live.match({
                    some: (_$4, version) => live.ifElse(
                        () => East.str`LIVE · V${East.print(version.version)}`,
                        () => East.str`DRAFT · V${East.print(version.version)} LIVE`,
                    ),
                    none: (_$4) => East.value("DRAFT"),
                }));
                $3(listed.pushLast({ page: key.page, title: entry.title, meta, live }));
            });
        });
        return listed;
    },
);
