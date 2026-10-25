/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The footer (B§9): the host's counts · a state-sensitive key hint · a
 * right-aligned `aria-live` message for every action · and over a paged
 * source the shared loading line at its trailing end (#1398, CL3): what is
 * read, in what the rail counts the rows in — `Loading work orders
 * 8,301–8,500`, `Filtering work orders…`, `Couldn't read work orders
 * 8,301–8,500 · Retry` — never a count of the rows read. The rail never wraps
 * and never cuts a word: the key hint's hints end at a whole hint, then "…",
 * and the line shows its full text, its short form or its dot alone. A
 * builder adds the record's last save after the counts (SB22). A run of the
 * app's optimiser (#1409) takes the line's slot while it is out and just
 * after Stop, and during its highlight the hints end with `Elara change`.
 */

import { memo, useMemo, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { OptimiseLegendItem, getSomeorUndefined } from "@elaraai/east-ui-components";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useLoadingReveal, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { pagedLoadingLine, type PagedLoading } from "../shared/loading.js";
import { useSheetWords } from "./words.js";
import type { ValueTypeOf } from "@elaraai/east";
import type { Sheet } from "@elaraai/e3-ui/internal";

type Styles = Record<string, Record<string, unknown>>;

/** One decoded footer item. */
export type SheetFooterItemValue = ValueTypeOf<typeof Sheet.Types.FooterItem>;

/**
 * What a paged sheet reads now, or could not read (#1398, CL3): its source's
 * elements in flight, a narrowing's rows read while the last narrowing's
 * stand in, or a read that failed — a window's or a stretch's elements, or
 * the source's own count or revision — the shared paged source's line.
 */
export type SheetLoadingLine = PagedLoading;

export interface SheetFooterProps {
    styles: Styles;
    items: readonly SheetFooterItemValue[];
    /** The sheet's own count line before the host's items — a grouped sheet's `3 plans · 14 lines` (#740, G12). */
    summary?: string | undefined;
    hint: string;
    message: string;
    /** What a paged source reads now, or could not read; `undefined` while nothing is in flight or failed, and inline (#1398). */
    loading: SheetLoadingLine | undefined;
    /** What the rail counts the rows in — `work orders`, a grouped sheet's groups: what the loading line names them by. */
    noun: string;
    /** Ask the source again, when the loading line says it could not be read (#853). */
    onRetry?: (() => void) | undefined;
    /** The record's last save, from its commits — `saved 14:02` (a builder's, SB22). */
    saved?: string | undefined;
    /** Exact, confirmed feedback when saved rows leave the indexed query. */
    recordSlice?: ValueTypeOf<RecordSliceBindType> | undefined;
    /** A run of the app's optimiser (#1409): what its line says while the call is out or just stopped, and whether the legend's `Elara change` shows. */
    optimise?: { readonly line: LoadingLineValue | undefined; readonly legend: boolean } | undefined;
}

/** The separator the key hint's words run its hints on with — each of them a hint the fit keeps or cuts whole. */
const HINT_SEPARATOR = " · ";

/** Nothing to ask again: a sheet whose host gives no Retry. */
const NO_RETRY = () => undefined;

/** Renders the footer. */
export const SheetFooter = memo(function SheetFooter({ styles, items, summary, hint, message, loading, noun, onRetry, saved, recordSlice, optimise }: SheetFooterProps) {
    // The loading line, in the sheet's words and the app's locale (#850, #861), on the sheet's one reveal clock (CL4):
    // its frame's `LoadingReveal`, which the runs' placeholders read too — else, alone, a clock of its own.
    const words = useSheetWords();
    const line = useMemo(() => pagedLoadingLine(loading, noun, words.m, words.number, onRetry ?? NO_RETRY), [loading, noun, words, onRetry]);
    const revealed = useRevealed();
    const alone = useLoadingReveal(revealed === undefined && loading !== undefined && loading.kind !== "failed");
    const shown = revealed ?? alone;
    const rail = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(rail);
    const hints = hint === "" ? [] : hint.split(HINT_SEPARATOR);
    const legend = optimise?.legend === true;
    const units = hints.length + (legend ? 1 : 0);
    // A run's line takes the slot, at once: a run is not a read.
    const runLine = optimise?.line;
    return (
        <Box ref={rail} css={styles.footer} data-slot="footer" data-footer-hints="">
            {(items.length > 0 || summary !== undefined || saved !== undefined) && (
                <Box as="span" css={styles.footerCounts} data-slot="footerCounts">
                    {summary !== undefined && <Box as="span" data-slot="footerSummary">{summary}</Box>}
                    {items.map((it, i) => (
                        <Box key={i} as="span" data-tone={getSomeorUndefined(it.tone)?.type}>
                            {i > 0 || summary !== undefined ? `· ${it.text}` : it.text}
                        </Box>
                    ))}
                    {saved !== undefined && (
                        <Box as="span" data-slot="footerSaved">{items.length > 0 || summary !== undefined ? `· ${saved}` : saved}</Box>
                    )}
                </Box>
            )}
            {recordSlice !== undefined && <RecordSliceSaveNotice slice={recordSlice} />}
            {/* The key hint: its hints run on, each whole — a rail too narrow ends them at a whole hint, then "…". */}
            <Box as="span" css={styles.footerHint} data-slot="footerHint" data-footer-units="">
                {hints.map((part, i) => (
                    <Box key={i} as="span" data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
                        {i > 0 && <Box as="span" css={styles.footerHintSep}>{HINT_SEPARATOR}</Box>}{part}
                    </Box>
                ))}
                {/* During a run's highlight the hints end with `Elara change` (#1409), one more unit the fit keeps or cuts whole. */}
                {legend && (
                    <Box as="span" data-footer-unit="" data-footer-cut={footerCut(hints.length, fit)}>
                        {hints.length > 0 && <Box as="span" css={styles.footerHintSep}>{HINT_SEPARATOR}</Box>}<OptimiseLegendItem />
                    </Box>
                )}
            </Box>
            <FooterMore shown={fit.kept < units} />
            {/* The message takes the rail's slack: the fit leaves it what the hints and the line leave, its words cut there. */}
            <Box as="span" css={styles.footerMessage} data-slot="footerMessage" data-footer-slack="" aria-live="polite">{message}</Box>
            <LoadingLine value={runLine ?? line} shown={shown || runLine !== undefined} form={fit.form} />
        </Box>
    );
});
