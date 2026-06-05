/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFilter, faLayerGroup, faUsers, faMagnifyingGlass, faCalendar, faChevronDown, faChevronUp, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useReflow } from "../../hooks/useReflow";
import { EastChakraComponent } from "../../component";
import { SliceDensityContext } from "../density";
import { useSliceReactivity } from "../use-slice-reactivity";
import { EastChakraSliceFilter } from "../filter";
import { EastChakraSliceSearch } from "../search";
import { EastChakraSliceBreakdown } from "../breakdown";
import { EastChakraSliceRange } from "../range";
import { EastChakraSliceCohort } from "../cohort";

export interface EastChakraSliceFrameProps {
    value: {
        slice: unknown;
        body: unknown;
        affordances: ReadonlyArray<{ type: string }>;
        meta: unknown;
        footer: { type: string; value?: unknown };
        collapsible: boolean;
        defaultCollapsed: boolean;
    };
    storageKey: string;
}

/** Per-affordance icon + label — a consistent block header in every layout. */
const AFFORDANCE_META: Record<string, { icon: IconDefinition; label: string }> = {
    filter:    { icon: faFilter,          label: "Filter" },
    breakdown: { icon: faLayerGroup,      label: "Split" },
    cohort:    { icon: faUsers,           label: "Cohort" },
    search:    { icon: faMagnifyingGlass, label: "Search" },
    range:     { icon: faCalendar,        label: "Range" },
};

/**
 * One affordance, wrapped so it reads the same whether the bar is inline or
 * stacked. **Inline** — a leading icon + the affordance's own control (the
 * controls self-describe, so no heavy label). **Stacked** — a fixed label
 * gutter (`icon Label`) + the control filling the row, for scannability.
 */
function SliceBlock({ kind, stacked, children }: { kind: string; stacked: boolean; children: ReactNode }): ReactNode {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const meta = AFFORDANCE_META[kind];
    if (stacked) {
        return (
            <Box display="flex" alignItems="center" gap="{spacing.3}" minHeight="30px" width="full">
                <Box css={styles.frameAffordanceLabel}>
                    <Box as="span" css={styles.frameAffordanceIcon}>
                        {meta && <FontAwesomeIcon icon={meta.icon} style={{ fontSize: "10px" }} />}
                    </Box>
                    <Box as="span">{meta?.label}</Box>
                </Box>
                <Box flex="1" minWidth="0" display="flex" alignItems="center">{children}</Box>
            </Box>
        );
    }
    return (
        <Box display="inline-flex" alignItems="center" gap="{spacing.1.5}" flexShrink="0" minWidth="0" title={meta?.label}>
            <Box as="span" css={styles.frameAffordanceIcon}>
                {meta && <FontAwesomeIcon icon={meta.icon} style={{ fontSize: "10px" }} />}
            </Box>
            {children}
        </Box>
    );
}

/** `N` narrowed of `M` total → integer percent narrowed, e.g. 12,840 → 4,218 ⇒ 67. */
function pctNarrowed(total: number, result: number): number {
    return total > 0 ? Math.round((1 - result / total) * 100) : 0;
}

/**
 * Active-narrowing summary for the collapsed eyebrow — one entry (icon + brief
 * value) per active affordance, so a collapsed frame still reads "what's
 * narrowed" at a glance. Reads the option fields via `getSomeorUndefined`.
 */
function summarizeSlice(
    state: ValueTypeOf<typeof Slice.Types.State>,
    dimensions: ReadonlyArray<ValueTypeOf<typeof Slice.Types.Dimension>>,
): Array<{ icon: IconDefinition; text: string }> {
    const parts: Array<{ icon: IconDefinition; text: string }> = [];
    const n = state.filters.length;
    if (n > 0) parts.push({ icon: faFilter, text: `${n} filter${n > 1 ? "s" : ""}` });
    const breakdown = getSomeorUndefined(state.breakdown);
    if (breakdown !== undefined) {
        parts.push({ icon: faLayerGroup, text: dimensions.find(d => d.fieldId === breakdown.fieldId)?.label ?? breakdown.fieldId });
    }
    if (getSomeorUndefined(state.range) !== undefined) parts.push({ icon: faCalendar, text: "Range" });
    const q = getSomeorUndefined(state.search);
    if (q !== undefined && q !== "") parts.push({ icon: faMagnifyingGlass, text: `"${q}"` });
    const cohorts = state.activeCohorts.size;
    if (cohorts > 0) parts.push({ icon: faUsers, text: `${cohorts} cohort${cohorts > 1 ? "s" : ""}` });
    return parts;
}

/**
 * Renders an East UI `Slice.Frame` — the container that houses one slice
 * consumer. The eyebrow is a reflowing affordance bar (labelled blocks, inline
 * when they fit / stacked rows when they don't, never hidden) with optional
 * collapse to a one-line summary; below it the unpadded `body` and a
 * derived-count footer. Affordances render compact via `SliceDensityContext`;
 * an empty affordance list omits the eyebrow entirely.
 */
export const EastChakraSliceFrame = memo(function EastChakraSliceFrame({ value, storageKey }: EastChakraSliceFrameProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    // The embedded slice closure — only the config/data getters the frame reads.
    // The affordance renderers consume their own `Slice.*` shapes (`{ slice }`
    // is enough; options default via the tolerant `getSomeorUndefined`).
    const slice = value.slice as ValueTypeOf<typeof Slice.Types.Bind>;
    useSliceReactivity(slice.key);
    // Collapsed eyebrow — a one-line summary of what's narrowed; expand to the
    // affordance bar to edit. Author-controlled via `collapsible`/`defaultCollapsed`.
    const [collapsed, setCollapsed] = useState(value.defaultCollapsed);

    // Mount the real Slice.* component for each listed affordance, in order.
    const renderAffordance = (kind: string, i: number) => {
        const v = { slice } as never;
        switch (kind) {
            case "filter":    return <EastChakraSliceFilter key={`af-${i}`} value={v} />;
            case "breakdown": return <EastChakraSliceBreakdown key={`af-${i}`} value={v} />;
            case "cohort":    return <EastChakraSliceCohort key={`af-${i}`} value={v} />;
            case "search":    return <EastChakraSliceSearch key={`af-${i}`} value={v} />;
            case "range":     return <EastChakraSliceRange key={`af-${i}`} value={v} />;
            default:          return null;
        }
    };

    const state = slice.read();
    // The eyebrow adapts to slice state, not just the static config: a cohort
    // created via "Save as cohort" should become visible/manageable even if the
    // author didn't list `cohort`, so it's appended once any cohort exists.
    const configuredKinds = value.affordances.map(a => a.type);
    const affordanceKinds = state.cohorts.length > 0 && !configuredKinds.includes("cohort")
        ? [...configuredKinds, "cohort"]
        : configuredKinds;

    // Affordances live in one bar that reflows: a single inline row when it
    // fits, stacked labeled rows when it doesn't (`useReflow`). No affordance is
    // ever hidden behind a menu — editing each is always a click on its trigger.
    // (Collapsed hides the bar, so vary the signature to re-measure on expand.)
    const { rowRef, stacked } = useReflow(collapsed ? "·collapsed·" : affordanceKinds.join(","));

    const meta = getSomeorUndefined(value.meta as never) as never;
    const footerKind = value.footer.type;
    // Collapse is only worth offering with more than one affordance — folding a
    // single affordance to a summary just swaps one row for another of a
    // different size. A single affordance still renders (no chevron).
    const hasEyebrow = affordanceKinds.length > 0 || meta !== undefined;
    const canCollapse = value.collapsible && affordanceKinds.length > 1;
    const summary = collapsed
        ? summarizeSlice(state, typeof slice.dimensions === "function" ? slice.dimensions() : [])
        : [];

    return (
        <SliceDensityContext.Provider value="compact">
            <Box css={styles.root}>
                {hasEyebrow && (
                    <Box css={styles.frameEyebrow}>
                        {collapsed ? (
                            <Box css={styles.frameSummary} flex="1" minWidth="0">
                                {summary.length === 0
                                    ? <Box as="span">No active filters</Box>
                                    : summary.map((p, i) => (
                                        <Box as="span" key={i} css={styles.frameSummaryItem}>
                                            <Box as="span" css={styles.frameAffordanceIcon} width="auto">
                                                <FontAwesomeIcon icon={p.icon} style={{ fontSize: "10px" }} />
                                            </Box>
                                            {p.text}
                                        </Box>
                                    ))}
                            </Box>
                        ) : (
                            <Box
                                ref={rowRef}
                                display="flex"
                                flexDirection={stacked ? "column" : "row"}
                                flexWrap="nowrap"
                                alignItems={stacked ? "stretch" : "center"}
                                gap={stacked ? "{spacing.2}" : "{spacing.3}"}
                                overflow="hidden"
                                minWidth="0"
                                flex="1"
                            >
                                {affordanceKinds.map((kind, i) => (
                                    <SliceBlock key={`af-${kind}-${i}`} kind={kind} stacked={stacked}>
                                        {renderAffordance(kind, i)}
                                    </SliceBlock>
                                ))}
                            </Box>
                        )}
                        <Box display="flex" alignItems="center" gap="{spacing.2}" flexShrink="0" alignSelf={collapsed ? "center" : "flex-start"}>
                            {meta !== undefined && (
                                <Box css={styles.frameEyebrowMeta}>
                                    <EastChakraComponent value={meta} storageKey={`${storageKey}.meta`} />
                                </Box>
                            )}
                            {canCollapse && (
                                <chakra.button
                                    type="button"
                                    onClick={() => setCollapsed(c => !c)}
                                    aria-label={collapsed ? "Expand slice controls" : "Collapse slice controls"}
                                    aria-expanded={!collapsed}
                                    css={styles.frameCollapseToggle}
                                >
                                    <FontAwesomeIcon icon={collapsed ? faChevronDown : faChevronUp} style={{ fontSize: "11px" }} />
                                </chakra.button>
                            )}
                        </Box>
                    </Box>
                )}

                <Box css={styles.frameBody}>
                    <EastChakraComponent value={value.body as never} storageKey={`${storageKey}.body`} />
                </Box>

                {footerKind === "custom" && (
                    <Box css={styles.frameFooter}>
                        <EastChakraComponent value={value.footer.value as never} storageKey={`${storageKey}.footer`} />
                    </Box>
                )}
                {footerKind === "derived" && (() => {
                    const total = Number(slice.totalCount() as bigint);
                    const result = Number(slice.resultCount() as bigint);
                    const pct = pctNarrowed(total, result);
                    return (
                        <Box css={styles.frameFooter}>
                            <Box as="span" css={styles.frameFooterStat}>{result.toLocaleString()}</Box>
                            <Box as="span">{`rows · of ${total.toLocaleString()}`}</Box>
                            {pct > 0 && <Box as="span" css={styles.frameFooterDelta}>{`· −${pct}%`}</Box>}
                        </Box>
                    );
                })()}
            </Box>
        </SliceDensityContext.Provider>
    );
}, () => false);
