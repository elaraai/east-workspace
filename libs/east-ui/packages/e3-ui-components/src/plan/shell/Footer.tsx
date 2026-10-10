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
 * On a PAGED canvas the footer also carries the component's own transport line
 * (#567 D9) — `N loaded of M · Loading…`, right-aligned and marked
 * `data-slot="footerTransport"` so it is distinguishable from the
 * author-supplied items it sits beside. A canvas showing a prefix must say
 * so, whether or not the author supplied any items.
 */

import { Box } from "@chakra-ui/react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import { Plan } from "@elaraai/e3-ui/internal";
import { transportLine, type PlanTransport } from "./transport.js";
import { usePlanWords } from "../words.js";
import type { PlanEventCounts } from "../frame/counts.js";

type Styles = Record<string, Record<string, unknown>>;
type FooterItemValue = ValueTypeOf<typeof Plan.Types.FooterItem>;

const stringEqual = equalFor(StringType);

export interface PlanFooterProps {
    styles: Styles;
    /** The author's footer items, in order. */
    items: ReadonlyArray<FooterItemValue>;
    /** Paged transport state — omitted on an inline canvas. */
    transport?: PlanTransport | undefined;
    /** The event kinds' counts (#1193, PB23) — omitted for a Plan without event kinds. */
    counts?: PlanEventCounts | undefined;
    /** The changes waiting on Save — omitted for a Plan that does not edit. */
    pending?: number | undefined;
    /** Whether the canvas draws its narrow layout: the items then wrap. */
    narrow?: boolean | undefined;
}

/** The 28px footer band (renders nothing with nothing to say). */
export function PlanFooter({ styles, items, transport, counts, pending, narrow }: PlanFooterProps) {
    const words = usePlanWords();
    const { m } = words;
    // The Plan's own counts, in the order the footer reads them.
    const own: { key: string; text: string }[] = [];
    if (counts !== undefined) own.push({ key: "events", text: m.footerEvents({ n: counts.events, count: words.number(counts.events) }) });
    if (counts?.backlog !== undefined) own.push({ key: "backlog", text: m.footerBacklog({ n: counts.backlog, count: words.number(counts.backlog) }) });
    if (pending !== undefined) own.push({ key: "pending", text: m.footerPending({ n: pending, count: words.number(pending) }) });
    const saved = counts?.saved;
    if (saved !== undefined) {
        // Its time when it was today, its date and time otherwise.
        const today = stringEqual(words.date(saved), words.date(new Date()));
        own.push({ key: "saved", text: m.footerSaved({ when: today ? words.time(saved) : words.dateTime(saved) }) });
    }
    if (own.length === 0 && items.length === 0 && transport === undefined) return null;
    return (
        <Box css={styles.footer} data-slot="footer" data-builder-narrow={narrow === true ? "" : undefined} data-plan-narrow={narrow === true ? "" : undefined}>
            {own.map((count) => (
                <Box key={count.key} css={styles.footerItem} data-plan-count={count.key}>{count.text}</Box>
            ))}
            {items.map((item, i) => {
                const tone = item.tone.type === "some" ? item.tone.value.type : undefined;
                return (
                    <Box key={i} css={styles.footerItem} data-tone={tone} data-end={item.end ? "" : undefined}>
                        {item.text}
                    </Box>
                );
            })}
            {transport !== undefined && (
                <Box css={styles.footerItem} data-end="" data-slot="footerTransport"
                    data-partial={transport.partial ? "" : undefined}>
                    {transportLine(transport, words)}
                </Box>
            )}
        </Box>
    );
}
