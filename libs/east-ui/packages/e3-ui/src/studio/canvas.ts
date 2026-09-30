/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The builder's canvas (#995) — what its tiles and its toolbar's Save as
 * template show, for the `StudioBuilder` renderer, which draws the canvas: the
 * open page's grid under the builder's one toolbar, every gesture a draft of
 * the page's editing session and Apply one patch commit on the page.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DictType,
    East,
    OptionType,
    SetType,
    StringType,
    StructType,
} from "@elaraai/east";
import { StudioComponentType } from "./component.js";

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
 * The builder toolbar's Save as template, as the `StudioBuilder` renderer
 * draws it: its button, and the popover beside it that names the template.
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

/** Type representing the builder toolbar's Save as template. */
export type StudioSaveTemplatePayloadType = typeof StudioSaveTemplatePayloadType;
