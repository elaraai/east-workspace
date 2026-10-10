/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import type { RosterStyles } from "./model.js";

const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "overtime", label: "Overtime" }, { key: "requested", label: "Requested" },
    { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/** The shared footer rail explains the coverage marks; details stay in the inspector. */
export function RosterFooter({ styles, narrow }: { styles: RosterStyles; narrow: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const [wrap, setWrap] = useState(false);
    // The whole rail can be wider than main. Fit its actual items, including
    // translated labels, rather than assuming that a viewport breakpoint fits.
    useLayoutEffect(() => {
        const rail = ref.current; if (rail === null) return;
        const measure = () => {
            const items = [...rail.children];
            const required = items.reduce((n, item) => n + item.getBoundingClientRect().width, 0)
                + Math.max(0, items.length - 1) * Number.parseFloat(String(styles.footer?.gap ?? 14)) + 24;
            setWrap(required > rail.getBoundingClientRect().width);
        };
        measure(); const observer = new ResizeObserver(measure); observer.observe(rail);
        for (const item of rail.children) observer.observe(item);
        return () => observer.disconnect();
    });
    return <Box ref={ref} css={styles.footer} data-roster-footer="" data-builder-narrow={narrow || wrap ? "" : undefined}>
        {LEGEND.map(item => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
    </Box>;
}
