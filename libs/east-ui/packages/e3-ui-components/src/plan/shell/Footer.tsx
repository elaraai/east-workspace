/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The status footer (28px, `Plan Spec.html` §1) — the Plan's frame's footer
 * (#1193): mono 10px status items; `tone` tints (`warning` for the exceptions
 * count), `end: true` right-aligns.
 *
 * It leads with the Plan's own counts (PB23): its event kinds' events in the
 * window, their backlog, the changes waiting on Save, and when a kind's record
 * was last saved — `64 events · 9 in backlog · 4 pending · saved 14:02` — then
 * the author's items.
 *
 * On a PAGED canvas the footer also carries the shared loading line at its
 * trailing end (#1398, CL3): which of the source's elements are read, in what
 * the rail counts the rows in — `Loading rows 1,001–1,200`, `Filtering rows…`,
 * `Couldn't read rows 1,001–1,200 · Retry` — never how many have landed. The
 * rail never wraps and never cuts a word: the counts and the author's items
 * stay whole, ending at a whole item, then "…", only where they cannot fit,
 * and the line shows its full text, its short form or its dot alone.
 *
 * After a Save, each source of the Plan's slice that a Save moved records out
 * of says so, in its own words (#1344) — the `rows` source's rows, an event
 * kind's events: `1 print job event left this view`, the shared
 * `RecordSliceSaveNotice`.
 */

import { useMemo, useRef } from "react";
import { Box } from "@chakra-ui/react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useLoadingReveal, useRevealed } from "@elaraai/east-ui-components/internal";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { pagedLoadingLine } from "../../shared/loading.js";
import type { PlanTransport } from "./transport.js";
import { usePlanWords } from "../words.js";
import type { PlanEventCounts } from "../frame/counts.js";

type Styles = Record<string, Record<string, unknown>>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;

/** A source whose Save notice the footer shows: its part, and the words it counts in. */
export interface PlanSaveNotice {
    /** The source's name: the notice's key. */
    readonly key: string;
    /** Its part of the slice. */
    readonly slice: ValueTypeOf<RecordSliceBindType>;
    /** One of what it counts (`row`, `print job event`). */
    readonly singular: string;
    /** More than one (`rows`, `print job events`). */
    readonly plural: string;
}

const stringEqual = equalFor(StringType);

/** Nothing to ask again: an inline canvas reads nothing. */
const NO_RETRY = () => undefined;

export interface PlanFooterProps {
    styles: Styles;
    /** The author's footer items, in order. */
    items: ReadonlyArray<FooterItemValue>;
    /** Paged transport state — omitted on an inline canvas. */
    transport?: PlanTransport | undefined;
    /** What the rail counts the rows in — `rows`, `print jobs` — what the loading line names them by (#1398). */
    noun: string;
    /** The event kinds' counts (#1193, PB23) — omitted for a Plan without event kinds. */
    counts?: PlanEventCounts | undefined;
    /** The event kinds' first read has not landed (#1398, CL13): their count holds its place, "…", never 0. */
    unread?: boolean | undefined;
    /** The changes waiting on Save — omitted for a Plan that does not edit. */
    pending?: number | undefined;
    /** Exact, confirmed feedback when saved records leave a source's narrowing — one per source (#1344). */
    notices?: readonly PlanSaveNotice[] | undefined;
}

/** The 28px footer band (renders nothing with nothing to say). */
export function PlanFooter({ styles, items, transport, noun, counts, unread, pending, notices }: PlanFooterProps) {
    const words = usePlanWords();
    const { m } = words;
    // The loading line, in the Plan's words (#1398, CL3), on the Plan's one reveal clock (CL4): its frame's
    // `LoadingReveal`, which the runs' placeholders read too — else, alone, a clock of its own.
    const loading = transport?.loading;
    const retry = transport?.retry ?? NO_RETRY;
    // In the rows' noun — or, while the cells of the rows in view are read, their events' (#1398).
    const reads = transport?.noun ?? noun;
    const line = useMemo(() => pagedLoadingLine(loading, reads, m, words.number, retry), [loading, reads, m, words, retry]);
    const revealed = useRevealed();
    const alone = useLoadingReveal(revealed === undefined && loading !== undefined && loading.kind !== "failed");
    const shown = revealed ?? alone;
    const rail = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(rail);
    // The Plan's own counts, in the order the footer reads them — the events' "…" until their first read lands.
    const own: { key: string; text: string }[] = [];
    if (counts !== undefined) own.push({ key: "events", text: m.footerEvents({ n: counts.events, count: words.number(counts.events) }) });
    else if (unread === true) own.push({ key: "events", text: m.footerEvents({ n: 2, count: "…" }) });
    if (counts?.backlog !== undefined) own.push({ key: "backlog", text: m.footerBacklog({ n: counts.backlog, count: words.number(counts.backlog) }) });
    if (pending !== undefined) own.push({ key: "pending", text: m.footerPending({ n: pending, count: words.number(pending) }) });
    const saved = counts?.saved;
    if (saved !== undefined) {
        // Its time when it was today, its date and time otherwise.
        const today = stringEqual(words.date(saved), words.date(new Date()));
        own.push({ key: "saved", text: m.footerSaved({ when: today ? words.time(saved) : words.dateTime(saved) }) });
    }
    if (own.length === 0 && items.length === 0 && transport === undefined && (notices?.length ?? 0) === 0) return null;
    // The counts and the author's items: each whole, the legend the rail fits.
    const units = own.length + items.length;
    return (
        <Box ref={rail} css={styles.footer} data-slot="footer">
            {own.map((count, i) => (
                <Box key={count.key} css={styles.footerItem} data-plan-count={count.key} data-footer-unit="" data-footer-cut={footerCut(i, fit)}>{count.text}</Box>
            ))}
            {items.map((item, i) => {
                const tone = item.tone.type === "some" ? item.tone.value.type : undefined;
                return (
                    <Box key={i} css={styles.footerItem} data-tone={tone} data-end={item.end ? "" : undefined}
                        data-footer-unit="" data-footer-cut={footerCut(own.length + i, fit)}>
                        {item.text}
                    </Box>
                );
            })}
            <FooterMore shown={fit.kept < units} />
            {notices?.map((notice) => <RecordSliceSaveNotice key={notice.key} slice={notice.slice} singular={notice.singular} plural={notice.plural} />)}
            {transport !== undefined && <LoadingLine value={line} shown={shown} form={fit.form} />}
        </Box>
    );
}
