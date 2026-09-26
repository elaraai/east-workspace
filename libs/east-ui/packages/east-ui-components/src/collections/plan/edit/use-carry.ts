/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The keyboard's move (#825) — Space on an element picks it up, and the canvas
 * carries it by keys:
 *
 * | Key | While carrying |
 * |---|---|
 * | ← / → | move it one bucket |
 * | Shift + ← / → | move its end one bucket (a run, a chip) |
 * | Alt + ← / → | move its start one bucket |
 * | ↑ / ↓ | to the nearest row above / below that takes its item type |
 * | Space / Enter | drop it — a refused place is said, and the carry goes on |
 * | Escape / Tab | cancel — it stays where it was |
 *
 * Where it would land draws as the target row's landing band, the element
 * itself dims, and each step is said in the carry's live region: the row and
 * the span, or that the canvas's `canDrop` refuses it there — asked of the
 * very event the drop would deliver, as the pointer's drag is.
 *
 * The carry is the canvas's, not the drag layer's keyboard sensor's (#608):
 * the layer's arrows move a resting point between cells, which cannot say
 * "move only the end" or "the next row of this item type".
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { none, some, variant } from "@elaraai/east";
import type { DragEventValue, DropVeto } from "../../../dnd/drag-layer";
import type { PlanRowValue, VisibleRow } from "../model.js";
import type { RowKey } from "../plan-state.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import { slotOfEnd, slotOfInstant, stepSpan, type PlanSpan } from "./move-math.js";
import { spanWords } from "./movable.js";
import type { PlanCarry, PlanEditStore, PlanMovable, PlanProposal } from "./store.js";

/** One move, as the editing session writes it. */
export interface PlanMoveRequest {
    /** The element's key — its item's. */
    key: string;
    /** The row it leaves. */
    from: RowKey;
    /** The row it lands on (`from` for a move along its row, or a resize). */
    to: RowKey;
    /** Its extent there. */
    span: PlanSpan;
    /** Whether it moved, or only an end did. */
    origin: "move" | "resize";
    /** Its name, for the transaction's label. */
    label: string;
}

/** What a gesture did — moved the element, or only one of its ends. */
export type PlanMoveOrigin = { kind: "move" } | { kind: "resize"; edge: "start" | "end" };

/** Two instants alike. */
function same(a: PlanSpan["start"], b: PlanSpan["start"]): boolean {
    if (a.type !== b.type) return false;
    return a.type === "time" ? a.value.getTime() === (b.value as Date).getTime() : a.value === b.value;
}

/**
 * Whether a landing is where the element already is — nothing to write.
 *
 * @param movable - The element
 * @param to - Where it lands
 * @returns Whether nothing moved
 */
export function unmoved(movable: PlanMovable, to: PlanProposal): boolean {
    return to.rowKey === movable.rowKey && same(to.span.start, movable.span.start) && same(to.span.end, movable.span.end);
}

/**
 * What a landing does: a resize when the element stays on its row and only
 * one end moved, else a move.
 *
 * @param movable - The element
 * @param to - Where it lands
 * @returns The gesture's kind
 */
export function originOf(movable: PlanMovable, to: PlanProposal): PlanMoveOrigin {
    if (!movable.resize || to.rowKey !== movable.rowKey) return { kind: "move" };
    const startMoved = !same(to.span.start, movable.span.start);
    const endMoved = !same(to.span.end, movable.span.end);
    if (startMoved && !endMoved) return { kind: "resize", edge: "start" };
    if (endMoved && !startMoved) return { kind: "resize", edge: "end" };
    return { kind: "move" };
}

/**
 * Whether a row draws an element keyed `key` — a run, chip, tile or mark. A
 * row's items keep their keys unique (a move finds its item by key), so a
 * moved element lands on ANOTHER row only where none of its elements has the
 * key: the write would refuse it, and the drag says so before the drop.
 *
 * @param row - The row, as the canvas draws it (its drafts included)
 * @param key - The moved element's key
 * @returns Whether one of the row's elements has the key
 */
export function holdsKey(row: PlanRowValue, key: string): boolean {
    const kind = row.kind;
    switch (kind.type) {
        case "span": return kind.value.runs.some((r) => r.key === key);
        case "cards": return kind.value.chips.some((c) => c.key === key);
        case "buckets": return kind.value.events.some((e) => e.key === key);
        case "events": return kind.value.marks.some((m) => m.key === key);
        default: return false;
    }
}

/**
 * The drag event a landing would deliver — what the canvas's `canDrop` is
 * asked: a `move` from the element's start bucket to its new start's, or a
 * `resize` naming the moved end's bucket.
 *
 * @param surface - The canvas's drag surface
 * @param scale - The shared scale
 * @param movable - The element
 * @param to - Where it lands
 * @returns The candidate event
 */
export function candidateOf(surface: string, scale: PlanScale, movable: PlanMovable, to: PlanProposal): DragEventValue {
    const from = { surface, row: movable.rowKey, slot: slotOfInstant(scale, movable.span.start), event: some(movable.key) };
    const origin = originOf(movable, to);
    if (origin.kind === "resize") {
        const slot = origin.edge === "end" ? slotOfEnd(scale, to.span.end) : slotOfInstant(scale, to.span.start);
        return variant("resize", { event: { ...from, slot }, edge: variant(origin.edge, null) }) as DragEventValue;
    }
    return variant("move", {
        from,
        to: { surface, row: to.rowKey, slot: slotOfInstant(scale, to.span.start), event: none },
    }) as DragEventValue;
}

/** What the carry reads of the canvas. */
export interface PlanCarryDeps {
    /** The moves in flight. */
    store: PlanEditStore;
    /** The shared scale. */
    scale: PlanScale | undefined;
    /** The canvas's words. */
    words: PlanWords;
    /** The canvas's drag surface — `undefined` while nothing can move. */
    surface: string | undefined;
    /** The canvas's veto over a drop (`canDrop`). */
    veto: DropVeto | undefined;
    /** The rows as the canvas draws them — ↑ / ↓ walk them. */
    rows: readonly VisibleRow[];
    /** Whether a row takes a moved element of this item type. */
    takes: (row: PlanRowValue, items: string) => boolean;
    /** A row's name. */
    labelOf: (rowKey: RowKey) => string;
    /** Write a move as one gesture — whether it was drafted. */
    move: (m: PlanMoveRequest) => boolean;
    /** Bring a row into view. */
    reveal: (rowKey: RowKey) => void;
    /** Focus an element where it is now. */
    focus: (rowKey: RowKey, key: string) => void;
}

/** What {@link usePlanCarry} gives the canvas. */
export interface PlanCarryKeys {
    /** Pick up the element a node is — whether it moves. */
    start(node: Element): boolean;
    /** A key while carrying — whether the carry took it. */
    keys(e: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; preventDefault(): void }): boolean;
    /** End a carry without a drop, leaving focus where it went — the reader left the canvas. */
    cancel(): void;
}

/**
 * The keyboard's move — see the module docs.
 *
 * @param deps - What the carry reads of the canvas (the latest render's)
 * @returns Its start and its keys, stable
 */
export function usePlanCarry(deps: PlanCarryDeps): PlanCarryKeys {
    const latest = useRef(deps);
    latest.current = deps;

    /** Where the carried element lands now — said, and asked of the veto. */
    const rest = useCallback((carry: PlanCarry, to: PlanProposal, picked: boolean) => {
        const { store, scale, surface, veto, words, labelOf, rows } = latest.current;
        if (scale === undefined || surface === undefined) return;
        // Another row already drawing the element's key cannot take it (#825).
        const target = to.rowKey === carry.movable.rowKey ? undefined : rows.find((v) => v.row.key === to.rowKey)?.row;
        const refused = (target !== undefined && holdsKey(target, carry.movable.key))
            || (veto !== undefined && !unmoved(carry.movable, to) && !veto(candidateOf(surface, scale, carry.movable, to)));
        store.setCarry({ movable: carry.movable, to, refused });
        const p = { item: carry.movable.label, target: labelOf(to.rowKey), span: spanWords(scale, carry.movable, to.span, words) };
        store.say(picked ? words.m.movePickedUp(p) : refused ? words.m.moveRefused(p) : words.m.moveOver(p));
    }, []);

    const end = useCallback((carry: PlanCarry, dropped: boolean, refocus = true) => {
        const { store, scale, words, labelOf, move, focus } = latest.current;
        const { movable, to } = carry;
        store.setCarry(null);
        if (!dropped || scale === undefined || unmoved(movable, to)) {
            store.say(words.m.moveCancelled({ item: movable.label }));
            if (refocus) focus(movable.rowKey, movable.key);
            return;
        }
        const written = move({
            key: movable.key, from: movable.rowKey, to: to.rowKey, span: to.span,
            origin: originOf(movable, to).kind, label: movable.label,
        });
        if (!written) {
            store.say(words.m.moveFailed({ item: movable.label }));
            focus(movable.rowKey, movable.key);
            return;
        }
        store.say(words.m.moveDropped({ item: movable.label, target: labelOf(to.rowKey), span: spanWords(scale, movable, to.span, words) }));
        // The element is drawn anew with the draft — focus it there.
        store.focusAfterDraw(to.rowKey, movable.key);
    }, []);

    const start = useCallback((node: Element): boolean => {
        const { store, scale, surface } = latest.current;
        const movable = store.movableOf(node);
        if (movable === undefined || scale === undefined || surface === undefined) return false;
        const carry: PlanCarry = { movable, to: { rowKey: movable.rowKey, span: movable.span }, refused: false };
        rest(carry, carry.to, true);
        return true;
    }, [rest]);

    const keys = useCallback((e: Parameters<PlanCarryKeys["keys"]>[0]): boolean => {
        const { store, scale, rows, takes, reveal } = latest.current;
        const carry = store.carry;
        if (carry === null || scale === undefined) return false;
        // A shortcut (undo, a copy) ends the carry and goes on to do its work.
        if (e.ctrlKey || e.metaKey) {
            end(carry, false);
            return false;
        }
        switch (e.key) {
            case "ArrowLeft": case "ArrowRight": {
                e.preventDefault();
                const mode = e.shiftKey ? "end" : e.altKey ? "start" : "move";
                // A tile or a mark has one instant: no end to move.
                if (mode !== "move" && !carry.movable.resize) return true;
                rest(carry, { rowKey: carry.to.rowKey, span: stepSpan(scale, carry.to.span, mode, e.key === "ArrowRight" ? 1 : -1) }, false);
                return true;
            }
            case "ArrowUp": case "ArrowDown": {
                e.preventDefault();
                const dir = e.key === "ArrowDown" ? 1 : -1;
                const at = rows.findIndex((v) => v.row.key === carry.to.rowKey);
                for (let i = at + dir; at >= 0 && i >= 0 && i < rows.length; i += dir) {
                    const row = rows[i]!.row;
                    if (!takes(row, carry.movable.items)) continue;
                    rest(carry, { rowKey: row.key, span: carry.to.span }, false);
                    reveal(row.key);
                    break;
                }
                return true;
            }
            case " ": case "Enter": {
                e.preventDefault();
                if (carry.refused) {
                    // Refused here: said again, and the carry goes on.
                    rest(carry, carry.to, false);
                    return true;
                }
                end(carry, true);
                return true;
            }
            case "Escape": case "Tab":
                e.preventDefault();
                end(carry, false);
                return true;
            default:
                // Nothing else acts on the canvas while it carries an element.
                e.preventDefault();
                return true;
        }
    }, [rest, end]);

    const cancel = useCallback(() => {
        const carry = latest.current.store.carry;
        if (carry !== null) end(carry, false, false);
    }, [end]);

    return useMemo(() => ({ start, keys, cancel }), [start, keys, cancel]);
}
