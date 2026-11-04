/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A phone's column pager (`Mobile Sheet Spec.md` SH1, SH2): a 44px band over
 * the grid — the readout `Columns 1–2 of 3`, which opens the jump menu, and
 * ‹ › stepping the window a column. The window is the grid's own sideways
 * scroll, snapped to the columns past the pinned one (the recipe's
 * `scroll-snap`); the pager reads where it rests and moves it — over the
 * motion tokens' times, at once under reduced motion — so a swipe and a step
 * are one window. The jump menu lists every column but the pinned one, a
 * check on those in view and each column's kind, and a pick brings its column
 * into view; under a rule, `Row number` adds the Row column, the row numbers
 * as a column of the window, and puts the window back at its start. ← and →
 * page it while the grid has the focus (SH8.1, {@link pageWindow}).
 *
 * @packageDocumentation
 */

import { memo, useEffect, useState } from "react";
import { Box, chakra, Menu as ChakraMenu } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCaretDown, faCaretUp, faCheck, faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FrameMenuLayer, useSlotStyles } from "@elaraai/east-ui-components/internal";
import { useSheetWords } from "./words.js";

type Styles = Record<string, Record<string, unknown>>;

/** Props of {@link SheetPager}. */
export interface SheetPagerProps {
    styles: Styles;
    /** The element the rows scroll in, sideways too: the window it moves. */
    frame: HTMLElement | null;
    /** The columns it pages: every column but the pinned one, in order — the Row column first, while it shows. */
    columns: readonly SheetPagerColumn[];
    /** A column's slot, px: the frame's width less the pinned column, shared by those in view. */
    slotPx: number;
    /** How many columns the window shows at once. */
    inView: number;
    /** Whether the Row column shows (SH2). */
    rowNumbers: boolean;
    /** Told as the viewer shows or hides the Row column. */
    onRowNumbers: (on: boolean) => void;
}

/** A column of the window, as the jump menu lists it (SH2). */
export interface SheetPagerColumn {
    key: string;
    header: string;
    /** Its kind, in words. */
    kind: string;
}

/** The value of the jump menu's `Row number`, which no column's index is. */
const ROW_NUMBER_ITEM = "row-number";

/** Whether the viewer asks for less motion: the window then jumps. */
function reducedMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Brings the window to a first column: one column over the base motion, more over the slow (SH1.2), at once under
 * reduced motion.
 *
 * @param frame - The element the rows scroll in
 * @param slotPx - A column's slot, px
 * @param last - The last first column the window can have
 * @param to - The first column asked for, held to the window's ends
 * @returns The first column it goes to
 */
export function pageWindow(frame: HTMLElement, slotPx: number, last: number, to: number): number {
    const target = Math.min(last, Math.max(0, to));
    frame.scrollTo({ left: target * slotPx, behavior: reducedMotion() ? "auto" : "smooth" });
    return target;
}

/** Renders a phone's column pager — see the module docs. */
export const SheetPager = memo(function SheetPager({ styles, frame, columns, slotPx, inView, rowNumbers, onRowNumbers }: SheetPagerProps) {
    const words = useSheetWords();
    const { m } = words;
    const menuStyles = useSlotStyles("menu");
    const total = columns.length;
    const last = Math.max(0, total - inView);
    // The first column in view: where the window rests, read off the frame as it scrolls.
    const [first, setFirst] = useState(0);
    useEffect(() => {
        if (frame === null || slotPx <= 0) return undefined;
        const read = () => setFirst(Math.min(last, Math.max(0, Math.round(frame.scrollLeft / slotPx))));
        read();
        frame.addEventListener("scroll", read, { passive: true });
        return () => frame.removeEventListener("scroll", read);
    }, [frame, slotPx, last]);
    const [open, setOpen] = useState(false);
    const go = (to: number) => {
        if (frame !== null) setFirst(pageWindow(frame, slotPx, last, to));
    };
    const shownTo = Math.min(total, first + inView);
    const from = words.number(first + 1);
    const to = words.number(shownTo);
    return (
        <Box css={styles.pager} data-slot="pager">
            <ChakraMenu.Root open={open} onOpenChange={(d) => setOpen(d.open)} positioning={{ placement: "bottom-start" }}
                onSelect={(d) => {
                    if (d.value === ROW_NUMBER_ITEM) return;
                    const i = Number(d.value);
                    // The pick into view: the window's first moved the least it must.
                    if (i < first) go(i);
                    else if (i >= first + inView) go(i - inView + 1);
                }}>
                <ChakraMenu.Trigger asChild>
                    <chakra.button type="button" css={styles.pagerReadout} data-slot="pagerReadout"
                        aria-label={m.pagerName({ from, to, n: total, total: words.number(total) })}>
                        <span>{m.pagerColumns()} <b>{first + 1 === shownTo ? from : `${from}–${to}`}</b> {m.pagerOf({ n: total, total: words.number(total) })}</span>
                        <Box as="span" css={styles.pagerCaret} aria-hidden><FontAwesomeIcon icon={open ? faCaretUp : faCaretDown} /></Box>
                    </chakra.button>
                </ChakraMenu.Trigger>
                <FrameMenuLayer label={m.pagerMenu()} css={styles.pagerMenu} data-slot="pagerMenu">
                            <ChakraMenu.ItemGroup>
                                <ChakraMenu.ItemGroupLabel css={styles.pagerMenuHead}>{m.pagerMenu()}</ChakraMenu.ItemGroupLabel>
                                {columns.map((col, i) => {
                                    const shown = i >= first && i < shownTo;
                                    return (
                                        <ChakraMenu.Item key={col.key} value={String(i)} css={styles.pagerMenuItem} data-in-view={shown ? "" : undefined}>
                                            <Box as="span" css={styles.pagerMenuCheck} aria-hidden>{shown && <FontAwesomeIcon icon={faCheck} />}</Box>
                                            <Box as="span" css={styles.pagerMenuLabel}>{col.header}</Box>
                                            <Box as="span" css={[menuStyles.itemCommand, styles.pagerMenuKind]}>{col.kind}</Box>
                                        </ChakraMenu.Item>
                                    );
                                })}
                            </ChakraMenu.ItemGroup>
                            <ChakraMenu.Separator />
                            <ChakraMenu.CheckboxItem value={ROW_NUMBER_ITEM} css={styles.pagerMenuItem} checked={rowNumbers} data-slot="pagerRowNumber"
                                onCheckedChange={(on) => { onRowNumbers(on); go(0); }}>
                                <Box as="span" css={styles.pagerMenuCheck} aria-hidden>{rowNumbers && <FontAwesomeIcon icon={faCheck} />}</Box>
                                <Box as="span" css={styles.pagerMenuLabel}>{m.pagerRowNumber()}</Box>
                                <Box as="span" css={[menuStyles.itemCommand, styles.pagerMenuKind]}>{m.pagerRowNumberNote()}</Box>
                            </ChakraMenu.CheckboxItem>
                        </FrameMenuLayer>
            </ChakraMenu.Root>
            <chakra.button type="button" css={styles.pagerStep} data-slot="pagerPrevious" aria-label={m.pagerPrevious()}
                aria-disabled={first <= 0 ? true : undefined} onClick={() => { if (first > 0) go(first - 1); }}>
                <FontAwesomeIcon icon={faChevronLeft} />
            </chakra.button>
            <chakra.button type="button" css={styles.pagerStep} data-slot="pagerNext" aria-label={m.pagerNext()}
                aria-disabled={first >= last ? true : undefined} onClick={() => { if (first < last) go(first + 1); }}>
                <FontAwesomeIcon icon={faChevronRight} />
            </chakra.button>
        </Box>
    );
});
