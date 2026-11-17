/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Connect's draft line (#1541, U10): while a Connect drag is in flight, one
 * line from the event it runs from to the pointer — or, over an event the
 * link may end at, into that event's start: the snap. It is the links layer's
 * own preview (`shared/links/layer.tsx`), routed as every link is
 * (`shared/links/geometry.ts`), in the rows' coordinates, so it lies under the
 * row controls and scrolls with the rows.
 *
 * Its ends are the elements as the page lays them out now — the pressed
 * element's box and the target's — read when the pointer moves, as a drag's
 * ghost is placed: a draft lasts a gesture and joins no model. A link refused
 * where the drag rests does not snap; its line follows the pointer, and the
 * ghost says why.
 *
 * @packageDocumentation
 */

import { useRef, useSyncExternalStore } from "react";
import { Box } from "@chakra-ui/react";
import { LinksLayer, type LinkRibbon } from "../../shared/links/layer.js";
import { routeRibbon, type RibbonEnd } from "../../shared/links/geometry.js";
import type { PlanEditStore } from "../edit/store.js";
import { useElementHeight, useElementWidth } from "../use-element-height.js";

type Styles = Record<string, Record<string, unknown>>;

/** A draft has no link to draw beside it, and nothing to hit. */
const NO_RIBBONS: readonly LinkRibbon[] = [];
const NO_HIT = () => ({});
/** The weight a link with no quantity draws at: a draft's. */
const DRAFT_WEIGHT = 1.5;

/** Props of {@link ConnectOverlay}. */
export interface ConnectOverlayProps {
    /** The resolved `plan` recipe styles (the `ribbons` slot). */
    styles: Styles;
    /** The canvas's moves in flight: the element pressed, and where the draft ends now. */
    store: PlanEditStore;
    /** The grid's fixed track before the plot: the gutter (px). */
    gutterPx: number;
}

/** A box on the page as an end in the layer's own px. */
function endOf(box: DOMRect, layer: DOMRect): RibbonEnd {
    return { leftX: box.left - layer.left, rightX: box.right - layer.left, top: box.top - layer.top, bottom: box.bottom - layer.top };
}

/** Connect's draft line, in the rows' coordinates — `VirtualRows`' overlay while Connect is held. */
export function ConnectOverlay({ styles, store, gutterPx }: ConnectOverlayProps) {
    const draft = useSyncExternalStore(store.subscribeDraft, () => store.connectDraft);
    const layerRef = useRef<HTMLDivElement | null>(null);
    // The layer lies over the rows' box: its own width and height are the drawing's.
    const width = useElementWidth(layerRef, true);
    const height = useElementHeight(layerRef, true) ?? 0;
    const layer = layerRef.current?.getBoundingClientRect();
    const from = store.grab?.node;
    // The line: out of the pressed element's end, into the target's start — or to the pointer, a point.
    const line = draft === null || layer === undefined || from === undefined ? undefined : routeRibbon(
        endOf(from.getBoundingClientRect(), layer),
        draft.onto !== undefined ? endOf(draft.onto.getBoundingClientRect(), layer)
            : { leftX: draft.x - layer.left, rightX: draft.x - layer.left, top: draft.y - layer.top, bottom: draft.y - layer.top },
        DRAFT_WEIGHT);
    return (
        <Box ref={layerRef} css={styles.ribbons} data-plan-ribbons data-plan-connect={draft?.onto !== undefined ? "snapped" : ""} aria-hidden="true">
            <LinksLayer ribbons={NO_RIBBONS} width={width} height={height}
                clip={{ left: gutterPx, width: width !== undefined ? Math.max(0, width - gutterPx) : 0 }} hit={NO_HIT}
                preview={{ was: undefined, line: line === undefined ? undefined : { stroke: line.stroke, head: line.head } }} />
        </Box>
    );
}
