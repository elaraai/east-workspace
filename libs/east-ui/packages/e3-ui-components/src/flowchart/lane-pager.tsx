/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's lane pager (ruled 3 Nov 2026): a 44px band over the Flowchart's
 * canvas, as the Sheet's column pager is — the readout `Lanes 1–2 of 3`, and
 * ‹ › stepping the window a lane. The window is the canvas's own sideways
 * scroll: the pager reads where it rests and moves it — smoothly, at once
 * under reduced motion — so a swipe and a step are one window, and › reaches
 * what stands past the last lane, `+ LANE`, as a swipe does. A window that comes
 * to rest between two lanes — a swipe let go there — settles on the nearer, as a
 * step would; a Find's pick opens on whole lanes (the canvas's). Its looks are the
 * Sheet's pager's, in the `sheet` recipe.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useState } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import type { FlowchartWords } from "./messages.js";

/** Props of {@link FlowchartLanePager}. */
export interface FlowchartLanePagerProps {
    /** The element the canvas scrolls in: the window it moves. */
    frame: HTMLElement | null;
    /** How many lanes the flow has. */
    total: number;
    /** How many the window shows at once. */
    inView: number;
    /** A lane's width, px. */
    slotPx: number;
    /** The flowchart's words. */
    words: FlowchartWords;
}

/** Whether the viewer asks for less motion: the window then jumps. */
function reducedMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Renders a phone's lane pager — see the module docs. */
export const FlowchartLanePager = memo(function FlowchartLanePager({ frame, total, inView, slotPx, words }: FlowchartLanePagerProps) {
    const styles = useSlotStyles("sheet");
    const last = Math.max(0, total - inView);
    // The first lane in view, and whether the view is at the canvas's end: where the window rests, read off the canvas as it scrolls.
    const [first, setFirst] = useState(0);
    const [atEnd, setAtEnd] = useState(false);
    useEffect(() => {
        if (frame === null || slotPx <= 0) return undefined;
        const read = () => {
            setFirst(Math.min(last, Math.max(0, Math.round(frame.scrollLeft / slotPx))));
            setAtEnd(frame.scrollLeft + frame.clientWidth >= frame.scrollWidth - 1);
        };
        // At rest between two lanes it settles on the nearer, never at the canvas's end, which stands past the last lane's start.
        const settle = () => {
            const at = Math.round(frame.scrollLeft / slotPx) * slotPx;
            if (Math.abs(frame.scrollLeft - at) > 1 && frame.scrollLeft + frame.clientWidth < frame.scrollWidth - 1) {
                frame.scrollTo({ left: at, behavior: reducedMotion() ? "auto" : "smooth" });
            }
        };
        read();
        frame.addEventListener("scroll", read, { passive: true });
        frame.addEventListener("scrollend", settle, { passive: true });
        return () => {
            frame.removeEventListener("scroll", read);
            frame.removeEventListener("scrollend", settle);
        };
    }, [frame, slotPx, last]);
    // The canvas's end holds it past the last lane's start; the browser stops the scroll there.
    const go = (to: number) => {
        if (frame !== null) frame.scrollTo({ left: Math.max(0, to) * slotPx, behavior: reducedMotion() ? "auto" : "smooth" });
    };
    // Past the last lane's start, at what stands after it: a step back comes to that lane first.
    const pastLast = atEnd && frame !== null && frame.scrollLeft > first * slotPx + 1;
    const from = words.number(first + 1);
    const to = words.number(Math.min(total, first + inView));
    const range = inView === 1 ? from : `${from}–${to}`;
    return (
        <Box css={styles.pager} data-slot="pager" data-flowchart-lane-pager="">
            <Box as="span" css={styles.pagerReadout} data-slot="pagerReadout" role="status">{words.m.lanePager({ range, total: words.number(total) })}</Box>
            <chakra.button type="button" css={styles.pagerStep} data-slot="pagerPrevious" aria-label={words.m.laneStep({ more: false })}
                aria-disabled={first <= 0 && !pastLast ? true : undefined} onClick={() => { go(pastLast ? first : first - 1); }}>
                <FontAwesomeIcon icon={faChevronLeft} />
            </chakra.button>
            <chakra.button type="button" css={styles.pagerStep} data-slot="pagerNext" aria-label={words.m.laneStep({ more: true })}
                aria-disabled={atEnd ? true : undefined} onClick={() => { if (!atEnd) go(first >= last ? total : first + 1); }}>
                <FontAwesomeIcon icon={faChevronRight} />
            </chakra.button>
        </Box>
    );
});
