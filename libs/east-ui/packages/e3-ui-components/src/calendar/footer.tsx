/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { CalendarKind, CalendarStyles } from "./model.js";
import type { CalendarEventPart } from "./window.js";

/**
 * The shared footer rail explains the Calendar's event kinds, each by its
 * icon, then each kind's Save notice of the events that left its source's
 * narrowing, and at its trailing end the shared loading line (#1398, CL3):
 * the period being read — `Loading November 2026` — or why it could not be,
 * with Retry. The rail never wraps and never cuts a word: the legend stays
 * whole and in place, ending at a whole kind, then "…", only where it cannot
 * fit. The line shows on the frame's one reveal clock (CL4, its
 * `LoadingReveal`), which the period's placeholders keep too.
 */
export function CalendarFooter({ styles, kinds, parts, locale, line }: {
    styles: CalendarStyles;
    /** The event kinds the legend explains. */
    kinds: readonly CalendarKind[];
    /** Each event kind's part of the slice, whose Save notice counts what leaves its narrowing. */
    parts: readonly CalendarEventPart[];
    /** The locale a kind's name is written in, lower-cased in its notice. */
    locale: string;
    /** What the period's read says: the period being read, or why it could not be; `undefined` while it has landed. */
    line: LoadingLineValue | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    return <Box ref={ref} css={styles.footer} data-calendar-footer="">
        {kinds.map((kind, i) => <Box as="span" key={kind.key} css={styles.footerItem} data-calendar-legend={kind.key}
            data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
            <Box as="span" css={styles.eventIcon}><FontAwesomeIcon icon={["fas", kind.icon as IconName]} /></Box> {kind.name}
        </Box>)}
        <FooterMore shown={fit.kept < kinds.length} />
        {parts.map(({ kind, part }) => <RecordSliceSaveNotice key={kind.key} slice={part}
            singular={`${kind.name.toLocaleLowerCase(locale)} event`} plural={`${kind.name.toLocaleLowerCase(locale)} events`} />)}
        <LoadingLine value={line} shown={shown} form={fit.form} />
    </Box>;
}
