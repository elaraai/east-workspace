/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the Flowchart has selected (#1503, `Flowchart Records Spec.md` R6, R8)
 * — pure and React-free: a state, a transition, a decision or a lane, by its
 * key — a lane by a click on its header — or several states, shift-, ⌘- or
 * Ctrl-clicked into one selection. The frame holds it: the canvas marks it and
 * Del deletes it, the inspector shows its Details, a card's ⏎ drops on it, and
 * a click on an issue selects what the issue names.
 *
 * - {@link toggleState} puts a state into the selection, or takes it out;
 * - {@link selectionHeld} is the selection as the canvas draws the records
 *   now: an Undo, a gesture that takes away what it names, or a narrowing
 *   that leaves it out — drawing it as context, or not at all — leaves
 *   nothing of it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import type { FlowchartModel } from "./model.js";

const keyEqual = equalFor(StringType);

/**
 * What is selected: one state, transition, decision or lane, by its key, or
 * several states, in the order they were selected.
 */
export type FlowchartSelection =
    | { readonly kind: "state" | "link" | "trigger" | "lane"; readonly key: string }
    | { readonly kind: "states"; readonly keys: readonly string[] };

/**
 * The states a selection holds: its one state, its several, or none.
 *
 * @param selection - What is selected
 * @returns The states' keys, in the order they were selected
 */
export function selectedStates(selection: FlowchartSelection | null): readonly string[] {
    if (selection === null) return [];
    if (selection.kind === "states") return selection.keys;
    return selection.kind === "state" ? [selection.key] : [];
}

/**
 * Whether two selections are one: what the canvas marks, and the inspector
 * shows, need not move.
 *
 * @param a - A selection, or none
 * @param b - Another, or none
 * @returns Whether they select the same, in the same order
 */
export function selectionEqual(a: FlowchartSelection | null, b: FlowchartSelection | null): boolean {
    if (a === null || b === null) return a === null && b === null;
    if (a.kind === "states" || b.kind === "states") {
        return a.kind === "states" && b.kind === "states" && a.keys.length === b.keys.length && a.keys.every((key, i) => keyEqual(key, b.keys[i]!));
    }
    return a.kind === b.kind && keyEqual(a.key, b.key);
}

/**
 * A state shift-, ⌘- or Ctrl-clicked: put into the selection, or — selected
 * already — taken out of it. A selection of anything but states starts again
 * from the state; several states taken down to one are that state alone.
 *
 * @param selection - What is selected
 * @param key - The state clicked
 * @returns The selection after the click; `null` when the click took out its last state
 */
export function toggleState(selection: FlowchartSelection | null, key: string): FlowchartSelection | null {
    const keys = selectedStates(selection);
    if (keys.length === 0) return { kind: "state", key };
    const kept = keys.filter((k) => !keyEqual(k, key));
    if (kept.length === keys.length) return { kind: "states", keys: [...keys, key] };
    if (kept.length === 0) return null;
    return kept.length === 1 ? { kind: "state", key: kept[0]! } : { kind: "states", keys: kept };
}

/**
 * Whether the canvas draws a state of a key as itself — its card, or the
 * ghost a transition naming it draws — never as context.
 *
 * @param model - What the canvas draws
 * @param key - The state's key
 * @returns Whether a path selects it
 */
export function drawsState(model: FlowchartModel, key: string): boolean {
    const node = model.nodesByKey.get(key);
    return node !== undefined && !node.dimmed;
}

/**
 * Whether the canvas draws a transition as itself — its line, or its state's
 * `↻ n` badge — never as context.
 *
 * @param model - What the canvas draws
 * @param key - The transition's key
 * @returns Whether a path selects it
 */
export function drawsTransition(model: FlowchartModel, key: string): boolean {
    return model.links.some((link) => keyEqual(link.key, key) && !link.dimmed)
        || model.nodes.some((node) => !node.dimmed && node.inPlaceKeys.some((k) => keyEqual(k, key)));
}

/**
 * The selection as the canvas draws the records now: what it names that the
 * canvas no longer draws as itself goes — a state, a transition, a decision
 * or a lane an Undo, a gesture or the narrowing took away — several states
 * keep those still drawn, and one left is that state alone. Only a lane of
 * the app's is selected: never *No lane*, nor the one band of a Flowchart
 * given no lanes.
 *
 * @param selection - What is selected
 * @param model - What the canvas draws, the drafts in place
 * @returns The selection itself while the canvas draws all it names — the same object — else what is left of it, or `null`
 */
export function selectionHeld(selection: FlowchartSelection | null, model: FlowchartModel): FlowchartSelection | null {
    if (selection === null) return null;
    switch (selection.kind) {
        case "state": return drawsState(model, selection.key) ? selection : null;
        case "link": return drawsTransition(model, selection.key) ? selection : null;
        case "trigger": return model.triggers.has(selection.key) ? selection : null;
        case "lane": return model.lanes.some((lane) => lane.band === "lane" && keyEqual(lane.key, selection.key)) ? selection : null;
        case "states": {
            const kept = selection.keys.filter((key) => drawsState(model, key));
            if (kept.length === selection.keys.length) return selection;
            if (kept.length === 0) return null;
            return kept.length === 1 ? { kind: "state", key: kept[0]! } : { kind: "states", keys: kept };
        }
    }
}
