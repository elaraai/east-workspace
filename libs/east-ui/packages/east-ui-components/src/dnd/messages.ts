/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The drag layer's own words (#608) — what it says to a screen reader as a
 * drag is picked up, moved, dropped or cancelled, the instructions a draggable
 * describes itself with, and the names of the targets it provides itself.
 *
 * A host translates them with `<DragLayerProvider messages={…}>`: any subset,
 * over this English table. Each message is a function of named parameters that
 * are already words — an item's label, a target's name — so a table never
 * formats anything itself.
 *
 * @packageDocumentation
 */

/**
 * The drag layer's message table.
 *
 * @remarks
 * `item` is the dragged thing's name — a Library card's label, an event's —
 * and `target` a destination's: the name its surface registered it with, or a
 * cell's row and slot.
 */
export interface DragMessages {
    /** What a draggable describes itself with — how to drag it from the keyboard. */
    instructions: () => string;
    /** A draggable's role, as a screen reader names it. */
    draggable: () => string;
    /** A drag began. */
    pickedUp: (p: { item: string }) => string;
    /** The drag rests over a target that takes it. */
    over: (p: { item: string; target: string }) => string;
    /** The drag rests over a target that refuses it. */
    refused: (p: { item: string; target: string }) => string;
    /** The drag rests over nothing that could take it. */
    notOver: (p: { item: string }) => string;
    /** The drop landed. */
    dropped: (p: { item: string; target: string }) => string;
    /** The drop landed nowhere, or on a target that refused it. */
    notDropped: (p: { item: string }) => string;
    /** The drop's target left the screen during the drag, and nothing took its place. */
    targetGone: (p: { item: string }) => string;
    /** The drag was cancelled. */
    cancelled: (p: { item: string }) => string;
    /** The shared trash zone's name. */
    trash: () => string;
    /** A Library's return-to-palette frame, as a target. */
    returnTo: (p: { library: string }) => string;
    /** A cell whose surface gave it no name — its row and slot. */
    cell: (p: { row: string; slot: string }) => string;
}

/** The English table — what `messages` overrides, key by key. */
export const dragMessages: DragMessages = {
    instructions: () =>
        "To pick up an item, press Space or Enter. While dragging, use the arrow keys to move it, " +
        "then press Space or Enter to drop it, or Escape to cancel.",
    draggable: () => "draggable",
    pickedUp: ({ item }) => `Picked up ${item}.`,
    over: ({ item, target }) => `${item} is over ${target}.`,
    refused: ({ item, target }) => `${target} does not take ${item}.`,
    notOver: ({ item }) => `${item} is not over a drop target.`,
    dropped: ({ item, target }) => `${item} was dropped on ${target}.`,
    notDropped: ({ item }) => `${item} was not dropped.`,
    targetGone: ({ item }) => `${item} was not dropped: its target left the screen.`,
    cancelled: ({ item }) => `Dragging ${item} was cancelled.`,
    trash: () => "Remove",
    returnTo: ({ library }) => `Return to ${library}`,
    cell: ({ row, slot }) => (slot === "" ? row : `${row} · ${slot}`),
};
