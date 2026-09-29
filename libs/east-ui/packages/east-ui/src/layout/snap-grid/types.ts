/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SnapGrid types — the 12-column snap grid of tiles (#989, #990).
 *
 * A cell carries its content, and the inline `SnapGrid` arm of `UIComponentType`
 * spells that content with the recursion `node` while `SnapGrid.Types.Root`
 * spells it `UIComponentType`. Both are built here, over the content's type
 * ({@link SnapGridRootOf}), so the two are one East type by construction. This
 * file imports no `UIComponentType`, so `component.ts` can import it.
 */

import {
    ArrayType,
    BlobType,
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { DragEventType, LibraryRefType } from "../../contracts/drag.js";
import { EditingReadinessType, EditingSessionFields } from "../../contracts/editing.js";

/**
 * Where a cell shorter than its row sits in it.
 *
 * @property top - At the row's top
 * @property center - Centred in the row
 * @property stretch - As tall as the row
 */
export const SnapGridAlignType = VariantType({
    top: NullType,
    center: NullType,
    stretch: NullType,
});

/** Type representing a SnapGrid cell's alignment. */
export type SnapGridAlignType = typeof SnapGridAlignType;

/** Literal shorthand for {@link SnapGridAlignType}. */
export type SnapGridAlignLiteral = "top" | "center" | "stretch";

/**
 * How a SnapGrid draws its cells.
 *
 * @property tiles - Each cell's content, in its tile
 * @property wireframe - Each cell an outline at its tile's size, its content
 *   not drawn — the page library's thumbnails
 */
export const SnapGridVariantType = VariantType({
    tiles: NullType,
    wireframe: NullType,
});

/** Type representing a SnapGrid's variant. */
export type SnapGridVariantType = typeof SnapGridVariantType;

/** Literal shorthand for {@link SnapGridVariantType}. */
export type SnapGridVariantLiteral = "tiles" | "wireframe";

/**
 * The SnapGrid's interaction state, as a host holds it — the value behind a
 * bound `ui` ({@link SnapGridUiBindType}, #990). Bound, the SnapGrid draws the
 * selection it holds and writes the user's back, so a host selects a tile
 * from outside (an inspector, a list beside the canvas) and reads the one the
 * user chose.
 *
 * @property selected - The selected tile's key (`none` ⇒ nothing selected)
 */
export const SnapGridUiStateType = StructType({
    selected: OptionType(StringType),
});

/** Type representing a SnapGrid's interaction state. */
export type SnapGridUiStateType = typeof SnapGridUiStateType;

/**
 * A bound {@link SnapGridUiStateType} — exactly `State.bind`'s handle at it, so
 * `State.bind([SnapGrid.Types.UiState], key, SnapGrid.uiState())` passes straight
 * through as a SnapGrid's `ui`.
 *
 * @remarks
 * Field order is `read` / `write` / `has`: East struct subtyping is exact, so
 * declaring the shape here means a change to `State.bind`'s fails this file's
 * build rather than a canvas's.
 *
 * @property read - The current state
 * @property write - Replace it
 * @property has - Whether the key is set
 */
export const SnapGridUiBindType = StructType({
    read:  FunctionType([], SnapGridUiStateType),
    write: FunctionType([SnapGridUiStateType], NullType),
    has:   FunctionType([], BooleanType),
});

/** Type representing a bound SnapGrid interaction state. */
export type SnapGridUiBindType = typeof SnapGridUiBindType;

/**
 * Where a dropped card lands (#990) — what `edit.create` builds the new entry
 * at.
 *
 * @remarks
 * The canvas fits the entry `create` returns: it writes `row` into the field
 * `edit.row` names, and holds its span to what the row has room for.
 *
 * @property key - A fresh key for the new entry, unique among the entries' identities
 * @property row - The key of the row it lands in — an existing row's, or a new row's
 */
export const SnapGridPlaceType = StructType({
    key: StringType,
    row: StringType,
});

/** Type representing where a dropped card lands. */
export type SnapGridPlaceType = typeof SnapGridPlaceType;

/**
 * The entry fields a gesture writes, as `edit` names them (#990).
 *
 * @internal
 * @property key - The String identity field
 * @property row - The String field holding the row key
 * @property span - The Integer field holding the span
 * @property height - The `Option<Integer>` field holding the height, when a height is edited
 */
export const SnapGridEditFieldsType = StructType({
    key:    StringType,
    row:    StringType,
    span:   StringType,
    height: OptionType(StringType),
});

/**
 * A drafted entry the author's readiness check reads (#990).
 *
 * @internal
 * @property id - The entry's identity
 * @property entry - The drafted entry, encoded
 */
export const SnapGridReadyEntryType = StructType({ id: StringType, entry: BlobType });

/**
 * One tile, over its content's type — its identity, where it sits, and what
 * it shows.
 *
 * @remarks
 * Rows order by their first appearance among the cells, and the cells of a
 * row by their order in the SnapGrid's `data`.
 *
 * @typeParam C - The content's type
 * @param content - The content's type — the recursion node in the inline arm, `UIComponentType` in `SnapGrid.Types.Cell`
 * @returns The cell struct
 *
 * @property key - The cell's identity
 * @property row - The key of the row it sits in
 * @property span - Its width, in columns of 12
 * @property height - Its height in px; `none` is its content's height
 * @property minHeight - The least height a height drag leaves it, in px; `none` stops it at its content's height
 * @property align - Where it sits in a taller row
 * @property frame - Drawn in a tile frame, or bare
 * @property label - Its name — the drag ghost's, the announcements' and the history's; `none` names it by its key
 * @property content - What it shows
 */
export function SnapGridCellOf<const C>(content: C) {
    return StructType({
        key:       StringType,
        row:       StringType,
        span:      IntegerType,
        height:    OptionType(IntegerType),
        minHeight: OptionType(IntegerType),
        align:     SnapGridAlignType,
        frame:     BooleanType,
        label:     OptionType(StringType),
        content,
    });
}

/**
 * A SnapGrid's editing declaration, on the wire (#990), over its cells' content
 * type — the shared session's fields ({@link EditingSessionFields}) and the
 * canvas's own. Entries cross as bytes at the exact type the wire names, so
 * the arm stays a closed type whatever the SnapGrid's rows are.
 *
 * @internal
 * @typeParam C - The cells' content type
 * @param content - The cells' content type
 * @returns The editing struct
 *
 * @property fields - The entry fields a gesture writes ({@link SnapGridEditFieldsType})
 * @property derive - The cells of a whole drafted collection, encoded — what the canvas draws a draft as, exactly as Apply leaves it
 * @property create - A dropped card's new entry, encoded — the author's `edit.create`; `none` takes no card
 * @property ready - The author's readiness check over drafted entries, one result each, in order
 */
export function SnapGridEditingOf<const C>(content: C) {
    return StructType({
        ...EditingSessionFields,
        fields: SnapGridEditFieldsType,
        derive: FunctionType([BlobType], ArrayType(SnapGridCellOf(content))),
        create: OptionType(FunctionType([LibraryRefType, SnapGridPlaceType], BlobType)),
        ready:  OptionType(FunctionType([ArrayType(SnapGridReadyEntryType)], ArrayType(EditingReadinessType))),
    });
}

/**
 * A SnapGrid's value, over its cells' content type.
 *
 * @typeParam C - The cells' content type
 * @param content - The cells' content type — the recursion node in the inline arm, `UIComponentType` in `SnapGrid.Types.Root`
 * @returns The root struct
 *
 * @property cells - Every cell, in the order `data` holds them
 * @property variant - Tiles (the default) or a wireframe
 * @property width - The design width, a CSS length
 * @property height - A pinned height, a CSS length; the grid scrolls within
 * @property maxHeight - A height cap, a CSS length; the grid scrolls past it
 * @property zoom - The scale the canvas draws at (`1.0` actual size)
 * @property guides - Draw the column ruler and the column bands
 * @property editing - The editing session (#990); `none` takes no gesture
 * @property ui - The bound selection ({@link SnapGridUiBindType}); `none` keeps it in the canvas
 * @property id - The drag surface's name in a drop's cell refs; `none` names one of its own
 * @property sources - The library ids whose cards land on the canvas
 * @property canDrop - The veto over a drop where the drag rests (the shared grammar)
 */
export function SnapGridRootOf<const C>(content: C) {
    return StructType({
        cells:     ArrayType(SnapGridCellOf(content)),
        variant:   OptionType(SnapGridVariantType),
        width:     OptionType(StringType),
        height:    OptionType(StringType),
        maxHeight: OptionType(StringType),
        zoom:      OptionType(FloatType),
        guides:    BooleanType,
        editing:   OptionType(SnapGridEditingOf(content)),
        ui:        OptionType(SnapGridUiBindType),
        id:        OptionType(StringType),
        sources:   ArrayType(StringType),
        canDrop:   OptionType(FunctionType([DragEventType], BooleanType)),
    });
}
