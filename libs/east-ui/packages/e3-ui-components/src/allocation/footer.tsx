/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { FooterMore, LoadingLine, footerCut, useFooterFit, useRevealed, type LoadingLineValue } from "@elaraai/east-ui-components/internal";
import type { AllocationStyles } from "./model.js";
import { one, useNouns, type Nouns } from "./nouns.js";

/**
 * Each layout's legend, as the mock's footer lists it (§8): a link is `Link`, its width unexplained (ruled 17 Oct), and
 * the Table's chip the board's nouns' (#1338).
 *
 * @param nouns - The board's nouns
 * @returns Each layout's items
 */
export const legends = (nouns: Nouns) => ({
    timeline: [
        { kind: "bin", label: "Bin" }, { kind: "draft", label: "Draft" }, { kind: "load", label: "Today's load" },
        { kind: "prior", label: "Prior job" }, { kind: "next", label: "Next job" }, { kind: "overlap", label: "Overlap" },
        { kind: "link", label: "Link" }, { kind: "draftLink", label: "Draft link" },
    ],
    table: [
        { kind: "bin", label: `${nouns.arrival.one} or ${one(nouns.resource)}` }, { kind: "draft", label: "Draft" }, { kind: "empty", label: "Empty · drop here" },
        { kind: "reserved", label: "Reserved" }, { kind: "free", label: "Free" },
    ],
});

/**
 * The shared footer rail with the layout's legend (A79) — no counts, hints or
 * status — and at its trailing end the shared loading line (#1398, CL3): the
 * day being read — `Loading Tue, May 11, 2027` — or why it could not be, with
 * Retry. The rail never wraps and never cuts a word: the legend stays whole
 * and in place, ending at a whole item, then "…", only where it cannot fit.
 * The line shows on the frame's one reveal clock (CL4, its `LoadingReveal`),
 * which the day's placeholders keep too.
 */
export function AllocationFooter({ styles, layout, line }: {
    styles: AllocationStyles; layout: "timeline" | "table";
    /** What the day's read says: the day being read, or why it could not be; `undefined` while it has landed. */
    line: LoadingLineValue | undefined;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const fit = useFooterFit(ref);
    const shown = useRevealed() === true;
    const items = legends(useNouns())[layout];
    return <Box ref={ref} css={styles.footer} data-allocation-footer={layout}>
        {items.map((item, i) => <Box as="span" key={item.kind} css={[styles.footerItem, styles.legendItem]} data-allocation-legend={item.kind}
            data-footer-unit="" data-footer-cut={footerCut(i, fit)}>
            <Box as="span" aria-hidden="true" css={styles.legendSwatch} data-kind={item.kind} />{item.label}
        </Box>)}
        <FooterMore shown={fit.kept < items.length} />
        <LoadingLine value={line} shown={shown} form={fit.form} />
    </Box>;
}
