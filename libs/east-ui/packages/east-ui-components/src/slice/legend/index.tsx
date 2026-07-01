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
import { breakdownKeyPredicate, predicateEqual } from "../key-predicate";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Legend value type. */
export type SliceLegendValue = ValueTypeOf<typeof Slice.Legend.Types.Legend>;

export interface EastChakraSliceLegendProps {
    value: SliceLegendValue;
}

/**
 * Renders an East UI `Slice.Legend` — a rail of `swatch · label · count ·
 * toggle` chips over the platform-computed breakdown groups. Visibility is
 * derived from `state.visible` (none = all visible); toggling flips the
 * group's membership and collapses back to `none` when all are visible.
 */
export const EastChakraSliceLegend = memo(function EastChakraSliceLegend({ value }: EastChakraSliceLegendProps) {
    const { slice } = value;
    useSliceReactivity(slice.key);
    const groups = slice.groups();
    const state = slice.read();
    const visible = getSomeorUndefined(state.visible);

    const chip = useRecipe({ key: "chip" });
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const allKeys = groups.map(g => g.key);
    const visibleSet = visible !== undefined ? new Set(visible) : new Set(allKeys);

    // The distinct "filter to this" gesture (#165): an equality predicate on
    // the active breakdown field, toggled idempotently — narrows every view
    // sharing this slice key (unlike the visibility toggle, which only hides
    // chart series). Hidden for the top-N `other` roll-up (not a field value)
    // and for kinds with no equality op.
    const breakdown = getSomeorUndefined(state.breakdown);
    const breakdownFieldId = breakdown?.fieldId;
    const limitActive = breakdown !== undefined && getSomeorUndefined(breakdown.limit) !== undefined;
    const breakdownKind = breakdownFieldId !== undefined
        ? slice.fields().find(f => f.fieldId === breakdownFieldId)?.kind
        : undefined;
    const filterPredicate = (key: string) =>
        breakdownFieldId === undefined || breakdownKind === undefined || (limitActive && key === "other")
            ? undefined
            : breakdownKeyPredicate(breakdownKind, breakdownFieldId, key);

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
    // Each item is swatch (14×3 bar) · label (600) · value% (ink-4) · eye, with a
    // 6px inner gap. No chip chrome. "Others" is the one dashed-pill exception.
    return (
        <Box css={styles.legendRail}>
            {shown.map((g) => {
                const on = visibleSet.has(g.key);
                const pred = filterPredicate(g.key);
                const applied = pred !== undefined && state.filters.some(f => predicateEqual(f, pred));
                return (
                    <Box key={g.key} css={styles.legendGroup}>
                        <chakra.button type="button" onClick={() => toggle(g.key)} css={styles.legendItem} opacity={on ? 1 : 0.5}>
                            <Box as="span" css={styles.legendSwatch} background={g.color} opacity={on ? 1 : 0.45} />
                            <Box as="span" css={styles.legendLabel}>{g.key}</Box>
                            <Box as="span" css={styles.legendValue}>{pct(Number(g.count))}</Box>
                            <Box as="span" color={on ? "{colors.brand.600}" : "fg.muted"} fontSize="9px">
                                <FontAwesomeIcon icon={on ? faEye : faEyeSlash} />
                            </Box>
                        </chakra.button>
                        {pred !== undefined && (
                            <chakra.button
                                type="button"
                                css={styles.filterTo}
                                onClick={() => slice.toggleFilter(pred)}
                                aria-label={`Filter to ${g.key}`}
                                aria-pressed={applied}
                                color={applied ? "{colors.brand.600}" : undefined}
                            >
                                <FontAwesomeIcon icon={faFilter} />
                            </chakra.button>
                        )}
                    </Box>
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
