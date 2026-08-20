/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    BooleanType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

// ============================================================================
// Drag & drop grammar — shared contract for DnD-aware surfaces
// ============================================================================
//
// ## Slot-key encoding (the `CellRefType.row` / `slot` conventions)
//
// `row` and `slot` are strings; each target documents how its grid coordinates
// encode into them, and every target follows the same composite-key rule:
//
// | Target  | `row`            | `slot`                                        |
// |---------|------------------|-----------------------------------------------|
// | Roster  | person key       | day key (e.g. `"wed"`)                        |
// | Board   | area key         | shift key                                     |
// | Blend   | target key       | `"alloc"` (synthetic single slot)             |
// | Plan    | canvas row key   | the pointed-at bucket's START instant (ISO), at the canvas's resolution |
//
// The composite rule: if a target's slot subdivides, the sub-slot key is
// appended with `":"` — the same composite key the renderer uses to index its
// cells. (No current target subdivides: the Plan reports the bucket START
// instant and leaves lane placement to the receiving series.) Axis coordinates
// that are not strings (numbers, datetimes) are printed canonically: numbers
// via their decimal form, datetimes as the snapped ISO-8601 instant. Hosts map
// keys straight back to their source data.
//
// The TEMPORAL target — the Plan — prints datetime slots through one shared
// encoding (`east-ui-components/src/dnd/slot-key.ts`), which any future
// temporal target must reuse so a host parses every temporal slot the same
// way. A Plan row key IS the data key its canvas is built from and searched
// by, so a Plan `add` maps straight back to the source element with no lookup
// table.
//
// A Plan accepts drops only on the row kinds that hold discrete scheduled
// objects — `span`, `buckets`, `events`, `cards`. Rows rendering derived values
// (`chart`, `heat`, `table`) and group strips register no cell at all, so they
// are inert to a drag before any `canDrop` predicate is consulted.

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
 * - `resize` exists only for span events with a duration; the edge variant
 *   says which boundary moved, and the destination slot of the moved edge is
 *   the `event` ref's `slot`.
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

/**
 * The `canDrop` validation predicate every DnD target root carries as
 * `canDrop: OptionType(CanDropFnType)` — IR-level drop validation, uniform
 * across targets.
 *
 * @remarks
 * **Candidate-event semantics.** During a drag, the renderer consults the
 * predicate once per hovered destination with a **synthesized candidate
 * event** — the {@link DragEventType} value that *would* be delivered if the
 * payload dropped there: an `add` for a Library card over a cell (with
 * `duplicate: false` — the alt-key state is unknowable before the drop), a
 * `move` for an event chip over a cell, a `resize` for an edge drag over a
 * slot. Returning `false` puts the cell in the invalid stage
 * (`data-drop-invalid`: ⊘ badge, red outline, `cursor: not-allowed`) and the
 * drop is a no-op; the verdict is also re-checked with the real event before
 * delivery. Absent ⇒ every structurally-connected cell accepts (the default).
 *
 * Sink drops are not consulted: a `remove` into the trash / return-to-palette
 * sink is always structurally valid for a removable payload — removal policy
 * belongs to the host's `onDrag` handling, not the hover veto.
 *
 * A **throwing** predicate logs and allows (fail-open, the Board / Schematic
 * validator convention) so a broken validator cannot brick the surface.
 * Verdicts are cached per (payload, destination) for the duration of a drag.
 */
export const CanDropFnType = FunctionType([DragEventType], BooleanType);

/**
 * Type representing drop-validation predicate values.
 */
export type CanDropFnType = typeof CanDropFnType;
