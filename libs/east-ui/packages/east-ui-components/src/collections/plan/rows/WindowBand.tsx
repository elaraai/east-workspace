/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A run of source elements that is NOT resident (#577) — one band, sized by the
 * ledger.
 *
 * Deliberately ONE element rather than a skeleton per row: the canvas cannot
 * know how many rows an unvisited window produces (a series emits several per
 * source element, or none), so drawing a row count would assert something it
 * has no way to support. The repeating rule reads as rows without claiming a
 * number, and the caption states what IS known — how many source elements the
 * band covers.
 *
 * Its height comes from the ledger, so this band and the rows that replace it
 * occupy exactly the same space: scrolling in loads content without moving
 * anything below, and eviction puts the band back with nothing shifting either.
 */

import { Box } from "@chakra-ui/react";
import { bandElements, type PlanBand, type PlanWindowFailure } from "../use-plan-paging.js";
import { formatDerived } from "../format.js";

type Styles = Record<string, Record<string, unknown>>;

export interface WindowBandProps {
    band: PlanBand;
    styles: Styles;
    /** Whether a window inside this band is currently in flight. */
    loading: boolean;
}

/**
 * What an unloaded run says — how many source elements it covers and that
 * scrolling there loads them (or which ones are loading). The canvas band and
 * the narrow list's load-more card (#812) both say it, the same way.
 *
 * @param band - The unloaded run
 * @param loading - Whether a window is in flight
 * @returns The caption
 */
export function bandCaption(band: PlanBand, loading: boolean): string {
    const count = bandElements(band);
    return loading
        ? `Loading elements ${band.from.toLocaleString()}–${band.to.toLocaleString()}`
        : band.at === "head"
            ? `${count.toLocaleString()} earlier elements — scroll to load`
            : `${count.toLocaleString()} more elements — scroll to load`;
}

/** The unloaded run above or below the resident rows. */
export function WindowBand({ band, styles, loading }: WindowBandProps) {
    const count = bandElements(band);
    const caption = bandCaption(band, loading);
    return (
        <Box
            css={styles.windowBand}
            height={`${Math.max(0, band.px)}px`}
            data-plan-window-band={band.at}
            data-plan-elements={count}
            // The ledger-derived height, as data: the height itself compiles
            // to a class, so this is what a DOM test (jsdom resolves no
            // Chakra classes) can hold the geometry contract against (#613).
            data-plan-px={Math.round(Math.max(0, band.px))}
            aria-busy={loading ? "true" : undefined}
        >
            <Box css={styles.windowBandCaption}>{caption}</Box>
        </Box>
    );
}

/**
 * What a failed window's band (and the narrow layout's failure card) says —
 * which source elements could not be read, 1-based like the transport line,
 * and why.
 *
 * @param failure - The failed window
 * @returns The caption
 */
export function failureCaption(failure: PlanWindowFailure): string {
    return `Elements ${formatDerived(failure.from + 1)}–${formatDerived(failure.to + 1)} could not be read — ${failure.error}`;
}

export interface WindowFailureBandProps {
    failure: PlanWindowFailure;
    styles: Styles;
    /** Ask the window again. */
    onRetry: (w: number) => void;
}

/**
 * A window whose read failed (#811) — one band where its rows would be, with
 * the reason and a Retry. Every other window keeps landing around it: a
 * failure belongs to its window, never to the canvas.
 *
 * @param props - The failure, the recipe styles and the retry callback
 * @returns The failed window's band
 */
export function WindowFailureBand({ failure, styles, onRetry }: WindowFailureBandProps) {
    return (
        <Box
            css={styles.windowBand}
            height={`${failure.px}px`}
            data-plan-failed={failure.w}
            data-plan-px={Math.round(failure.px)}
            role="alert"
        >
            <Box css={styles.windowBandCaption}>
                <Box as="span">{failureCaption(failure)}</Box>
                <Box as="button" css={styles.windowRetry} data-plan-retry={failure.w}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRetry(failure.w); }}>
                    Retry
                </Box>
            </Box>
        </Box>
    );
}
