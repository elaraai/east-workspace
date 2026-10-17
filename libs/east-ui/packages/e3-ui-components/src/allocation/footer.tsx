/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { useRailWrap } from "../shared/schedule/footer.js";
import type { AllocationStyles } from "./model.js";

/** Each layout's legend, as the mock's footer lists it (§8). */
export const LEGENDS = {
    timeline: [
        { kind: "bin", label: "Bin" }, { kind: "draft", label: "Draft" }, { kind: "load", label: "Today's load" },
        { kind: "prior", label: "Prior job" }, { kind: "next", label: "Next job" }, { kind: "overlap", label: "Overlap" },
        { kind: "link", label: "Link · width by share of the focus's largest load" }, { kind: "draftLink", label: "Draft link" },
    ],
    table: [
        { kind: "bin", label: "Event or resource" }, { kind: "draft", label: "Draft" }, { kind: "empty", label: "Empty · drop here" },
        { kind: "reserved", label: "Reserved" }, { kind: "free", label: "Free" },
    ],
} as const;

/** The shared footer rail with the layout's legend only (A79): no counts, hints or status; each item wraps on its own. */
export function AllocationFooter({ styles, layout, narrow }: { styles: AllocationStyles; layout: "timeline" | "table"; narrow: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, layout);
    return <Box ref={ref} css={styles.footer} data-allocation-footer={layout} data-builder-narrow={narrow || wrap ? "" : undefined}>
        {LEGENDS[layout].map(item => <Box as="span" key={item.kind} css={[styles.footerItem, styles.legendItem]} data-allocation-legend={item.kind}>
            <Box as="span" aria-hidden="true" css={styles.legendSwatch} data-kind={item.kind} />{item.label}
        </Box>)}
    </Box>;
}
