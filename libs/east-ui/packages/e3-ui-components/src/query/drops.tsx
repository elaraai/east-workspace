/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Dropping a query into the builder (#939, `Query Editor Spec.md` §4.13): a
 * card of a `<Query.Library>` dragged onto the builder opens its query, as
 * Studio's canvas takes the palette's cards — through the shared drag layer.
 *
 * - **The target** is the builder's, named by its id. It takes `add`s from
 *   the query library that shares the id (`queryKeys(id).library`, the cards
 *   keyed by the saved query's name) on one cell: the builder's frame
 *   (#1125) — its toolbar, the pane, the results and the status line.
 * - **Its veto** takes a card whose query can open here and refuses any
 *   other: the ⊘ stage. The cell's name is what the drag layer says the drag
 *   rests over, so a refused card's name carries the builder's reason, and the
 *   layer announces it.
 * - **A drop** opens the dropped query.
 * - **Its look** is the `queryBuilder` recipe's `dropTarget` over the frame:
 *   armed while a card it takes is dragged, over while one rests on it — pure
 *   CSS on the layer's `data-drop-valid` / `data-drop-active` — with "Drop to
 *   open “{name}”" and "{n} steps.", the name kept from the veto's candidate.
 *
 * Without a `DragLayerProvider` on the page there is no target: the frame
 * renders alone, as it would without one.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { queryKeys } from "@elaraai/e3-ui/internal";
import {
    useDragLayerOptional, useDragTarget, useDropCell,
    type CellCoord, type DragEventValue, type DragTargetConfig, type DropCellOptions, type DropVeto,
} from "@elaraai/east-ui-components";
import type { QueryWords } from "./model/words.js";
import type { Styles } from "./parts.js";

/** The drop target's one cell's row: the builder's body, in its frame. */
const BODY = "body";

/**
 * The builder's drop target's id: the builder's name, as `queryKeys` names
 * the builder's keys — so two builders on one surface are two targets.
 *
 * @param id - The builder's id; omitted, the one builder
 * @returns The target's id
 */
function dropTargetId(id: string | undefined): string {
    return id === undefined ? "query.builder" : `query.builder.${id}`;
}

/** Props of {@link QueryDropTarget}. */
export interface QueryDropTargetProps {
    /** The builder's id (`queryKeys(id)`'s), naming its drop target. */
    readonly id: string | undefined;
    /** Why a query of a name can't open here, in the builder's words; undefined when it can. */
    readonly refusal: (name: string) => string | undefined;
    /** How many steps the query of a name has, for the target's words; undefined when unknown. */
    readonly steps: (name: string) => number | undefined;
    /** Opens the query of a name — what dropping it does. */
    readonly onOpen: (name: string) => void;
    /** The words. */
    readonly words: QueryWords;
    /** The builder's frame: the toolbar, the pane, the results and the status line. */
    readonly children: ReactNode;
}

/**
 * The builder's frame as a drop target for the query library's cards — see
 * the module docs. The builder wraps its frame in it: with a drag layer on the
 * page the frame sits in the target's zone, which takes the frame's place;
 * without one, the frame renders alone.
 *
 * @param props - The builder's id, the refusal and the steps of a query by name, what a drop does, the words and the frame ({@link QueryDropTargetProps})
 * @returns The frame, in its drop zone when a drag layer is on the page
 */
export function QueryDropTarget({ id, refusal, steps, onOpen, words, children }: QueryDropTargetProps): ReactElement {
    const layer = useDragLayerOptional();
    const styles = useSlotRecipe({ key: "queryBuilder" })() as Styles;
    const m = words.messages;
    const surface = dropTargetId(id);
    const library = queryKeys(id).library;
    const dragging = layer?.active ?? false;

    // The query a card in flight would open: kept from the veto's candidate,
    // for the target's words, until the drag ends.
    const [candidate, setCandidate] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (!dragging) setCandidate(undefined);
    }, [dragging]);
    const veto = useCallback<DropVeto>((event) => {
        if (event.type !== "add") return false;
        const name = event.value.from.key;
        setCandidate(name);
        return refusal(name) === undefined;
    }, [refusal]);

    // A drop opens its query; one that can't open here was refused before it reached here.
    const onDrag = useCallback((event: DragEventValue): boolean => {
        if (event.type !== "add") return false;
        const name = event.value.from.key;
        if (refusal(name) !== undefined) return false;
        onOpen(name);
        return true;
    }, [refusal, onOpen]);
    const target = useMemo((): DragTargetConfig => ({ id: surface, sources: [library], kinds: { add: true }, onDrag }), [surface, library, onDrag]);
    useDragTarget(target);

    // The one cell. Its name is what the layer says the drag rests over — the builder, and for a card it refuses, why.
    const coord = useMemo((): CellCoord => ({ surface, row: BODY, slot: "" }), [surface]);
    const options = useMemo((): DropCellOptions => ({
        name: (_at, payload) => {
            const reason = payload.kind === "item" ? refusal(payload.from.key) : undefined;
            return reason === undefined ? m.dropTargetName() : m.dropRefusedName({ reason });
        },
    }), [refusal, m]);
    const cell = useDropCell(coord, false, veto, undefined, options);

    if (layer === null) return <>{children}</>;
    const name = dragging ? candidate : undefined;
    const count = name === undefined ? undefined : steps(name);
    return (
        <Box ref={cell} css={styles.dropZone} data-query-drop="">
            {children}
            {name !== undefined && (
                <Box css={styles.dropTarget} aria-hidden data-query-drop-target="">
                    <Box as="span" css={styles.dropTitle} data-query-drop-title="">{m.dropToOpen({ name })}</Box>
                    {count !== undefined && (
                        <Box as="span" css={styles.dropMeta} data-query-drop-steps="">
                            {m.dropSteps({ count: words.formatters.number(count), n: count })}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}
