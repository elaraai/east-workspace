/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's drop target (#1390, `Schematic Builder Spec.md` §7, §8,
 * SC11–SC13): what the frame hands the canvas and the library so that a
 * library card lands, each drop — and each card's ⏎ — one step of the
 * editing's history.
 *
 * - **The target** registers while a tab of the library drops, on the
 *   Schematic's drop target (`schematicKeys(id).surface`), taking the cards
 *   of every such tab. A Schematic that edits nothing still takes a drag: its
 *   drop is refused, the ghost saying why, never lost on nothing.
 * - **The canvas's part** ({@link SchematicCanvasDrop}) plans a drop over the
 *   Schematic as it stands (`drop.ts`' `planDrop`), says where it lands in the
 *   ghost's caption and to a screen reader, and vetoes what it refuses; the
 *   canvas works out where a drag rests from its own drawing.
 * - **A card's ⏎** — and, on a touch screen, a tap on the selected card —
 *   drops it on the selection, or at the view's centre (`planEnter`);
 *   refused, the footer says why, and a drop that lands clears it.
 *
 * An item a drop adds or places is selected (SC12). Every function the parts
 * hold reads the frame's latest state, so the parts stay put while the
 * Schematic takes drops.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import type { schematicKeys } from "@elaraai/e3-ui/internal";
import { useDragTarget, type DragEventValue, type DragPayload, type DragTargetConfig } from "@elaraai/east-ui-components";
import type { BacklogEntry } from "./backlog.js";
import { entityId, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicValue } from "./data.js";
import {
    cardOf, dropCaption, dropEdits, dropHostOf, dropLabel, dropName, dropRefusal, droppedItem, planDrop, planEnter, readDropAt,
    type SchematicCanvasDrop, type SchematicDropAt, type SchematicDropCard, type SchematicDropContext, type SchematicDropPlan, type SchematicDropPoint,
} from "./drop.js";
import type { SchematicEdit } from "./edits.js";
import { schematicLibraryId } from "./library.js";
import type { SchematicWords } from "./messages.js";

/** The names a Schematic keeps its viewer's state under. */
type SchematicKeys = ReturnType<typeof schematicKeys>;

/** What the frame hands its drop target. */
export interface SchematicDropProps {
    /** The payload: its library's tabs, and its item, link and net kinds' templates. */
    readonly value: SchematicValue;
    /** The Backlog's rows in hand: what its cards place. */
    readonly backlog: readonly BacklogEntry[];
    /** What a card of the paged Backlog places, by its id (#1393); `undefined` while the Backlog lists only rows in hand. */
    readonly pagedBacklog?: ((key: string) => SchematicDropCard | undefined) | undefined;
    /** The names the Schematic keeps its state under: its library's id, and its drop target. */
    readonly keys: SchematicKeys;
    /** The Schematic as it stands now — never a render's copy: what a drop plans over. */
    readonly context: () => SchematicDropContext;
    /** Records a drop's edits as one step of the history, under its name; whether anything was recorded. */
    readonly record: (edits: readonly SchematicEdit[], label: string) => boolean;
    /** A new row's key: unique among every key the Schematic holds of the kind, and those given. */
    readonly mint: (slot: string, minted: ReadonlySet<string>) => string;
    /** What the canvas has selected now, each entity by its reference. */
    readonly selection: () => readonly SchematicRef[];
    /** The view's centre, at the screen's resolution; `undefined` while the canvas has no size. */
    readonly centre: () => SchematicDropPoint | undefined;
    /** Selects the item a drop added or placed, by its id. */
    readonly select: (id: string) => void;
    /** Says why a card's ⏎ was refused, in the footer; `undefined` clears it. */
    readonly notice: (text: string | undefined) => void;
    /** The Schematic's words. */
    readonly words: SchematicWords;
    /** The drawing's scale unit, if it has one: what the words measure a drop's point in. */
    readonly unit: string | undefined;
}

/** What the drop target hands the canvas and the library. */
export interface SchematicDropState {
    /** The canvas's drop cell; `undefined` while no tab of the library drops. */
    readonly canvas: SchematicCanvasDrop | undefined;
    /** A card's ⏎ (SC13): the card, by its library and its key, dropped on the selection or at the view's centre. */
    readonly enter: (library: string, key: string) => void;
}

/**
 * The Schematic's drop target — see the module docs.
 *
 * @param props - The payload and its backlog, the Schematic's keys, how a drop reads the Schematic and records itself, the
 *   canvas's selection and centre, what a drop selects, the footer's line, and the words
 * @returns The canvas's drop cell, and a card's ⏎
 */
export function useSchematicDrop(props: SchematicDropProps): SchematicDropState {
    const { value, backlog, pagedBacklog, keys } = props;
    // The latest props, which every function of the parts reads: the parts stay put.
    const latest = useRef(props);
    latest.current = props;
    // Each tab of the library that drops, under the library its cards drag from.
    const host = useMemo(() => dropHostOf(keys.surface, (tabKey) => schematicLibraryId(keys, tabKey), value.library,
        { items: value.items, links: value.links, nets: value.nets }, backlog, pagedBacklog),
    [keys, value.library, value.items, value.links, value.nets, backlog, pagedBacklog]);
    const drops = host.libraries.size > 0;

    /** What a card's drop where a drag rests does, over the Schematic as it stands now. */
    const plan = useCallback((card: SchematicDropCard, at: SchematicDropAt): SchematicDropPlan => planDrop(card, at, latest.current.context()), []);
    /** A completed drag, or a candidate: the card it carries, and what its drop does. */
    const read = useCallback((event: DragEventValue): { readonly card: SchematicDropCard; readonly plan: SchematicDropPlan } | undefined => {
        if (event.type !== "add") return undefined;
        const card = cardOf(host, event.value.from.library, event.value.from.key);
        const at = readDropAt(event.value.into.row);
        return card === undefined || at === undefined ? undefined : { card, plan: plan(card, at) };
    }, [host, plan]);
    /** Runs a plan as one step of the history — the footer's line cleared, and the item it adds or places selected; whether it was recorded. */
    const run = useCallback((card: SchematicDropCard, planned: SchematicDropPlan): boolean => {
        const p = latest.current;
        if (planned.kind === "refused") return false;
        const minted = new Set<string>();
        const edits = dropEdits(planned, (slot) => {
            const key = p.mint(slot, minted);
            minted.add(key);
            return key;
        });
        if (!p.record(edits, dropLabel(planned, card, p.words, p.unit))) return false;
        p.notice(undefined);
        const item = droppedItem(planned, edits);
        if (item !== undefined) p.select(entityId(item));
        return true;
    }, []);

    // The Schematic's drop target, taking the cards of every tab of its library that drops.
    const target = useMemo((): DragTargetConfig | null => (!drops ? null : {
        id: host.surface,
        sources: [...host.libraries.keys()],
        kinds: { add: true },
        onDrag: (event) => {
            const drop = read(event);
            return drop !== undefined && run(drop.card, drop.plan);
        },
    }), [drops, host, read, run]);
    useDragTarget(target);

    const canvas = useMemo((): SchematicCanvasDrop | undefined => {
        if (!drops) return undefined;
        const cardOfPayload = (payload: DragPayload): SchematicDropCard | undefined =>
            (payload.kind === "item" ? cardOf(host, payload.from.library, payload.from.key) : undefined);
        /** What a drop of what a drag carries does where its coordinate says it rests. */
        const planAt = (row: string, payload: DragPayload): SchematicDropPlan | undefined => {
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
                    return planned === undefined ? undefined : dropCaption(planned, latest.current.words, latest.current.unit);
                },
                name: (coord, payload) => {
                    const planned = planAt(coord.row, payload);
                    return planned === undefined ? "" : dropName(planned, latest.current.words, latest.current.unit);
                },
            },
        };
    }, [drops, host, plan, read]);

    // A card's ⏎ (SC13): a drop on the selection, or at the view's centre — refused, the footer says why.
    const enter = useCallback((libraryId: string, key: string) => {
        const card = cardOf(host, libraryId, key);
        if (card === undefined) return;
        const p = latest.current;
        const planned = planEnter(card, p.selection(), p.centre(), p.context());
        if (planned.kind === "refused") {
            p.notice(dropRefusal(planned, p.words));
            return;
        }
        // Not refused: whatever the footer said of an earlier ⏎ no longer holds — though a drop that changes nothing records nothing.
        p.notice(undefined);
        run(card, planned);
    }, [host, run]);

    return { canvas, enter };
}
