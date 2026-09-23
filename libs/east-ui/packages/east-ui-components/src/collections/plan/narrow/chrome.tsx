/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The narrow layout's shared ruler and its resolution chip (split out of
 * `narrow/index.tsx`, #815).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useRef, useState } from "react";
import { Box, Menu as ChakraMenu, Portal, useRecipe } from "@chakra-ui/react";
import { usePlanScale } from "../context.js";

type Styles = Record<string, Record<string, unknown>>;

/** Mono 9px: the width one label character takes, plus the gap two labels
 *  keep between them — what decides how many labels a track can carry. */
const TICK_CHAR_PX = 5.6;
const TICK_GAP_PX = 8;
/** Labels printed when the track has not been measured yet (jsdom, the
 *  first frame): one per bucket up to twelve — the desktop ruler's density. */
const TICK_FALLBACK_LABELS = 12;

/**
 * The shared ruler — the LIST's sticky first row, not a row of the header.
 * It wears the desktop ruler's vocabulary (the panel surface, a separator
 * per bucket so its rhythm IS the card grids', a strong bottom rule) and
 * sits 10px under the tab baseline on the page, so it reads as the axis
 * over the cards rather than as a strip welded under the tab underline
 * (which is what a filled band directly beneath the tabs looked like). The
 * tick TRACK is inset to the card bodies' inset (25px) so the columns line
 * up down the page; labels are thinned to what the measured track can carry
 * (at day resolution a bucket is ~3px — a label per bucket clipped to
 * confetti), each centred over its bucket. The now bucket's label wears the
 * brand: a 28px band has no lane for the chip, and a chip laid over the
 * labels hid the two it straddled.
 */
export function NarrowRuler({ styles }: { styles: Styles }) {
    const scale = usePlanScale();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [trackPx, setTrackPx] = useState(0);
    useLayoutEffect(() => {
        const el = trackRef.current;
        if (el === null) return undefined;
        const measure = () => setTrackPx(el.clientWidth);
        measure();
        if (typeof ResizeObserver === "undefined") return undefined;
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const nowIndex = scale.nowFrac === undefined ? undefined
        : scale.buckets.find((b) => scale.nowFrac! >= b.x0 && scale.nowFrac! < b.x1)?.index;
    // How many labels FIT: the widest label's width plus a gap, into the track.
    const widest = scale.buckets.reduce((w, b) => Math.max(w, b.label.length), 1);
    const maxLabels = trackPx > 0
        ? Math.max(2, Math.floor(trackPx / (widest * TICK_CHAR_PX + TICK_GAP_PX)))
        : TICK_FALLBACK_LABELS;
    const every = Math.max(1, Math.ceil(scale.n / maxLabels));
    // The cadence, plus the now bucket — which displaces a cadence label it
    // would otherwise sit on top of. Every bucket keeps its separator.
    const labelled = (i: number) => i === nowIndex
        || (i % every === 0 && (nowIndex === undefined || Math.abs(i - nowIndex) >= every));
    const columns = scale.buckets.map((b) => `${((b.x1 - b.x0) * 100).toFixed(4)}%`).join(" ");
    return (
        <Box css={styles.narrowRuler} data-slot="narrowRuler">
            <Box ref={trackRef} css={styles.narrowRulerTrack} gridTemplateColumns={columns}>
                {scale.buckets.map((b) => (
                    <Box key={b.index} css={styles.narrowRulerTick} data-slot="narrowRulerTick"
                        data-now={b.index === nowIndex ? "" : undefined}>
                        {labelled(b.index) ? b.label : ""}
                    </Box>
                ))}
                {scale.nowFrac !== undefined && <Box css={styles.nowLine} left={`${scale.nowFrac * 100}%`} />}
            </Box>
        </Box>
    );
}

/** The `Week` chip — the resolution segment's narrow form (a slice write). */
export function ResolutionChip({ resolution, resolutions, onPick }: {
    resolution: string;
    resolutions: ReadonlyArray<string>;
    onPick: (r: string) => void;
}) {
    const chip = useRecipe({ key: "chip" });
    return (
        <ChakraMenu.Root onSelect={(d) => onPick(d.value)}>
            <ChakraMenu.Trigger asChild>
                <Box as="button" css={chip({ tone: "neutral", numeric: true })} data-slot="narrowResolution" aria-label="Resolution">
                    {resolution.toUpperCase()}
                    <Box as="span" opacity={0.6} fontSize="9px">{"▾"}</Box>
                </Box>
            </ChakraMenu.Trigger>
            <Portal>
                <ChakraMenu.Positioner>
                    <ChakraMenu.Content>
                        {resolutions.map((r) => (
                            <ChakraMenu.Item key={r} value={r}>{r.toUpperCase()}</ChakraMenu.Item>
                        ))}
                    </ChakraMenu.Content>
                </ChakraMenu.Positioner>
            </Portal>
        </ChakraMenu.Root>
    );
}
