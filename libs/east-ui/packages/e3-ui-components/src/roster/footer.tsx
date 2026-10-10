/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { Box } from "@chakra-ui/react";
import { viewTotals } from "./model.js";
import { money, type RosterViewsProps } from "./views.js";

const LEGEND = [
    { key: "permanent", label: "Permanent" }, { key: "agency", label: "Agency staff" },
    { key: "overtime", label: "Overtime" }, { key: "requested", label: "Requested" },
    { key: "open", label: "Open" }, { key: "needed", label: "Hours needed" },
] as const;
/** Plan's complete footer rail, with Roster's coverage readouts and legend. */
export function RosterFooter({ props, pending, filtered, loading }: { props: RosterViewsProps; pending: number; filtered: boolean; loading: boolean }) {
    const { styles, value, format } = props;
    const totals = viewTotals(value, props.coverage, props.view, props.day);
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
    return <Box ref={ref} css={styles.footer} data-roster-footer="" data-builder-narrow={props.narrow || wrap ? "" : undefined}>
        <Box as="span" css={styles.footerItem}>{props.week.assignments.size} assignments this week</Box>
        <Box as="span" css={styles.footerItem}>{pending} pending</Box>
        <Box as="span" css={styles.footerItem} data-roster-hours="" data-tone={totals.hours < totals.needed ? "warning" : undefined}>{totals.days === 1 ? "Day" : "Week"} {format.number(totals.hours)} / {format.number(totals.needed)} h</Box>
        {value.costs.type === "some" && <Box as="span" css={styles.footerItem} data-roster-cost="" data-tone={totals.budget !== undefined && totals.cost > totals.budget ? "danger" : undefined}>{money(format, value, totals.cost)}{totals.budget !== undefined && ` / ${money(format, value, totals.budget)} budget`}</Box>}
        <Box as="span" css={styles.footerItem}>{props.issues.filter(i => i.kind.type === "breach" || i.kind.type === "gap").length} issues</Box>
        <Box as="span" css={styles.footerItem}>{props.issues.filter(i => i.kind.type === "agree").length} to agree</Box>
        <Box as="span" css={styles.footerItem}>{props.proposals.length} proposals</Box>
        {LEGEND.map(item => <Box as="span" key={item.key} css={[styles.footerItem, styles.legendItem]} data-roster-legend={item.key}>
            <Box as="span" aria-hidden="true" css={[item.key === "needed" ? styles.coverageTick : styles.coverageSegment, styles.legendSwatch]} data-kind={item.key} />{item.label}
        </Box>)}
        {filtered && value.visiblePeople.type === "some" && <><Box as="span" css={styles.footerItem}>{value.visiblePeople.value.size} of {value.people.length} people visible</Box><Box as="span" css={styles.footerItem}>Coverage includes all staff</Box></>}
        {loading && <Box as="span" css={styles.footerItem}>Loading…</Box>}
    </Box>;
}
