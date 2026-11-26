/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An element that moves (#825) — what a run bar, a chip, a tile or a mark
 * spreads to be picked up: its drag handle on the drag layer (#608), its two
 * end handles when it has two ends, and the ghost that follows the pointer.
 *
 * The pointer picks it up through the drag layer, which carries the drag —
 * the edge scroller, the veto on the event the drop would deliver, the
 * announcements. The press is recorded first (`PlanEditStore.arm`): what the
 * drag moves and where it was grabbed, which is how a row says where it lands.
 * The keyboard is the canvas's own (`use-carry.ts`): an element takes no key
 * from the layer, since its moves need keys the layer's arrows cannot carry —
 * an end moved with Shift or Alt, a row found by its item type.
 *
 * An element's two end handles are drawn only while it is in hand (#1780): the
 * pointer over it, the keyboard's focus on it, selected — a touch screen's way
 * to it — or one of its ends held down until the press ends, wherever the
 * pointer has gone. Every element a screen draws took them at rest, each a
 * drag handle of its own on the layer, which every drag starting or ending
 * drew again: they were most of what a change of period made. Their grips are
 * unseen until the pointer is over the element, so it draws as it did.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MoveGhost, useMoveGhostClasses } from "../../shared/schedule/move-ghost.js";
import { useDragEventChip, useDragEventEdge, type CellCoord, type DragHandle } from "@elaraai/east-ui-components";
import { slotOfInstant } from "../../shared/time/slot.js";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import { usePlanEdit, type PlanEditContextValue, type PlanMovable, type PlanMoveMode, type PlanSpan } from "./store.js";

/** What an element spreads to be picked up by the pointer, and described to the keyboard. */
export interface PlanElementHandle {
    ref: (el: HTMLElement | null) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    /** An element whose ends move: the pointer coming over it and going, and the focus, take it in hand and let it go. */
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
    "data-draggable": "";
    "aria-describedby": string;
}

/** What an element's end handles are made from, while it is in hand: {@link PlanMoveEdges} draws them. */
export interface PlanMoveEnds {
    /** The drag grammar's `from`: the element's row, the bucket its start is in, and its key. */
    from: Required<CellCoord>;
    /** What follows the pointer. */
    ghost: ReactNode;
    /** The element's name, for the announcements. */
    label: string | undefined;
    /** Record an end's press — what the drag moves and where it was grabbed — and hold the element in hand until the press ends. */
    press: (e: ReactPointerEvent, which: "start" | "end") => void;
}

/** What {@link usePlanMovable} gives an element. */
export interface PlanMovableProps {
    /** Spread onto the element — `undefined` when it does not move. */
    handle: PlanElementHandle | undefined;
    /** Its end handles' makings, when it has two ends and is in hand (see the module docs) — drawn by {@link PlanMoveEdges}. */
    ends: PlanMoveEnds | undefined;
    /** Whether the keyboard carries it now. */
    carried: boolean;
}

const NOTHING: PlanMovableProps = { handle: undefined, ends: undefined, carried: false };
const noSubscribe = () => () => undefined;

/**
 * Where an element is, in words — a run's or a chip's span, a tile's or a
 * mark's instant.
 *
 * @param scale - The shared scale
 * @param movable - The element
 * @param span - Its extent
 * @param w - The canvas's words
 * @returns `Jul 13, 2026 – Aug 3, 2026`, or `Jul 13, 2026`
 */
export function spanWords(scale: PlanScale, movable: Pick<PlanMovable, "resize">, span: PlanSpan, w: PlanWords): string {
    return movable.resize
        ? w.m.span({ from: scale.instantText(span.start), to: scale.instantText(span.end) })
        : scale.instantText(span.start);
}

/**
 * The ghost — the element's look beside the pointer, labelled with where it
 * would land. Drawn by the drag layer's overlay, outside the canvas, so it
 * takes what it shows as props.
 */
function PlanMoveGhost({ edit, movable }: { edit: PlanEditContextValue; movable: PlanMovable }) {
    const proposal = useSyncExternalStore(edit.store.subscribe, () => edit.store.proposal);
    const span = proposal?.span ?? movable.span;
    const styles = edit.styles;
    // Connect held (#1541, U10): the ghost says the link the element's drag draws, in place of where a move would land.
    const detail = edit.connecting !== undefined ? edit.words.m.connectGhost({ kind: edit.connecting }) : spanWords(edit.scale, movable, span, edit.words);
    return <MoveGhost styles={styles} label={movable.label} detail={detail} planKind={movable.kind} />;
}

/**
 * An element's moves — its drag handle, its end handles while it is in hand,
 * and whether the keyboard carries it (see the module docs).
 *
 * @param movable - The element, or `undefined` when its row takes no move
 * @param selected - Whether the element is selected: in hand, as the pointer over it is
 * @returns What it spreads
 */
export function usePlanMovable(movable: PlanMovable | undefined, selected = false): PlanMovableProps {
    const edit = usePlanEdit();
    // In hand (see the module docs): the pointer over it, the focus on it, an end of it held down.
    const [over, setOver] = useState(false);
    const [focused, setFocused] = useState(false);
    const [held, setHeld] = useState(false);
    // Its ghost's classes, made as the element is drawn, ahead of the drag that first draws one (#1594).
    useMoveGhostClasses(edit?.styles);
    const surface = edit?.surface;
    const scale = edit?.scale;
    const on = edit !== null && surface !== undefined && movable !== undefined;
    // The drag grammar's `from`: the element's row, the bucket its start is
    // in, and its key.
    const startSlot = on && scale !== undefined ? slotOfInstant(scale, movable.span.start) : undefined;
    const from = useMemo<Required<CellCoord> | null>(
        () => (surface !== undefined && movable !== undefined && startSlot !== undefined
            ? { surface, row: movable.rowKey, slot: startSlot, event: movable.key }
            : null),
        [surface, movable, startSlot]);
    const ghost = useMemo(
        () => (edit !== null && movable !== undefined ? <PlanMoveGhost edit={edit} movable={movable} /> : null),
        [edit, movable]);
    const label = movable?.label;
    const moveHandle = useDragEventChip(on ? from : null, ghost, false, label);
    const edgeFrom = on && movable.resize ? from : null;
    // Only an element whose ends move follows the pointer and the focus: one that only moves draws nothing more for them.
    const ends = edgeFrom !== null;

    /** Record the press — what the drag moves and where it was grabbed. */
    const arm = useCallback((e: ReactPointerEvent, mode: PlanMoveMode) => {
        if (edit === null || movable === undefined) return;
        const plot = (e.currentTarget as HTMLElement).closest("[data-plan-plot]");
        const rect = plot?.getBoundingClientRect();
        const grabFrac = rect !== undefined && rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
        edit.store.arm({ movable, mode, grabFrac, node: e.currentTarget }, (e.currentTarget as HTMLElement).ownerDocument);
    }, [edit, movable]);

    const handle = useMemo<PlanElementHandle | undefined>(() => {
        if (edit === null || movable === undefined || moveHandle === undefined) return undefined;
        const node = moveHandle.ref;
        return {
            ref: (el) => {
                node(el);
                if (el !== null) edit.store.register(el, movable);
            },
            onPointerDown: (e) => {
                arm(e, "move");
                moveHandle.onPointerDown?.(e);
            },
            ...(ends ? {
                onPointerEnter: () => setOver(true),
                onPointerLeave: () => setOver(false),
                onFocus: () => setFocused(true),
                onBlur: () => setFocused(false),
            } : {}),
            "data-draggable": "",
            "aria-describedby": edit.helpId,
        };
    }, [edit, movable, moveHandle, arm, ends]);

    /** An end's press: recorded, and the element held in hand until the press ends, wherever the pointer goes meanwhile. */
    const press = useCallback((e: ReactPointerEvent, which: "start" | "end") => {
        arm(e, which);
        const doc = (e.currentTarget as HTMLElement).ownerDocument;
        const letGo = () => {
            setHeld(false);
            doc.removeEventListener("pointerup", letGo, true);
            doc.removeEventListener("pointercancel", letGo, true);
        };
        doc.addEventListener("pointerup", letGo, true);
        doc.addEventListener("pointercancel", letGo, true);
        setHeld(true);
    }, [arm]);
    const inHand = over || focused || held || selected;
    const moveEnds = useMemo<PlanMoveEnds | undefined>(
        () => (inHand && edgeFrom !== null ? { from: edgeFrom, ghost, label, press } : undefined),
        [inHand, edgeFrom, ghost, label, press]);

    const carried = useSyncExternalStore(
        edit !== null ? edit.store.subscribe : noSubscribe,
        () => (edit !== null && movable !== undefined ? edit.store.carries(movable.rowKey, movable.key) : false));
    if (!on) return carried ? { ...NOTHING, carried } : NOTHING;
    return { handle, ends: moveEnds, carried };
}

/** One end handle: its drag handle on the layer, and its press — an end's, never the element's move. */
function PlanMoveEdge({ handle, which, ends, className }: {
    handle: DragHandle | undefined; which: "start" | "end"; ends: PlanMoveEnds; className: string;
}) {
    if (handle === undefined) return null;
    return (
        <div className={className} ref={handle.ref} data-plan-edge={which}
            onPointerDown={(e) => {
                ends.press(e, which);
                handle.onPointerDown?.(e);
                // The element's own press is a move: an end's press is not.
                e.stopPropagation();
            }} />
    );
}

/**
 * An element's two end handles (#825), drawn while it is in hand (#1780, see the module docs): the element's first and
 * last few pixels, where a press drags that end.
 *
 * @param props.ends - Their makings, from {@link usePlanMovable}
 * @param props.className - Their class — made by the element as it is drawn, never as a hover first draws them: a rule
 *   added while the pointer is over the page lays the page out again (#1594)
 * @returns The two handles
 */
export function PlanMoveEdges({ ends, className }: { ends: PlanMoveEnds; className: string }) {
    const start = useDragEventEdge(ends.from, "start", ends.ghost, false, ends.label);
    const end = useDragEventEdge(ends.from, "end", ends.ghost, false, ends.label);
    return (
        <>
            <PlanMoveEdge handle={start} which="start" ends={ends} className={className} />
            <PlanMoveEdge handle={end} which="end" ends={ends} className={className} />
        </>
    );
}
