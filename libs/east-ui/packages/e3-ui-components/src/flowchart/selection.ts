/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * What the flowchart has selected (#1250, `Flowchart Builder Spec.md` §5.3,
 * FB17, FB34, FB36, FB37) — pure and React-free: a state, a transition, a
 * decision or a lane, by its key — a lane by a click on its header, as the
 * user ruled on 2026-10-08 — or several states, shift-, ⌘- or Ctrl-clicked
 * into one selection. The frame holds it, per open flow: the canvas marks it
 * and Del deletes it, the inspector shows its Details, a card's ⏎ drops on it
 * (FB34), and a click on an issue selects what the issue names (FB37).
 *
 * - {@link toggleState} puts a state into the selection, or takes it out;
 * - {@link selectionHeld} is the selection as the open flow holds it now: an
 *   Undo, or a gesture that takes away what it names, leaves nothing of it.
 *
 * @packageDocumentation
 */

import { StringType, equalFor } from "@elaraai/east";
import { linkKeyOf } from "./edits.js";
import type { FlowchartFlowValue } from "./model.js";

const keyEqual = equalFor(StringType);

/**
 * What is selected: one state, transition, decision or lane, by its key — a
 * transition's the key it goes by — or several states, in the order they were
 * selected.
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
 * Whether the flow holds a state of a key — a row of its own, or the ghost a
 * transition naming it draws (an unresolved transition's end).
 *
 * @param flow - The open flow
 * @param key - The state's key
 * @returns Whether the canvas draws a state of that key
 */
function drawsState(flow: FlowchartFlowValue, key: string): boolean {
    return flow.states.some((s) => keyEqual(s.key, key)) || flow.links.some((l) => keyEqual(l.from, key) || keyEqual(l.to, key));
}

/**
 * The selection as the open flow holds it now: what it names that the flow
 * no longer has goes — a state, a transition, a decision or a lane an Undo or
 * a gesture took away — several states keep those the flow still draws, and
 * one left is that state alone.
 *
 * @param selection - What is selected
 * @param flow - The open flow, as its drafts stand
 * @returns The selection itself while the flow holds all it names — the same object — else what is left of it, or `null`
 */
export function selectionHeld(selection: FlowchartSelection | null, flow: FlowchartFlowValue): FlowchartSelection | null {
    if (selection === null) return null;
    switch (selection.kind) {
        case "state": return drawsState(flow, selection.key) ? selection : null;
        case "link": return flow.links.some((l, i) => keyEqual(linkKeyOf(l, i), selection.key)) ? selection : null;
        case "trigger": return flow.triggers.some((t) => keyEqual(t.key, selection.key)) ? selection : null;
        case "lane": return flow.lanes.some((l) => keyEqual(l.key, selection.key)) ? selection : null;
        case "states": {
            const kept = selection.keys.filter((key) => drawsState(flow, key));
            if (kept.length === selection.keys.length) return selection;
            if (kept.length === 0) return null;
            return kept.length === 1 ? { kind: "state", key: kept[0]! } : { kind: "states", keys: kept };
        }
    }
}
