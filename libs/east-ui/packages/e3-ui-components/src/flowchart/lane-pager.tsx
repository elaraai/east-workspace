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
 * step would: at rest as the browser says it (`scrollend`), and on an older
 * iPhone, which never does, once its scroll has stood still a moment
 * (`../shared/scroll-rest.ts`). A Find's pick opens on whole lanes (the canvas's). Where the
 * details draw on the cards a lane keeps its width, wider than the window, and
 * each step brings its card to the window's middle — the middle of what the
 * window shows, its scrollbar left out — as the window opens, as it resizes and
 * as a swipe settles too (R40, D24). Zoomed (R42), a lane is as wide as the
 * zoom draws it: the window holds as many whole lanes as fit, each step moves
 * a lane's zoomed width, and a lane is centred only while it is wider than the
 * window. Its looks are the Sheet's pager's, in the `sheet` recipe.
 *
 * @packageDocumentation
 */

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, chakra } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { useSlotStyles } from "@elaraai/east-ui-components/internal";
import { onScrollRest } from "../shared/scroll-rest.js";
import type { FlowchartWords } from "./messages.js";

/** Props of {@link FlowchartLanePager}. */
export interface FlowchartLanePagerProps {
    /** The element the canvas scrolls in: the window it moves. */
    frame: HTMLElement | null;
    /** How many lanes the flow has. */
    total: number;
    /** How many whole lanes the window shows at once. */
    inView: number;
    /** A lane's width as drawn, at the zoom, px. */
    slotPx: number;
    /** Whether each step brings its lane's card to the window's middle while the lane is wider than the window — where the details draw on the cards; otherwise, and once the lane is no wider, each step brings a lane to the window's start. */
    centred: boolean;
    /** The flowchart's words. */
    words: FlowchartWords;
}

/** Whether the viewer asks for less motion: the window then jumps. */
function reducedMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Renders a phone's lane pager — see the module docs. */
export const FlowchartLanePager = memo(function FlowchartLanePager({ frame, total, inView, slotPx, centred, words }: FlowchartLanePagerProps) {
    const styles = useSlotStyles("sheet");
    const last = Math.max(0, total - inView);
    // What the window shows across, its scrollbar left out: read as it opens and each time it resizes.
    const [shows, setShows] = useState(0);
    useLayoutEffect(() => {
        if (frame === null || !centred) return undefined;
        const measure = () => setShows(frame.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        return () => observer.disconnect();
    }, [frame, centred]);
    // Where the window rests on a lane: past its start by half what the lane is wider than what the window shows, so its card
    // stands in the middle — at its start where the lane is no wider, zoomed out.
    const offset = centred && shows > 0 ? Math.max(0, Math.round((slotPx - shows) / 2)) : 0;
    // The first lane in view, and whether the view is at the canvas's end: where the window rests, read off the canvas as it scrolls.
    const [first, setFirst] = useState(0);
    const [atEnd, setAtEnd] = useState(false);
    useEffect(() => {
        if (frame === null || slotPx <= 0) return undefined;
        const read = () => {
            setFirst(Math.min(last, Math.max(0, Math.round((frame.scrollLeft - offset) / slotPx))));
            setAtEnd(frame.scrollLeft + frame.clientWidth >= frame.scrollWidth - 1);
        };
        // At rest between two lanes it settles on the nearer — its card in the middle where a lane is wider than the window —
        // never at the canvas's end, which stands past the last lane's start.
        const settle = () => {
            const at = Math.max(0, Math.round((frame.scrollLeft - offset) / slotPx)) * slotPx + offset;
            if (Math.abs(frame.scrollLeft - at) > 1 && frame.scrollLeft + frame.clientWidth < frame.scrollWidth - 1) {
                frame.scrollTo({ left: at, behavior: reducedMotion() ? "auto" : "smooth" });
            }
        };
        read();
        frame.addEventListener("scroll", read, { passive: true });
        const stop = onScrollRest(frame, settle);
        return () => {
            frame.removeEventListener("scroll", read);
            stop();
        };
    }, [frame, slotPx, offset, last]);
    // A lane wider than the window: its card to the window's middle as the window opens, and on the lane it rests on as it resizes.
    const rested = useRef<{ slotPx: number; offset: number } | undefined>(undefined);
    useLayoutEffect(() => {
        if (frame === null || slotPx <= 0) return;
        const was = rested.current;
        rested.current = { slotPx, offset };
        if (offset === 0 && (was === undefined || was.offset === 0)) return;
        const lane = was === undefined ? 0 : Math.min(last, Math.max(0, Math.round((frame.scrollLeft - was.offset) / was.slotPx)));
        frame.scrollLeft = lane * slotPx + offset;
    }, [frame, slotPx, offset, last]);
    // The canvas's end holds it past the last lane's start; the browser stops the scroll there.
    const go = (to: number) => {
        if (frame !== null) frame.scrollTo({ left: Math.max(0, Math.max(0, to) * slotPx + offset), behavior: reducedMotion() ? "auto" : "smooth" });
    };
    // Past the last lane's start, at what stands after it: a step back comes to that lane first.
    const pastLast = atEnd && frame !== null && frame.scrollLeft > first * slotPx + offset + 1;
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
