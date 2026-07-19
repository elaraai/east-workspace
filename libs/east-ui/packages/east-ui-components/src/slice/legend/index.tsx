/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faEyeSlash, faFilter } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { nextFieldFilters, selectedFieldKeys } from "../key-predicate";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Legend value type. */
export type SliceLegendValue = ValueTypeOf<typeof Slice.Legend.Types.Legend>;

export interface EastChakraSliceLegendProps {
    value: SliceLegendValue;
}

/**
 * Renders an East UI `Slice.Legend` — a rail of `swatch · label · count`
 * items over the platform-computed breakdown groups. The item's **primary
 * click cross-filters** (`slice.toggleFilter` with an equality predicate on
 * the breakdown field — idempotent, narrows every shared-key view); the
 * **eye button** beside it toggles chart-series visibility, derived from
 * `state.visible` (none = all visible, collapsing back to `none` when all
 * are visible). Items with no expressible equality (the top-N `other`
 * roll-up, float kinds) fall back to a whole-item visibility toggle.
 */
export const EastChakraSliceLegend = memo(function EastChakraSliceLegend({ value }: EastChakraSliceLegendProps) {
    const { slice } = value;
    useSliceReactivity(slice.key);
    const state = slice.read();
    // `filter` (default, #188) = the facet bar over the SELF-EXCLUDING
    // facetGroups() — options never disappear while selected. `visibility` =
    // the chart-decluttering eye rail over groups().
    const mode = getSomeorUndefined(value.mode)?.type ?? "filter";
    const groups = mode === "filter" ? slice.facetGroups() : slice.groups();
    const visible = getSomeorUndefined(state.visible);

    const chip = useRecipe({ key: "chip" });
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const allKeys = groups.map(g => g.key);
    const visibleSet = visible !== undefined ? new Set(visible) : new Set(allKeys);

    const breakdown = getSomeorUndefined(state.breakdown);
    const breakdownFieldId = breakdown?.fieldId;
    const limitActive = breakdown !== undefined && getSomeorUndefined(breakdown.limit) !== undefined;
    const breakdownKind = breakdownFieldId !== undefined
        ? slice.fields().find(f => f.fieldId === breakdownFieldId)?.kind
        : undefined;
    // The facet selection — the members of the field's managed `in`-set
    // filter, keyed like group keys so `selected.has(g.key)` just works.
    const selected = breakdownFieldId !== undefined && breakdownKind !== undefined
        ? selectedFieldKeys(state.filters, breakdownKind, breakdownFieldId)
        : new Set<string>();

    // A facet click toggles the key's membership in the field's `in`-set —
    // OR within the field, AND across fields — written atomically. Read the
    // LIVE state in the handler (not the render-time snapshot): a second
    // click before the re-render commits must compose, not overwrite.
    const facetClick = (key: string) => {
        if (breakdownFieldId === undefined || breakdownKind === undefined) return;
        const live = slice.read();
        const next = nextFieldFilters(live.filters, breakdownKind, breakdownFieldId, key);
        if (next !== undefined) slice.write({ ...live, filters: next });
    };
    const facetSelectable = (key: string) =>
        breakdownFieldId !== undefined && breakdownKind !== undefined
        && !(limitActive && key === "other")
        && nextFieldFilters([], breakdownKind, breakdownFieldId, key) !== undefined;

    const toggle = (key: string) => {
        const next = new Set(visibleSet);
        if (next.has(key)) next.delete(key); else next.add(key);
        if (next.size === allKeys.length) slice.setVisible(none);
        else slice.setVisible(some(next));
    };

    // Cap 6 series inline; the chart can't render more legibly. Series 7+ collapse
    // into one aggregated "Others" entry (the only Slice.* that aggregates on overflow).
    const INLINE_CAP = 6;
    const total = groups.reduce((sum, g) => sum + Number(g.count), 0);
    const pct = (n: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : "—";
    const shown = groups.slice(0, INLINE_CAP);
    const rest = groups.slice(INLINE_CAP);
    const restTotal = rest.reduce((sum, g) => sum + Number(g.count), 0);

    // Spec `Slice.Legend`: a bare inline rail — flex, 16px gap, mono 10.5px.
    // Each item is swatch (14×3 bar) · label (600) · value%, with a 6px inner
    // gap. No chip chrome. "Others" is the one dashed-pill exception.
    return (
        <Box css={styles.legendRail}>
            {shown.map((g) => {
                if (mode === "visibility") {
                    const on = visibleSet.has(g.key);
                    return (
                        <chakra.button key={g.key} type="button" onClick={() => toggle(g.key)} css={styles.legendItem} opacity={on ? 1 : 0.5} aria-label={`Toggle visibility of ${g.key}`} aria-pressed={on}>
                            <Box as="span" css={styles.legendSwatch} background={g.color} opacity={on ? 1 : 0.45} />
                            <Box as="span" css={styles.legendLabel}>{g.key}</Box>
                            <Box as="span" css={styles.legendValue}>{pct(Number(g.count))}</Box>
                            <Box as="span" color={on ? "link" : "fg.muted"} fontSize="9px">
                                <FontAwesomeIcon icon={on ? faEye : faEyeSlash} />
                            </Box>
                        </chakra.button>
                    );
                }
                // Facet bar: ONE gesture — click toggles the item in the
                // field's selection. Non-expressible items (the `other`
                // roll-up, float kinds) render as plain labels.
                if (!facetSelectable(g.key)) {
                    return (
                        <Box key={g.key} as="span" css={styles.legendItem} cursor="default">
                            <Box as="span" css={styles.legendSwatch} background={g.color} />
                            <Box as="span" css={styles.legendLabel}>{g.key}</Box>
                            <Box as="span" css={styles.legendValue}>{pct(Number(g.count))}</Box>
                        </Box>
                    );
                }
                const applied = selected.has(g.key);
                const dimmed = selected.size > 0 && !applied;
                return (
                    <chakra.button
                        key={g.key}
                        type="button"
                        onClick={() => facetClick(g.key)}
                        css={styles.legendItem}
                        opacity={dimmed ? 0.55 : 1}
                        aria-label={`Filter to ${g.key}`}
                        aria-pressed={applied}
                    >
                        <Box as="span" css={styles.legendSwatch} background={g.color} opacity={dimmed ? 0.45 : 1} />
                        <Box as="span" css={styles.legendLabel} color={applied ? "{colors.brand.700}" : undefined}>{g.key}</Box>
                        <Box as="span" css={styles.legendValue}>{pct(Number(g.count))}</Box>
                        {applied && (
                            <Box as="span" color="link" fontSize="9px">
                                <FontAwesomeIcon icon={faFilter} />
                            </Box>
                        )}
                    </chakra.button>
                );
            })}
            {rest.length > 0 && (
                <Box as="span" css={chip({ tone: "dashed", shape: "pill" })}>
                    <Box as="span" width="14px" height="0" borderTopWidth="2px" borderStyle="dashed" borderColor="fg.muted" />
                    <Box as="span" fontWeight="bold" color="fg.muted">Others</Box>
                    <Box as="span" fontVariantNumeric="tabular-nums" color="fg.subtle">{`${pct(restTotal)} · ${rest.length} series`}</Box>
                </Box>
            )}
        </Box>
    );
}, () => false);
