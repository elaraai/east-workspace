/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Record's footer (`Record - DX Proposal.md` FT1, FT2): `N of M people`
 * — the rows the narrowing shows, of the record's — and the record's last
 * save after it, the stale note of the first age column with a threshold,
 * and at the right the legend of the register every cycle column names: each
 * member's chip in its look, and its name, or its name alone in the mark
 * look. The shared loading line takes its slot at the trailing end.
 *
 * The rail never wraps and never cuts a word: the legend ends at a whole
 * member, then "…", where the rail is short of room (#1398, CL3). On a phone
 * it shows nothing but what speaks — the loading line, a Save's notice, and
 * the status line's words, which the phone's toolbar has no room for — in
 * the band the frame lays over main's foot (ruled 7 Nov 2026).
 *
 * @packageDocumentation
 */

import { memo, useMemo, useRef, type CSSProperties } from "react";
import { Box } from "@chakra-ui/react";
import { IntegerType, StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "@elaraai/east-ui-components";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useLoadingReveal, useRevealed, type SlotStyles } from "@elaraai/east-ui-components/internal";
import { pagedLoadingLine } from "../shared/loading.js";
import type { SheetLoadingLine } from "../sheet/Footer.js";
import type { SheetColumnIndex, SheetRegisterIndex } from "../sheet/model.js";
import type { SheetRowValue } from "../sheet/values.js";
import { useSheetWords, type SheetWords } from "../sheet/words.js";
import { heatOf } from "./cells.js";
import { ageOf } from "./clock.js";
import { recordMessages as m, type RecordLineText } from "./messages.js";

const stringEqual = equalFor(StringType);
const integerEqual = equalFor(IntegerType);

/** One member of the legend (FT2). */
export interface RecordLegendItem {
    /** Its chip's look — a scale's step, a valence's wash, or none; `undefined` in the mark look, which draws no chip. */
    look: string | undefined;
    /** Its chip's words: the member's label. */
    label: string;
    /** Its name: the member's `meta`, else its label. */
    name: string;
}

/** The legend: its members, and their chips' least width in characters — the widest label, so the chips line up. */
export interface RecordLegend {
    items: readonly RecordLegendItem[];
    chip: number;
}

/** No legend: a Record with no cycle column, or whose cycle columns name more than one register. */
const NO_LEGEND: RecordLegend = { items: [], chip: 0 };

/**
 * The legend (FT2): where every cycle column names one register, its members
 * in its order, each drawn as the first cycle column draws it.
 *
 * @param columns - The columns
 * @param registers - The registers, by name
 * @returns The legend; none where the cycle columns name no register, or several
 */
export function legendOf(columns: SheetColumnIndex, registers: SheetRegisterIndex): RecordLegend {
    let first: { register: string; scale: boolean; mark: boolean } | undefined;
    for (const meta of columns.list) {
        const kind = meta.raw.kind;
        if (kind.type !== "cycle") continue;
        if (first === undefined) first = { register: kind.value.register, scale: kind.value.scale, mark: kind.value.look.type === "mark" };
        else if (!stringEqual(kind.value.register, first.register)) return NO_LEGEND;
    }
    if (first === undefined) return NO_LEGEND;
    const { register, scale, mark } = first;
    const members = registers.byName.get(register) ?? [];
    const items = members.map((member, at): RecordLegendItem => {
        const label = member.label !== "" ? member.label : member.key;
        const tone = getSomeorUndefined(member.tone)?.type;
        return {
            look: mark ? undefined : scale ? heatOf(at, members.length) : tone === undefined || tone === "neutral" ? "none" : tone,
            label,
            name: getSomeorUndefined(member.meta) ?? label,
        };
    });
    return { items, chip: items.reduce((n, item) => Math.max(n, [...item.label].length), 0) };
}

/** The rows the first age column with a threshold says are stale: how many, at what threshold, and what it counts. */
export interface RecordStaleCount {
    /** How many rows are stale. */
    n: number;
    /** At or past this many, a row is stale. */
    threshold: bigint;
    /** What the column counts. */
    unit: "hours" | "days" | "weeks";
}

/**
 * How many of the rows the first age column with a threshold says are stale,
 * to the Record's clock: what the footer's note (FT1) and the inspector's
 * count with no row selected (IN8) say.
 *
 * @param columns - The columns
 * @param rows - The rows to count: every row the narrowing shows
 * @param now - The Record's now
 * @returns The count; `undefined` with no such column
 */
export function staleCountOf(columns: SheetColumnIndex, rows: readonly SheetRowValue[], now: Date): RecordStaleCount | undefined {
    for (const meta of columns.list) {
        const kind = meta.raw.kind;
        if (kind.type !== "age") continue;
        const threshold = getSomeorUndefined(kind.value.stale);
        if (threshold === undefined) continue;
        let n = 0;
        for (const row of rows) if (ageOf(meta, row.cells.get(meta.key), now)?.stale === true) n += 1;
        return { n, threshold, unit: kind.value.unit.type };
    }
    return undefined;
}

/**
 * The stale note (FT1): how many of the rows the first age column with a
 * threshold says are stale, to the Record's clock.
 *
 * @param columns - The columns
 * @param rows - The rows to count: every row the narrowing shows
 * @param now - The Record's now
 * @param words - The Sheet's words: the counts in the viewer's language
 * @returns The note; `undefined` with no such column, or no row stale
 */
export function staleNoteOf(columns: SheetColumnIndex, rows: readonly SheetRowValue[], now: Date, words: SheetWords): string | undefined {
    const stale = staleCountOf(columns, rows, now);
    if (stale === undefined || stale.n === 0) return undefined;
    return m.staleNote({ count: words.number(stale.n), threshold: words.number(stale.threshold), unit: stale.unit, one: integerEqual(stale.threshold, 1n) });
}

/** Props of {@link RecordFooter}. */
export interface RecordFooterProps {
    /** The record recipe's slot styles. */
    styles: SlotStyles;
    /** The rows shown, of the record's — `N of M people`, N strong; `undefined` while either is not known. */
    count: RecordLineText | undefined;
    /** The record's last save, from its commits — `saved 14:02` (SB22). */
    saved: string | undefined;
    /** The stale note; `undefined` for none. */
    stale: string | undefined;
    /** Exact, confirmed feedback when saved rows leave the `rows` source's narrowing. */
    recordSlice: ValueTypeOf<RecordSliceBindType> | undefined;
    /** The legend. */
    legend: RecordLegend;
    /** The status line's words: what a phone's band says, its toolbar having no room for them. */
    live: string;
    /** What a paged source reads now, or could not read. */
    loading: SheetLoadingLine | undefined;
    /** What the rail counts the rows in: what the loading line names them by. */
    noun: string;
    /** Ask the source again, when the loading line says it could not be read. */
    onRetry: (() => void) | undefined;
}

/** Nothing to ask again: a Record whose source gives no Retry. */
const NO_RETRY = () => undefined;

/** Renders the footer — see the module docs. */
export const RecordFooter = memo(function RecordFooter({ styles, count, saved, stale, recordSlice, legend, live, loading, noun, onRetry }: RecordFooterProps) {
    // The loading line, in the Sheet's words, on the frame's one reveal clock (CL4) — else, alone, a clock of its own.
    const words = useSheetWords();
    const line = useMemo(() => pagedLoadingLine(loading, noun, words.m, words.number, onRetry ?? NO_RETRY), [loading, noun, words, onRetry]);
    const revealed = useRevealed();
    const alone = useLoadingReveal(revealed === undefined && loading !== undefined && loading.kind !== "failed");
    const shown = revealed ?? alone;
    const rail = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(rail);
    // Every legend chip as wide as the widest label, at its own face, as a cell's chips are.
    const chipStyle = { "--record-chip-ch": legend.chip } as CSSProperties;
    const units = legend.items.length;
    return (
        <Box ref={rail} css={styles.footer} data-slot="footer">
            {(count !== undefined || saved !== undefined) && (
                <Box as="span" css={styles.footerCount} data-slot="footerCount">
                    {count?.map((part, i) => (typeof part === "string" ? part : <b key={i}>{part.strong}</b>))}
                    {saved !== undefined && (count === undefined ? saved : ` · ${saved}`)}
                </Box>
            )}
            {stale !== undefined && <Box as="span" css={styles.footerNote} data-slot="footerNote">{stale}</Box>}
            {recordSlice !== undefined && <RecordSliceSaveNotice slice={recordSlice} />}
            {/* The slack between the counts and the legend: fitted at no width, so the legend is cut only for room it lacks. */}
            <Box as="span" css={styles.footerSpacer} data-footer-slack="" aria-hidden="true" />
            {units > 0 && (
                <Box as="span" css={styles.legend} data-slot="legend" data-footer-units="">
                    {legend.items.map((item, i) => (
                        <Box key={i} as="span" css={styles.legendItem} data-slot="legendItem" data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
                            {item.look !== undefined && <Box as="span" css={styles.legendChip} data-slot="legendChip" data-look={item.look} style={chipStyle}>{item.label}</Box>}
                            <Box as="span" css={styles.legendName} data-slot="legendName">{item.name}</Box>
                        </Box>
                    ))}
                </Box>
            )}
            <FooterMore shown={fit.kept < units} />
            {/* The status line's words, seen and heard on a phone alone: elsewhere the toolbar's line says them. */}
            <Box as="span" css={styles.footerLive} data-slot="footerLive" data-footer-live={live === "" ? undefined : ""} role="status" aria-live="polite">{live}</Box>
            <LoadingLine value={line} shown={shown} form={fit.form} />
        </Box>
    );
});
