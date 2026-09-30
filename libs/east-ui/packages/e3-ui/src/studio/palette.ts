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
import { StudioComponentType } from "./component.js";
import { StudioCellType, StudioPagesType, pageStatus } from "./pages.js";

// ============================================================================
// The builder's shared keys
// ============================================================================

/**
 * The names a builder shares, by its `id`: the UI store key of the page open
 * in it — which the page library writes when it opens a page — and the
 * drag-source ids of its palette's two libraries.
 *
 * @remarks
 * A builder and a page library with the same `id` open one page together, as
 * `Slice.bind` shares a slice by key.
 *
 * @param id - The builder's name, when a surface holds more than one; omitted, the one builder
 * @returns The key and ids
 */
export function builderKeys(id: string | undefined): {
    /** The open page's UI store key — a `Studio.Types.Key`. */
    page: string;
    /** The palette's components library's drag-source id — what the canvas takes cards from. */
    components: string;
    /** The palette's pages library's id. */
    pages: string;
} {
    const suffix = id === undefined ? "" : `.${id}`;
    return {
        page: `studio.builder${suffix}.page`,
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
