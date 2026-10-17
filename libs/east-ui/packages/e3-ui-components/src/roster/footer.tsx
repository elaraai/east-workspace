/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useRef } from "react";
import { Box } from "@chakra-ui/react";
import { useRailWrap } from "../shared/schedule/footer.js";
import type { RosterStyles } from "./model.js";

const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "overtime", label: "Overtime" }, { key: "requested", label: "Requested" },
    { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/** The shared footer rail explains the coverage marks; details stay in the inspector. */
export function RosterFooter({ styles, narrow }: { styles: RosterStyles; narrow: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const wrap = useRailWrap(ref, LEGEND);
    return <Box ref={ref} css={styles.footer} data-roster-footer="" data-builder-narrow={narrow || wrap ? "" : undefined}>
        {LEGEND.map(item => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
    </Box>;
}
