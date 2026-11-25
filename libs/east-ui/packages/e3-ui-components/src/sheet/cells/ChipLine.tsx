/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A cell's members on one line (east-workspace#1741) — a set cell's, and each
 * half of a link cell's: the chips that fit whole, then `+n` for the rest,
 * whose hover names them. Measured as the page lays them out, as a ruler's
 * labels are (`shared/time/use-ruler-fit.ts`): while it measures, every chip
 * draws at its natural width and the `+n` at its widest; `fitChips` then
 * decides from them which show. It measures before the browser paints — when
 * the line mounts, when its chips change, when its width changes (in the
 * ResizeObserver's delivery) and when fonts arrive (`useMeasureAgain`) —
 * so no frame shows a second line past the row, or a chip cut mid-word. A line
 * with no width yet (one not laid out) draws every chip.
 *
 * A line that wraps — Details', which has the room and, on a touch screen, no
 * hover to name a `+n`'s members by — measures nothing and folds none: every
 * chip, on as many lines as they take.
 *
 * @packageDocumentation
 */

import { Fragment, memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Box } from "@chakra-ui/react";
import { useMeasureAgain } from "@elaraai/east-ui-components/internal";
import { fitChips, type ChipFit } from "../../shared/chip-fit.js";
import { useSheetWords } from "../words.js";

type Styles = Record<string, Record<string, unknown>>;

/** One chip of a line. */
export interface LineChip {
    /** What decides its width — its words, and any meta it draws: chips of one key measure alike. */
    key: string;
    /** The chip, one element (`data-slot="chip"`). */
    node: ReactNode;
    /** Its member, as the `+n`'s hover names it. */
    words: string;
}

export interface ChipLineProps {
    styles: Styles;
    /** The chips, in order. */
    chips: readonly LineChip[];
    /** A from-half's line: its chips run to its end. */
    end?: boolean | undefined;
    /** Every chip, on as many lines as they take, none folded: Details' line. */
    wrap?: boolean | undefined;
}

/** Renders a cell's chips on one line — or, wrapping, on as many as they take. */
export const ChipLine = memo(function ChipLine({ styles, chips, end, wrap }: ChipLineProps) {
    const { m, number } = useSheetWords();
    const lineRef = useRef<HTMLDivElement | null>(null);
    // Other chips are measured again — what decides their widths, not the array they arrive in.
    const signature = chips.map((chip) => chip.key).join("\u0001");
    const { measuring, measured } = useMeasureAgain(lineRef, signature, wrap !== true);
    const [fit, setFit] = useState<ChipFit | undefined>(undefined);
    useLayoutEffect(() => {
        const line = lineRef.current;
        if (!measuring || line === null) return;
        measured();
        const room = line.getBoundingClientRect().width;
        const drawn = [...line.children].slice(0, chips.length + 1);
        if (room <= 0 || drawn.length !== chips.length + 1) { setFit(undefined); return; }
        const gap = Number.parseFloat(getComputedStyle(line).columnGap) || 0;
        const widths = drawn.slice(0, chips.length).map((el) => el.getBoundingClientRect().width);
        const more = drawn[chips.length]!.getBoundingClientRect().width;
        setFit(fitChips(widths, room, gap, () => more));
    }, [measuring, measured, chips.length]);
    const shown = wrap === true || measuring || fit === undefined ? chips.length : fit.shown;
    const hidden = chips.slice(shown);
    const moreText = (n: number) => m.chipsMore({ n, count: number(n) });
    return (
        <Box ref={lineRef} css={styles.chipLine} data-slot="chipLine" data-end={end === true ? "" : undefined} data-wrap={wrap === true ? "" : undefined}
            data-alone={wrap !== true && !measuring && fit?.alone === true ? "" : undefined}>
            {chips.slice(0, shown).map((chip, i) => <Fragment key={i}>{chip.node}</Fragment>)}
            {measuring
                ? <Box as="span" css={styles.chipMore} data-slot="chipMore" data-measure="" aria-hidden="true">{moreText(chips.length)}</Box>
                : hidden.length > 0 && (
                    <Box as="span" css={styles.chipMore} data-slot="chipMore" title={hidden.map((chip) => chip.words).join(", ")}>
                        {moreText(hidden.length)}
                    </Box>
                )}
        </Box>
    );
});
