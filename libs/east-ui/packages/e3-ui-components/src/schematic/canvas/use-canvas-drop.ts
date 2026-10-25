/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The canvas's drop cell (#1390): where a library card's drag rests over the
 * canvas — the point under the pointer, at the screen's resolution, for a card
 * that adds or places an item; the entity of the card's kind under it, found as
 * a tap finds it, for one that lands on an entity — and its mark, which the
 * painter draws and a card wears while the drop there lands (invariants 17,
 * 18). The canvas is the Schematic's drop target's one cell (`../use-drop.ts`);
 * what a drop does is `../drop.ts`'.
 *
 * The commit-phase snapshot reads the mark (`use-paint.ts`, invariant 1), and
 * the cell reads the snapshot: {@link useCanvasDropMark} holds the mark, and is
 * made before the snapshot; {@link useCanvasDrop} holds the cell, and is made
 * after it.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { StringType, equalFor } from "@elaraai/east";
import { useDragLayerOptional, useDropCell, type CellCoord, type DragPayload, type DropCellOptions } from "@elaraai/east-ui-components";
import type { SchematicValue } from "../data.js";
import {
    NOWHERE, dropPoint, markEqual, markOf, printDropAt, readDropAt, restsAt, type SchematicCanvasDrop, type SchematicDropMark,
} from "../drop.js";
import type { SchematicRef } from "./drawn";
import type { Camera } from "./use-camera";
import type { Gestures } from "./use-gestures";
import type { Paint } from "./use-paint";

const stringEqual = equalFor(StringType);

/** Where a drag rests over the canvas before it says otherwise: on nothing of its card's kind (#1390). */
const NOWHERE_AT = printDropAt(NOWHERE);

/**
 * Where a library card's drag rests over the canvas, marked (see the module docs).
 *
 * @returns Whether a library card is dragged, and the mark of where its drop lands, and what sets it
 */
export function useCanvasDropMark() {
    // Where a library card's drag rests while its drop lands there (#1390): the point it lands at, or the entity it
    // lands on — what the canvas marks. A drag over, nothing stays marked.
    const dragging = useDragLayerOptional()?.active ?? false;
    const [dropMark, setDropMark] = useState<SchematicDropMark | undefined>(undefined);
    useEffect(() => { if (!dragging) setDropMark(undefined); }, [dragging]);
    return { dragging, dropMark, setDropMark };
}

/** Where a library card's drag rests over the canvas, marked: {@link useCanvasDropMark}'s. */
export type CanvasDropMark = ReturnType<typeof useCanvasDropMark>;

/** What {@link useCanvasDrop} reads. */
export interface CanvasDropProps {
    /** The payload, decoded: its kinds, by which a card's kind is an item's, a zone's or a link's. */
    readonly value: SchematicValue;
    /** The canvas's drop cell, where a tab of the library drops (#1390); `undefined`, it takes no drop. */
    readonly drop: SchematicCanvasDrop | undefined;
    /** The canvas's element: what a drag's point is found over. */
    readonly canvasRef: RefObject<HTMLDivElement | null>;
    /** Each entity's reference by its id on the canvas. */
    readonly refById: ReadonlyMap<string, SchematicRef>;
    /** What never selects, by any path: a locked layer's entities, and what the narrowing takes out — and takes no drop. */
    readonly inertKeys: ReadonlySet<string>;
    /** The canvas's size, in CSS px; `null` before it is measured, when no cell registers. */
    readonly size: Camera["size"];
    /** The camera's live ref (`use-camera.ts`). */
    readonly cameraRef: Camera["cameraRef"];
    /** The commit-phase snapshot (`use-paint.ts`). */
    readonly renderSnapRef: Paint["renderSnapRef"];
    /** The item of a kind under a point, as a tap finds it (`use-gestures.ts`). */
    readonly itemKeyAt: Gestures["itemKeyAt"];
    /** The zone of a kind under a point, as a tap finds it (`use-gestures.ts`). */
    readonly zoneKeyAt: Gestures["zoneKeyAt"];
    /** The link or the net of a kind under a point, as a tap finds it (`use-gestures.ts`). */
    readonly linkKeyAt: Gestures["linkKeyAt"];
    /** Sets the mark of where a drag's drop lands ({@link useCanvasDropMark}'s). */
    readonly setDropMark: CanvasDropMark["setDropMark"];
}

/**
 * The canvas's drop cell (see the module docs).
 *
 * @param props - The payload and the frame's drop, the canvas's element and its size, the camera, the snapshot, the
 *   hit-tests, and what sets the mark
 * @returns The ref callback that registers the canvas's element as the cell
 */
export function useCanvasDrop({ value, drop, canvasRef, refById, inertKeys, size, cameraRef, renderSnapRef, itemKeyAt, zoneKeyAt, linkKeyAt, setDropMark }: CanvasDropProps) {
    // --- Drops (#1390): the canvas is one drop cell of the shared drag layer. ----
    // Where a drag rests is worked out from the drawing as it stands: the point
    // under the pointer, for a card that adds or places an item; the entity of
    // the card's kind under it — never a locked layer's — for one that lands on
    // an entity; and marked while the drop there lands.
    const sortOf = useMemo(() => new Map<string, "items" | "zones" | "links">([
        ...value.items.map((kind) => [kind.key, "items"] as const),
        ...value.zones.map((kind) => [kind.key, "zones"] as const),
        ...[...value.links, ...value.nets].map((kind) => [kind.key, "links"] as const),
    ]), [value.items, value.zones, value.links, value.nets]);
    /**
     * The entity of a kind under a client point, by the kind's slot: what a card of that kind lands on. An item's card
     * covers what is drawn under it, as it does from a tap: a zone or a link it covers takes no drop there.
     */
    const entityAt = useCallback((kind: string, clientX: number, clientY: number): SchematicRef | undefined => {
        const host = canvasRef.current;
        if (host === null) return undefined;
        const accept = (id: string): boolean => { const ref = refById.get(id); return ref !== undefined && stringEqual(ref.kind, kind); };
        const sort = sortOf.get(kind);
        if (sort !== "items" && typeof document !== "undefined") {
            const covering = document.elementFromPoint(clientX, clientY)?.closest("[data-card-key]")?.getAttribute("data-card-key");
            if (covering !== null && covering !== undefined && !inertKeys.has(covering)) return undefined;
        }
        const id = sort === "items" ? itemKeyAt(host, clientX, clientY, accept)
            : sort === "zones" ? zoneKeyAt(host, clientX, clientY, accept)
                : sort === "links" ? linkKeyAt(host, clientX, clientY, accept)?.key : undefined;
        return id === undefined ? undefined : refById.get(id);
    }, [refById, sortOf, itemKeyAt, zoneKeyAt, linkKeyAt, inertKeys, canvasRef]);
    /** Where a drag rests at a client point, for what it carries: the coordinate its drop's `CellRef` names. */
    const resolveDrop = useCallback((clientX: number, clientY: number, payload: DragPayload): CellCoord => {
        const surface = drop?.surface ?? "";
        const card = drop?.cardOf(payload);
        const host = canvasRef.current;
        const snap = renderSnapRef.current;
        if (card === undefined || host === null || snap.size === null || snap.fit === 0) return { surface, row: NOWHERE_AT, slot: "" };
        const rect = host.getBoundingClientRect();
        const cam = cameraRef.current;
        const ppuLive = snap.fit * cam.zoom;
        const point = dropPoint({ x: (clientX - rect.left - cam.tx) / ppuLive, y: (clientY - rect.top - cam.ty) / ppuLive }, ppuLive);
        return { surface, row: printDropAt(restsAt(card, point, (kind) => entityAt(kind, clientX, clientY))), slot: "" };
    }, [drop, entityAt, canvasRef, renderSnapRef, cameraRef]);
    /**
     * The drop cell's behaviour: the frame's words for where a drag rests, the canvas marking it. The caption is asked
     * each time the drag rests over the canvas, whether its drop lands there or not: the mark follows it — where the
     * drop lands, or nothing where it is refused — and goes when the drag rests elsewhere.
     */
    const dropOptions = useMemo((): DropCellOptions | undefined => {
        if (drop === undefined) return undefined;
        return {
            ...drop.options,
            caption: (coord, payload, allowed) => {
                const card = drop.cardOf(payload);
                const at = readDropAt(coord.row);
                const mark = card === undefined || at === undefined ? undefined : markOf(drop.plan(card, at));
                setDropMark((was) => (markEqual(was, mark) ? was : mark));
                return drop.options.caption(coord, payload, allowed);
            },
            onLeave: () => setDropMark(undefined),
        };
    }, [drop, setDropMark]);
    const dropCell = useDropCell(drop === undefined || size === null ? null : { surface: drop.surface, row: NOWHERE_AT, slot: "" },
        false, drop?.canDrop, resolveDrop, dropOptions);
    return dropCell;
}
