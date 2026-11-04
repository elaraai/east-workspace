/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's drop target (#1501, `Flowchart Records Spec.md` R14, D5,
 * D8): what the frame hands the canvas and the library so that a library card
 * lands, each drop — and each card's ⏎ — one step of the editing's history.
 *
 * - **The target** registers while a tab of the library drops, on the
 *   Flowchart's drop target (`flowchartKeys(name).surface`), taking the cards
 *   of every such tab: the Steps, Transitions and Lanes tabs', and an author's
 *   tab's whose patch names a kind. A Flowchart that edits nothing still takes
 *   a drag: its drop is refused, the ghost saying why, never lost on nothing.
 * - **The canvas's part** ({@link FlowchartCanvasDrop}) plans a drop over the
 *   Flowchart as it stands (`drop.ts`' `planDrop`), says where it lands in the
 *   ghost's caption and to a screen reader, and vetoes what it refuses; the
 *   canvas works out where a drag rests from its own drawing.
 * - **A card's ⏎** — and, on a touch screen or below 480px of main, a tap on
 *   the selected card — drops it on the canvas's selection (`enterAt`);
 *   refused, the footer says why, and a drop that lands clears it.
 *
 * Below 480px of main no card drags: no target registers and the canvas has
 * no drop cell, and a card's ⏎ — a tap on the selected card — is how a card
 * lands.
 *
 * A state or a lane a drop adds is selected. Every function the parts hold
 * reads the frame's latest state, so the parts stay put while the Flowchart
 * takes drops.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import type { flowchartKeys } from "@elaraai/e3-ui/internal";
import { getSomeorUndefined, useDragTarget, type DragEventValue, type DragPayload, type DragTargetConfig } from "@elaraai/east-ui-components";
import {
    cardOf, dropCaption, dropEdits, dropHostOf, dropLabel, dropName, dropRefusal, droppedSelection, enterAt, landsOf, planDrop, readDropAt,
    type FlowchartCanvasDrop, type FlowchartDropAt, type FlowchartDropCard, type FlowchartDropContext, type FlowchartDropPlan,
} from "./drop.js";
import type { FlowchartEdit } from "./editing.js";
import type { FlowchartHolding } from "./edits.js";
import { flowchartLibraryId } from "./library.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartValue } from "./model.js";
import type { FlowchartSelection } from "./selection.js";

/** The names a Flowchart keeps its viewer's state under. */
type FlowchartKeys = ReturnType<typeof flowchartKeys>;

/** What the frame hands its drop target. */
export interface FlowchartDropProps {
    /** The payload: its library's tabs, and its kinds' cards. */
    readonly value: FlowchartValue;
    /** The names the Flowchart keeps its state under: its library's id, and its drop target. */
    readonly keys: FlowchartKeys;
    /** The Flowchart as it stands now — never a render's copy: what a drop plans over. */
    readonly context: () => FlowchartDropContext;
    /** What the Flowchart holds now: what a drop's edits are made over. */
    readonly holding: () => FlowchartHolding;
    /** Records a drop's edits as one step of the history, under its name; whether anything was recorded. */
    readonly record: (edits: readonly FlowchartEdit[], label: string) => boolean;
    /** What the canvas has selected now. */
    readonly selection: () => FlowchartSelection | null;
    /** Selects the state or the lane a drop added — scrolling it into view, for a card's ⏎. */
    readonly select: (selection: FlowchartSelection, scroll: boolean) => void;
    /** Says why a card's ⏎ was refused, in the footer; `undefined` clears it. */
    readonly notice: (text: string | undefined) => void;
    /** The Flowchart's words. */
    readonly words: FlowchartWords;
    /** Whether a card drags onto the canvas: `false` below 480px of main, where no target registers and the canvas has no drop cell. */
    readonly drags?: boolean | undefined;
}

/** What the drop target hands the canvas and the library. */
export interface FlowchartDropState {
    /** The canvas's drop cell; `undefined` while no tab of the library drops, or no card drags. */
    readonly canvas: FlowchartCanvasDrop | undefined;
    /** A card's ⏎: the card, by its library and its key, dropped on the canvas's selection. */
    readonly enter: (library: string, key: string) => void;
}

/**
 * The Flowchart's drop target — see the module docs.
 *
 * @param props - The payload, the Flowchart's keys, how a drop reads the Flowchart and records itself, the canvas's
 *   selection, what a drop selects, the footer's line, and the words
 * @returns The canvas's drop cell, and a card's ⏎
 */
export function useFlowchartDrop(props: FlowchartDropProps): FlowchartDropState {
    const { value, keys, drags = true } = props;
    // The latest props, which every function of the parts reads: the parts stay put.
    const latest = useRef(props);
    latest.current = props;
    // Each tab of the library that drops, under the library its cards drag from.
    const host = useMemo(() => dropHostOf(keys.surface, (tabKey) => flowchartLibraryId(keys, tabKey), value.library, {
        states: value.states.templates,
        transitions: getSomeorUndefined(value.transitions)?.templates ?? [],
        lanes: getSomeorUndefined(value.lanes)?.templates ?? [],
    }), [keys, value.library, value.states, value.transitions, value.lanes]);
    const drops = host.libraries.size > 0;

    /** What a card's drop where a drag rests does, over the Flowchart as it stands now. */
    const plan = useCallback((card: FlowchartDropCard, at: FlowchartDropAt): FlowchartDropPlan => planDrop(card, at, latest.current.context()), []);
    /** A completed drag, or a candidate: the card it carries, and what its drop does. */
    const read = useCallback((event: DragEventValue): { readonly card: FlowchartDropCard; readonly plan: FlowchartDropPlan } | undefined => {
        if (event.type !== "add") return undefined;
        const card = cardOf(host, event.value.from.library, event.value.from.key);
        const at = readDropAt(event.value.into.row);
        return card === undefined || at === undefined ? undefined : { card, plan: plan(card, at) };
    }, [host, plan]);
    /** Records a plan as one step of the history — the footer's line cleared, and the state or lane it adds selected; whether it was recorded. */
    const run = useCallback((card: FlowchartDropCard, planned: FlowchartDropPlan, scroll: boolean): boolean => {
        const p = latest.current;
        if (planned.kind === "refused") return false;
        const edits = dropEdits(planned, p.holding());
        if (edits === undefined || !p.record(edits.edits, dropLabel(planned, card, p.words.m))) return false;
        p.notice(undefined);
        const selection = droppedSelection(planned, edits);
        if (selection !== undefined) p.select(selection, scroll);
        return true;
    }, []);

    // The Flowchart's drop target, taking the cards of every tab of its library that drops — while a card drags.
    const target = useMemo((): DragTargetConfig | null => (!drops || !drags ? null : {
        id: host.surface,
        sources: [...host.libraries.keys()],
        kinds: { add: true },
        onDrag: (event) => {
            const drop = read(event);
            return drop !== undefined && run(drop.card, drop.plan, false);
        },
    }), [drops, drags, host, read, run]);
    useDragTarget(target);

    const canvas = useMemo((): FlowchartCanvasDrop | undefined => {
        if (!drops || !drags) return undefined;
        const cardOfPayload = (payload: DragPayload): FlowchartDropCard | undefined =>
            (payload.kind === "item" ? cardOf(host, payload.from.library, payload.from.key) : undefined);
        /** What a drop of what a drag carries does where its coordinate says it rests. */
        const planAt = (row: string, payload: DragPayload): FlowchartDropPlan | undefined => {
            const card = cardOfPayload(payload);
            const at = readDropAt(row);
            return card === undefined || at === undefined ? undefined : plan(card, at);
        };
        return {
            surface: host.surface,
            cardOf: cardOfPayload,
            plan,
            canDrop: (event) => {
                const drop = read(event);
                return drop !== undefined && drop.plan.kind !== "refused";
            },
            options: {
                caption: (coord, payload) => {
                    const planned = planAt(coord.row, payload);
                    return planned === undefined ? undefined : dropCaption(planned, latest.current.words.m);
                },
                name: (coord, payload) => {
                    const planned = planAt(coord.row, payload);
                    return planned === undefined ? "" : dropName(planned, latest.current.words.m);
                },
            },
        };
    }, [drops, drags, host, plan, read]);

    // A card's ⏎: a drop on the canvas's selection — refused, the footer says why.
    const enter = useCallback((libraryId: string, key: string) => {
        const card = cardOf(host, libraryId, key);
        if (card === undefined) return;
        const p = latest.current;
        const context = p.context();
        const planned = planDrop(card, enterAt(landsOf(card), p.selection(), context.model), context);
        if (planned.kind === "refused") {
            p.notice(dropRefusal(planned, p.words.m));
            return;
        }
        // Not refused: whatever the footer said of an earlier ⏎ no longer holds — though a drop that changes nothing records nothing.
        p.notice(undefined);
        run(card, planned, true);
    }, [host, run]);

    return { canvas, enter };
}
