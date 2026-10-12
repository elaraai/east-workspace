/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The now line (#1148): the instant a time view marks as now, the same line
 * on every canvas that draws one (Plan's rows and ruler, the Calendar's time
 * grid and timeline). It is 1.5px of the brand: down the box for an instant
 * on a horizontal axis (`along="x"`), across it for one on a vertical axis
 * (`along="y"`), with a 7px dot at its start where the view wants one. Its
 * chip says what the instant is called, `NOW` on Plan's ruler, or the time in
 * a time grid's gutter.
 *
 * The parts set data attributes and geometry only, the geometry written on
 * the element (`left` or `top`, and a chip's translation), as every position
 * that follows data is. Their look is the host recipe's `nowLine`, `nowDot`
 * and `nowChip` slots, which every host merges from the one shared part in the
 * theme (east-ui-components' `slot-recipes/time/now.ts`). Data attributes a
 * host gives (`data-plan-now`) land on the element, so its tests and
 * selectors find it.
 *
 * Where now is comes from the host: a test or a showcase pins it, and
 * {@link useNow} reads the clock when nothing does.
 *
 * @packageDocumentation
 */

import { useEffect, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";

type Styles = Record<string, Record<string, unknown>>;

/** The axis an instant is on: `x` draws down the box (a horizontal axis), `y` across it (a vertical one). */
export type NowAlong = "x" | "y";

/** Data attributes a host puts on a part. */
type DataAttributes = { [name: `data-${string}`]: string | boolean | undefined };

/** {@link NowLine}'s props. */
export type NowLineProps = DataAttributes & {
    /** The host recipe's styles: its `nowLine` and `nowDot` slots. */
    styles: Styles;
    /** Where now is, as a fraction of the box along the axis: 0 to 1. */
    at: number;
    /** The axis the instant is on: `x` when omitted. */
    along?: NowAlong | undefined;
    /** Whether a dot marks the line's start. */
    dot?: boolean | undefined;
};

/**
 * The line (see the module docs).
 *
 * @param props - See {@link NowLineProps}
 * @returns The line
 */
export function NowLine({ styles, at, along = "x", dot, ...data }: NowLineProps) {
    const position = `${at * 100}%`;
    return (
        <Box css={styles.nowLine} data-along={along} style={along === "x" ? { left: position } : { top: position }} {...data}>
            {dot === true && <Box css={styles.nowDot} />}
        </Box>
    );
}

/** {@link NowChip}'s props. */
export type NowChipProps = DataAttributes & {
    /** The host recipe's styles: its `nowChip` slot. */
    styles: Styles;
    /** Where now is, as a fraction of the box along the axis: 0 to 1. */
    at: number;
    /** The axis the instant is on: `x` when omitted. */
    along?: NowAlong | undefined;
    /**
     * On an `x` axis, where the chip sits across the instant, as its own
     * horizontal translation: centred (`-50%`) unless the host keeps it
     * inside a clipped band at either end, as Plan's ruler does.
     */
    anchor?: string | undefined;
    /** What the instant is called. */
    children: ReactNode;
};

/**
 * The chip (see the module docs).
 *
 * @param props - See {@link NowChipProps}
 * @returns The chip
 */
export function NowChip({ styles, at, along = "x", anchor, children, ...data }: NowChipProps) {
    const position = `${at * 100}%`;
    return along === "x"
        ? (
            <Box css={styles.nowChip} data-along="x" {...data}
                style={anchor !== undefined ? { left: position, transform: `translate(${anchor}, -50%)` } : { left: position }}>
                {children}
            </Box>
        )
        : <Box css={styles.nowChip} data-along="y" style={{ top: position }} {...data}>{children}</Box>;
}

/**
 * The instant now is: the host's when it gives one (a test or a showcase pins
 * it), else the clock, read again at each whole `every` (a minute by default).
 *
 * @param given - The host's now, if any
 * @param every - How often the clock is read again, in ms
 * @returns Now
 */
export function useNow(given: Date | undefined, every: number = 60_000): Date {
    const [clock, setClock] = useState(() => new Date());
    useEffect(() => {
        if (given !== undefined) return undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const read = (): void => {
            const now = new Date();
            setClock(now);
            timer = setTimeout(read, every - (now.getTime() % every));
        };
        read();
        return () => { if (timer !== undefined) clearTimeout(timer); };
    }, [given, every]);
    return given ?? clock;
}
