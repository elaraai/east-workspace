/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import type { ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import { FooterMore, LoadingLine, RecordSliceSaveNotice, footerCut, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { RosterStyles } from "./model.js";

/** The coverage marks the legend explains: who fills a slot's hours, and what it needs. Overtime is the app's pay's to say (§5.6). */
const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "requested", label: "Requested" }, { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/**
 * The shared footer rail explains the coverage marks, then a Save's notice of
 * the duties that left the week's window, and at its trailing end the shared
 * loading line (#1398, CL3): the week being read — `Loading 12–18 Mar` — or
 * why it could not be, with Retry. The rail never wraps and never cuts a word:
 * the legend stays whole and in place, ending at a whole mark, then "…", only
 * where it cannot fit. Details stay in the inspector. The line shows on the
 * frame's one reveal clock (CL4, its `LoadingReveal`), which the week's
 * placeholders keep too.
 */
export function RosterFooter({ styles, duties, noun, line }: {
    styles: RosterStyles;
    /** The slice's part over the duties, whose Save notice counts what leaves the week's window. */
    duties: ValueTypeOf<RecordSliceBindType> | undefined;
    /** What a duty is called, singular and plural. */
    noun: { singular: string; plural: string };
    /** What the week's read says: the week being read, or why it could not be; `undefined` while it has landed. */
    line: LoadingLineValue | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    return <Box ref={ref} css={styles.footer} data-roster-footer="">
        {LEGEND.map((item, i) => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}
            data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
        <FooterMore shown={fit.kept < LEGEND.length} />
        {duties !== undefined && <RecordSliceSaveNotice slice={duties} singular={noun.singular} plural={noun.plural} />}
        <LoadingLine value={line} shown={shown} form={fit.form} />
    </Box>;
}
