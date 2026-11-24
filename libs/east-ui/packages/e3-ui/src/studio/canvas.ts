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
    some,
} from "@elaraai/east";
import { StudioComponentType, readNames } from "./component.js";
import { StudioContentType, viewIcon, visualWords } from "./content.js";
import { sourceName } from "./source.js";

// ============================================================================
// What a placement's tile shows
// ============================================================================

/**
 * A listed component, as its placements' tiles show it on the canvas.
 *
 * @property frame - Drawn in a tile frame, or bare
 * @property name - Its name — a placement's label when it has no title of its own
 * @property icon - Its icon, in the selection bar
 * @property meta - The data it reads, in words, in the selection bar
 */
export const CanvasTileType = StructType({
    frame: BooleanType,
    name: StringType,
    icon: StringType,
    meta: StringType,
});

/**
 * Each listed component's tile, by key: framed or bare, its name and icon,
 * and its meta line — the datasets and records its code reads, in words
 * ({@link readNames}), joined with ` · ` ("Sales daily"), empty for one that
 * reads nothing; never its key, nor theirs, which are no words for the people
 * who build pages. A key two components
 * share keeps the first one's tile.
 */
export const canvasTiles = East.function(
    [ArrayType(StudioComponentType)],
    DictType(StringType, CanvasTileType),
    ($, components) => {
        const tiles = $.let(new Map(), DictType(StringType, CanvasTileType));
        $.for(components, ($2, component) => {
            const reads = $2.let(readNames(component.reads));
            const meta = $2.let(reads.stringJoin(" · "));
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

/**
 * The tile of what a placement holds: a listed component's ({@link
 * canvasTiles}), `none` for one the surface does not list; a visual's — in a
 * tile frame, named by its view and its source ("Column chart · Orders"),
 * with its view's icon and its source's name as its meta line; a text
 * block's, bare, named "Text".
 *
 * @remarks
 * `tiles` is each listed component's tile, by key; `sources` each listed
 * source's name, by its key.
 */
export const contentTile = East.function(
    [StudioContentType, DictType(StringType, CanvasTileType), DictType(StringType, StringType)],
    OptionType(CanvasTileType),
    (_$, content, tiles, sources) => content.match({
        component: (_$2, key) => tiles.tryGet(key),
        visual: (_$2, visual) => East.value(some({
            frame: true,
            name: visualWords(visual, sources),
            icon: viewIcon(visual.view),
            meta: sourceName(visual.source, sources),
        }), OptionType(CanvasTileType)),
        text: (_$2) => East.value(some({ frame: false, name: "Text", icon: "align-left", meta: "" }), OptionType(CanvasTileType)),
    }),
);

/**
 * Each listed component's frame, by key: whether its placements are drawn in
 * a tile frame, or bare. A key two components share keeps the first one's.
 */
export const componentFrames = East.function(
    [ArrayType(StudioComponentType)],
    DictType(StringType, BooleanType),
    (_$, components) => components.toDict((_$2, component) => component.key, (_$2, component) => component.frame.hasTag("card"), (_$2, first) => first),
);

/**
 * Whether a placement is drawn in a tile frame, by what it holds: a listed
 * component as it chose ({@link componentFrames}), and one the surface does
 * not list in one, as its placeholder is; a visual in one; a text block bare.
 * What a page reads to draw its placements, with no tile's name or meta line
 * made for it.
 *
 * @remarks
 * `frames` is each listed component's frame, by key.
 */
export const contentFramed = East.function(
    [StudioContentType, DictType(StringType, BooleanType)],
    BooleanType,
    (_$, content, frames) => content.match({
        component: (_$2, key) => frames.tryGet(key).match({
            some: (_$3, framed) => framed,
            none: (_$3) => true,
        }),
        visual: (_$2) => true,
        text: (_$2) => false,
    }),
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
