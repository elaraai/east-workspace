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
 * @packageDocumentation
 */

import { useCallback, useMemo, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { Box } from "@chakra-ui/react";
import { useDragEventChip, useDragEventEdge, type CellCoord, type DragHandle } from "../../../dnd/drag-layer";
import type { PlanScale } from "../scale.js";
import type { PlanWords } from "../words.js";
import { slotOfInstant, type PlanMoveMode, type PlanSpan } from "./move-math.js";
import { usePlanEdit, type PlanEditContextValue, type PlanMovable } from "./store.js";

/** What an element spreads to be picked up by the pointer, and described to the keyboard. */
export interface PlanElementHandle {
    ref: (el: HTMLElement | null) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    "data-draggable": "";
    "aria-describedby": string;
}

/** What an end handle spreads. */
export interface PlanEdgeHandle {
    ref: (el: HTMLElement | null) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    "data-plan-edge": "start" | "end";
}

/** What {@link usePlanMovable} gives an element. */
export interface PlanMovableProps {
    /** Spread onto the element — `undefined` when it does not move. */
    handle: PlanElementHandle | undefined;
    /** Its end handles, when it has two ends — spread each onto its handle. */
    edges: { start: PlanEdgeHandle; end: PlanEdgeHandle } | undefined;
    /** Whether the keyboard carries it now. */
    carried: boolean;
}

const NOTHING: PlanMovableProps = { handle: undefined, edges: undefined, carried: false };
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
    return (
        <Box css={styles.moveGhost} data-plan-ghost={movable.kind}>
            <Box as="span" css={styles.moveGhostLabel}>{movable.label}</Box>
            <Box as="span" css={styles.moveGhostSpan} data-plan-ghost-span>{spanWords(edit.scale, movable, span, edit.words)}</Box>
        </Box>
    );
}

/**
 * An element's moves — its drag handle, its end handles and whether the
 * keyboard carries it (see the module docs).
 *
 * @param movable - The element, or `undefined` when its row takes no move
 * @returns What it spreads
 */
export function usePlanMovable(movable: PlanMovable | undefined): PlanMovableProps {
    const edit = usePlanEdit();
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
    const startHandle = useDragEventEdge(edgeFrom, "start", ghost, false, label);
    const endHandle = useDragEventEdge(edgeFrom, "end", ghost, false, label);

    /** Record the press — what the drag moves and where it was grabbed. */
    const arm = useCallback((e: ReactPointerEvent, mode: PlanMoveMode) => {
        if (edit === null || movable === undefined) return;
        const plot = (e.currentTarget as HTMLElement).closest("[data-plan-plot]");
        const rect = plot?.getBoundingClientRect();
        const grabFrac = rect !== undefined && rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
        edit.store.arm({ movable, mode, grabFrac }, (e.currentTarget as HTMLElement).ownerDocument);
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
            "data-draggable": "",
            "aria-describedby": edit.helpId,
        };
    }, [edit, movable, moveHandle, arm]);

    const edgeOf = useCallback((h: DragHandle | undefined, which: "start" | "end"): PlanEdgeHandle | undefined => (h === undefined
        ? undefined
        : {
            ref: h.ref,
            onPointerDown: (e) => {
                arm(e, which);
                h.onPointerDown?.(e);
                // The element's own press is a move: an end's press is not.
                e.stopPropagation();
            },
            "data-plan-edge": which,
        }), [arm]);
    const edges = useMemo(() => {
        const start = edgeOf(startHandle, "start");
        const end = edgeOf(endHandle, "end");
        return start !== undefined && end !== undefined ? { start, end } : undefined;
    }, [edgeOf, startHandle, endHandle]);

    const carried = useSyncExternalStore(
        edit !== null ? edit.store.subscribe : noSubscribe,
        () => (edit !== null && movable !== undefined ? edit.store.carries(movable.rowKey, movable.key) : false));
    if (!on) return carried ? { ...NOTHING, carried } : NOTHING;
    return { handle, edges, carried };
}
