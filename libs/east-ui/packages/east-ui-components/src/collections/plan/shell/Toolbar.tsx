/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan toolbar (44px, `Plan Spec.html` §1) — slice chrome + the
 * resolution segment. Slice affordances mount through the shared
 * `SliceRailCluster` (the rail's measured ladder, verbatim); `resolution`
 * renders the WEEK/DAY `seg` strip (a slice write via the machine), `summary`
 * the right-edge `N of M · narrowings` line.
 */

import { useMemo } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { SliceRailCluster } from "../../../slice/rail/index.js";
import { railAffordanceKinds } from "../../../slice/rail-kinds.js";
import { usePlanDispatch } from "../context.js";

type Styles = Record<string, Record<string, unknown>>;
type SliceBindValue = ValueTypeOf<typeof Slice.Types.Bind>;

/** The compact chrome segment strip (`seg` recipe). */
export function Seg({ items, active, onPick }: {
    items: ReadonlyArray<{ key: string; label: string }>;
    active: string;
    onPick: (key: string) => void;
}) {
    const seg = useSlotRecipe({ key: "seg" });
    const ss = useMemo(() => seg({}) as unknown as Styles, [seg]);
    return (
        <Box css={ss.root} data-slot="seg">
            {items.map((it) => (
                <Box key={it.key} as="button" css={ss.item} data-state={it.key === active ? "on" : undefined}
                    onClick={() => onPick(it.key)}>
                    {it.label}
                </Box>
            ))}
        </Box>
    );
}

export interface PlanToolbarProps {
    styles: Styles;
    /** The bound slice handle (undefined ⇒ segments only). */
    slice: SliceBindValue | undefined;
    /** The toolbar affordance kinds, in order (decoded `SliceChromeType`). */
    affordances: ReadonlyArray<string>;
    resolution: string;
    /** The resolution segment options (`[]` ⇒ no segment). */
    resolutions: ReadonlyArray<string>;
}

/** The 44px toolbar band. */
export function PlanToolbar({ styles, slice, affordances, resolution, resolutions }: PlanToolbarProps) {
    const dispatch = usePlanDispatch();
    // Rail-cluster affordances (the Table adopter pattern): route the listed
    // kinds through `railAffordanceKinds` (auto-appended cohort etc.), then
    // drop the kinds that mount as Plan chrome bands rather than rail chips —
    // `brush` (the horizon strip), `legend`, and the Plan's two new arms
    // (`resolution` segment, `summary` count line). `range` splits into its
    // own cluster so the §2 zone order holds: [cohort · filter · search]
    // [range] [resolution] [summary].
    const railKinds = useMemo(
        () => (slice === undefined ? [] : railAffordanceKinds(affordances, slice.read())
            .filter((k) => k !== "brush" && k !== "legend" && k !== "resolution" && k !== "summary")),
        [affordances, slice],
    );
    const clusterKinds = useMemo(() => railKinds.filter((k) => k !== "range"), [railKinds]);
    const rangeKinds = useMemo(() => railKinds.filter((k) => k === "range"), [railKinds]);
    const showSummary = slice !== undefined && affordances.includes("summary");
    const summary = useMemo(() => {
        if (!showSummary || slice === undefined) return undefined;
        const total = Number(slice.totalCount());
        const result = Number(slice.resultCount());
        const active = Number(slice.activeCount());
        return `${result} of ${total}${active > 0 ? ` · ${active} narrowing${active > 1 ? "s" : ""}` : ""}`;
    }, [showSummary, slice]);

    return (
        <Box css={styles.toolbar} data-slot="toolbar">
            {slice !== undefined && clusterKinds.length > 0 && (
                <SliceRailCluster slice={slice} affordanceKinds={clusterKinds} />
            )}
            <Box css={styles.toolbarGroup}>
                {slice !== undefined && rangeKinds.length > 0 && (
                    <SliceRailCluster slice={slice} affordanceKinds={rangeKinds} />
                )}
                {resolutions.length > 0 && (
                    <Seg
                        items={resolutions.map((r) => ({ key: r, label: r.toUpperCase() }))}
                        active={resolution}
                        onPick={(r) => dispatch({ t: "resolution.set", resolution: r })}
                    />
                )}
            </Box>
            {summary !== undefined && (
                <Box css={styles.footerItem} marginLeft="auto" data-slot="toolbarSummary">{summary}</Box>
            )}
        </Box>
    );
}
