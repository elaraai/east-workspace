/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's drop target (#1249, `Flowchart Builder Spec.md` §9.8, §10,
 * FB30–FB34): what the frame hands the canvas and the library so that a
 * library card lands, each drop — and each card's ⏎ — one `drop` transaction
 * of the open flow's session.
 *
 * - **The target** registers while a tab of the library drops, on the
 *   flowchart's drop target (`flowchartKeys(name).surface`), taking the cards
 *   of every such tab. A flowchart that edits nothing still takes a drag: its
 *   drop is refused, the ghost saying why, never lost on nothing.
 * - **The canvas's part** ({@link FlowchartCanvasDrop}) plans a drop over the
 *   open flow as its session holds it (`drop.ts`'s `planDrop`), says where it
 *   lands in the ghost's caption and to a screen reader, and vetoes what it
 *   refuses; the canvas works out where a drag rests from its own drawing.
 * - **A card's ⏎** — and, on a touch screen, a tap on the selected card —
 *   drops it on the canvas's selection (`enterAt`); refused, the footer says
 *   why, and a drop that lands clears it.
 *
 * A state a drop adds is selected (FB31). Every function the parts hold reads
 * the frame's latest state, so the parts stay put while the flowchart takes
 * drops.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { useDragTarget, type DragEventValue, type DragPayload, type DragTargetConfig } from "@elaraai/east-ui-components";
import type { flowchartKeys } from "@elaraai/e3-ui/internal";
import {
    cardOf, dropCaption, dropFlow, dropHostOf, dropLabel, dropName, dropRefusal, enterAt, planDrop, readDropAt,
    type FlowchartCanvasDrop, type FlowchartDropAt, type FlowchartDropCard, type FlowchartDropPlan, type FlowchartSelection,
} from "./drop.js";
import { flowchartLibraryId, flowchartTabKey } from "./library.js";
import type { FlowchartWords } from "./messages.js";
import type { FlowchartFlowValue, FlowchartValue } from "./model.js";

/** The names a flowchart keeps its viewer's state under. */
type FlowchartKeys = ReturnType<typeof flowchartKeys>;

/** What the frame hands its drop target. */
export interface FlowchartDropProps {
    /** The tabs the payload lists. */
    readonly library: FlowchartValue["library"];
    /** The names the flowchart keeps its state under: its library's id, and its drop target. */
    readonly keys: FlowchartKeys;
    /** The open flow as its session holds it now — never a render's copy — or `undefined` while none is open. */
    readonly now: () => FlowchartFlowValue | undefined;
    /** Whether the flowchart edits: a record, or the host's flows given `onApply`, and not read only. */
    readonly edits: boolean;
    /** Whether its session takes a gesture now. */
    readonly available: boolean;
    /** Records the flow a drop leaves as one `drop` transaction of the open flow's session, under its name; whether it was recorded. */
    readonly record: (flow: FlowchartFlowValue, label: string) => boolean;
    /** What the canvas has selected now. */
    readonly selection: () => FlowchartSelection | null;
    /** Selects the state a drop added (FB31) — scrolling it into view, for a card's ⏎. */
    readonly select: (key: string, scroll: boolean) => void;
    /** Says why a card's ⏎ was refused, in the footer; `undefined` clears it. */
    readonly notice: (text: string | undefined) => void;
    /** The flowchart's words. */
    readonly words: FlowchartWords;
}

/** What the drop target hands the canvas and the library. */
export interface FlowchartDropState {
    /** The canvas's drop cell; `undefined` while no tab of the library drops. */
    readonly canvas: FlowchartCanvasDrop | undefined;
    /** A card's ⏎ (FB34): the card, by its library and its key, dropped on the canvas's selection. */
    readonly enter: (library: string, key: string) => void;
}

/**
 * The flowchart's drop target — see the module docs.
 *
 * @param props - The tabs listed, the flowchart's keys, its open flow and session, the canvas's selection, the footer's line and the words
 * @returns The canvas's drop cell, and a card's ⏎
 */
export function useFlowchartDrop(props: FlowchartDropProps): FlowchartDropState {
    const { library, keys } = props;
    // The latest props, which every function of the parts reads: the parts stay put.
    const latest = useRef(props);
    latest.current = props;
    // Each tab of the library that drops, under the library its cards drag from.
    const host = useMemo(() => dropHostOf(keys.surface,
        library.flatMap((tab) => (tab.type === "flows" ? [] : [[flowchartLibraryId(keys, flowchartTabKey(tab)), tab] as const]))), [library, keys]);
    const drops = host.libraries.size > 0;

    /** What a card's drop where a drag rests does, over the open flow as its session holds it now. */
    const plan = useCallback((card: FlowchartDropCard, at: FlowchartDropAt): FlowchartDropPlan => {
        const p = latest.current;
        return planDrop(card, at, { flow: p.now(), edits: p.edits, available: p.available });
    }, []);
    /** A completed drag, or a candidate: the card it carries, and what its drop does. */
    const read = useCallback((event: DragEventValue): { readonly card: FlowchartDropCard; readonly plan: FlowchartDropPlan } | undefined => {
        if (event.type !== "add") return undefined;
        const card = cardOf(host, event.value.from.library, event.value.from.key);
        const at = readDropAt(event.value.into.row);
        return card === undefined || at === undefined ? undefined : { card, plan: plan(card, at) };
    }, [host, plan]);
    /** Runs a plan as one transaction — the footer's line cleared, and the state it adds selected; whether it was recorded. */
    const run = useCallback((card: FlowchartDropCard, planned: FlowchartDropPlan, scroll: boolean): boolean => {
        const p = latest.current;
        const flow = p.now();
        if (planned.kind === "refused" || flow === undefined) return false;
        const recorded = p.record(dropFlow(flow, planned), dropLabel(planned, card, p.words.m));
        if (!recorded) return false;
        p.notice(undefined);
        if (planned.kind === "add") p.select(planned.state.key, scroll);
        return true;
    }, []);

    // The flowchart's drop target, taking the cards of every tab of its library that drops.
    const target = useMemo((): DragTargetConfig | null => (!drops ? null : {
        id: host.surface,
        sources: [...host.libraries.keys()],
        kinds: { add: true },
        onDrag: (event) => {
            const drop = read(event);
            return drop !== undefined && run(drop.card, drop.plan, false);
        },
    }), [drops, host, read, run]);
    useDragTarget(target);

    const canvas = useMemo((): FlowchartCanvasDrop | undefined => {
        if (!drops) return undefined;
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
    }, [drops, host, plan, read]);

    // A card's ⏎ (FB34): a drop on the canvas's selection — refused, the footer says why.
    const enter = useCallback((libraryId: string, key: string) => {
        const card = cardOf(host, libraryId, key);
        if (card === undefined) return;
        const p = latest.current;
        const planned = plan(card, enterAt(card.lands, p.selection(), p.now()));
        if (planned.kind === "refused") {
            p.notice(dropRefusal(planned, p.words.m));
            return;
        }
        run(card, planned, true);
    }, [host, plan, run]);

    return { canvas, enter };
}
