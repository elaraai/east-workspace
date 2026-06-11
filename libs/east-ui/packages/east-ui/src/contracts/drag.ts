/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    BooleanType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Drag & drop grammar — shared contract for DnD-aware surfaces
// ============================================================================

/**
 * Reference to an item in a Library (a drag **source**).
 *
 * @remarks
 * Identifies where a dragged card came from: the `id` the Library surface
 * declared, plus the dragged card's item key. Carried by the `add` case of
 * {@link DragEventType}.
 *
 * @property library - The `id` the source Library declared
 * @property key - The dragged card's item key within that Library
 */
export const LibraryRefType = StructType({
    /** The `id` the source Library declared */
    library: StringType,
    /** The dragged card's item key within that Library */
    key: StringType,
});

/**
 * Type representing Library reference values.
 */
export type LibraryRefType = typeof LibraryRefType;

/**
 * A cell coordinate on a drag **target** surface.
 *
 * @remarks
 * Names a cell as `surface × row × slot`. When the reference points at an
 * existing event in that cell (the `from` of a `move` / `remove`, or the
 * subject of a `resize`), `event` carries the event's key; for an empty
 * destination cell it is `none`.
 *
 * @property surface - The target surface's declared `id`
 * @property row - The row key
 * @property slot - The slot (column) key
 * @property event - The event key when the ref names an existing event
 */
export const CellRefType = StructType({
    /** The target surface's declared `id` */
    surface: StringType,
    /** The row key */
    row: StringType,
    /** The slot (column) key */
    slot: StringType,
    /** The event key when the ref names an existing event */
    event: OptionType(StringType),
});

/**
 * Type representing cell reference values.
 */
export type CellRefType = typeof CellRefType;

/**
 * Terminal destination of a `remove` drag.
 *
 * @remarks
 * The two canonical sinks: `trash` (permanent removal) and `source` (drag
 * back to the originating Library — returns the item to the palette).
 *
 * @property trash - Dropped on the trash affordance; permanent removal
 * @property source - Dragged back to the originating Library
 */
export const DragSinkType = VariantType({
    /** Dropped on the trash affordance; permanent removal */
    trash: NullType,
    /** Dragged back to the originating Library */
    source: NullType,
});

/**
 * Type representing drag sink values.
 */
export type DragSinkType = typeof DragSinkType;

/**
 * String literal form of {@link DragSinkType} tags.
 */
export type DragSinkLiteral = "trash" | "source";

/**
 * Which boundary of a span event a `resize` drag moved.
 *
 * @property start - The leading edge moved
 * @property end - The trailing edge moved
 */
export const DragEdgeType = VariantType({
    /** The leading edge moved */
    start: NullType,
    /** The trailing edge moved */
    end: NullType,
});

/**
 * Type representing drag edge values.
 */
export type DragEdgeType = typeof DragEdgeType;

/**
 * String literal form of {@link DragEdgeType} tags.
 */
export type DragEdgeLiteral = "start" | "end";

/**
 * The four drag event kinds — every drag interaction reduces to exactly one.
 *
 * @remarks
 * The shared grammar for every DnD-aware surface. A target surface carries a
 * single `onDrag` callback of this type; the renderer wires drag-flow between
 * surfaces by matching their declared roles (a Library `source` connects to
 * every target that lists it in `sources`), so hosts never wire handlers by
 * hand. Every event funnels through the host's normal commit pipeline as a
 * proposed patch — no drop writes state directly.
 *
 * - `add` is the only kind that crosses a source/target boundary: an item
 *   leaving a Library and landing on a target cell. `duplicate` is set when
 *   the drag was an alt-drag copy.
 * - `move` is intra-surface only. A cross-row move still arrives as `move`;
 *   the host derives any swap-proposal representation from
 *   `from.row ≠ to.row`.
 * - `remove` takes a {@link DragSinkType} destination: the trash affordance
 *   or back to the originating Library.
 * - `resize` exists only for span events with a duration (Gantt /
 *   Planner.Span); the edge variant says which boundary moved, and the
 *   destination slot of the moved edge is the `event` ref's `slot`.
 *
 * @property add - New item from a sibling Library landing on a target cell
 * @property move - An event moved within one surface
 * @property remove - An event dragged off the surface into a sink
 * @property resize - A span event's edge dragged to a new slot
 */
export const DragEventType = VariantType({
    /** New item from a sibling Library landing on a target cell */
    add: StructType({
        /** Where the dragged card came from */
        from: LibraryRefType,
        /** The destination cell */
        into: CellRefType,
        /** Whether the drag was an alt-drag duplicate */
        duplicate: BooleanType,
    }),
    /** An event moved within one surface */
    move: StructType({
        /** The cell (and event) the drag started from */
        from: CellRefType,
        /** The destination cell */
        to: CellRefType,
    }),
    /** An event dragged off the surface into a sink */
    remove: StructType({
        /** The cell (and event) the drag started from */
        from: CellRefType,
        /** The terminal destination */
        to: DragSinkType,
    }),
    /** A span event's edge dragged to a new slot */
    resize: StructType({
        /** The event being resized; `slot` is the moved edge's new slot */
        event: CellRefType,
        /** Which boundary moved */
        edge: DragEdgeType,
    }),
});

/**
 * Type representing drag event values.
 */
export type DragEventType = typeof DragEventType;
