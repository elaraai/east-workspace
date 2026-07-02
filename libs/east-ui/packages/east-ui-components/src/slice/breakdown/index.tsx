/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useState } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faFilter } from "@fortawesome/free-solid-svg-icons";
import { type ValueTypeOf, some, none } from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { SLICE_SERIES_PALETTE } from "../palette";
import { SliceEditPopover } from "../edit";
import { useSliceDensity } from "../density";
import { nextFieldFilters, selectedFieldKeys } from "../key-predicate";
import { useSliceReactivity } from "../use-slice-reactivity";

/** East Slice.Breakdown value type. */
export type SliceBreakdownValue = ValueTypeOf<typeof Slice.Breakdown.Types.Breakdown>;

export interface EastChakraSliceBreakdownProps {
    value: SliceBreakdownValue;
}

const DEFAULT_LIMIT = 5;
/** Top-N cut options offered by the roll-up `<select>`; "all" clears the limit. */
const LIMIT_OPTIONS = ["5", "10", "25", "all"] as const;

/**
 * Renders an East UI `Slice.Breakdown` — dimension chips (active one
 * brand-tinted with `×`) over a resulting-series preview, with a roll-up
 * footer whose `<select>` sets the top-N cut. Selecting a dimension writes
 * `state.breakdown`; the `×` clears it. Dimensions + groups come from the bound
 * slice; swatch colours are assigned by position.
 */
export const EastChakraSliceBreakdown = memo(function EastChakraSliceBreakdown({ value }: EastChakraSliceBreakdownProps) {
    const styles = useSlotRecipe({ key: "sliceFrame" })();
    const chip = useRecipe({ key: "chip" });
    const btn = useRecipe({ key: "button" });
    const selectCss = useRecipe({ key: "input" })({ size: "sm" });
    const { slice } = value;
    useSliceReactivity(slice.key);
    const density = useSliceDensity(getSomeorUndefined(value.density)?.type as ("compact" | "focused" | undefined));
    // `editor` renders the flat compact form; its edit surfaces inline via the editor-density disclosure.
    const compact = density !== "focused";
    const dimensions = slice.dimensions();
    const groups = slice.groups();

    const state = slice.read();
    const breakdown = getSomeorUndefined(state.breakdown);
    const active = breakdown?.fieldId;
    const limit = breakdown !== undefined ? getSomeorUndefined(breakdown.limit) : undefined;

    // Facet gesture on the resulting-series chips (#165/#188): clicking a chip
    // toggles it in the field's `in`-set selection (same semantics as the
    // filter-mode Legend). Inert for the `other` roll-up bucket and kinds with
    // no expressible equality.
    const activeKind = active !== undefined ? slice.fields().find(f => f.fieldId === active)?.kind : undefined;
    const chipSelected = active !== undefined && activeKind !== undefined
        ? selectedFieldKeys(state.filters, activeKind, active)
        : new Set<string>();
    const chipSelectable = (key: string) =>
        active !== undefined && activeKind !== undefined
        && !(limit !== undefined && key === "other")
        && nextFieldFilters([], activeKind, active, key) !== undefined;
    const chipClick = (key: string) => {
        if (active === undefined || activeKind === undefined) return;
        // Live read-modify-write: rapid clicks must compose, not overwrite.
        const live = slice.read();
        const next = nextFieldFilters(live.filters, activeKind, active, key);
        if (next !== undefined) slice.write({ ...live, filters: next });
    };

    const [pickOpen, setPickOpen] = useState(false);
    const setBreakdown = (fieldId: string) => slice.setBreakdown(some({ fieldId, limit: none }));
    const clearBreakdown = () => slice.setBreakdown(none);

    // Compact (chart-frame eyebrow): "SPLIT BY" + the ACTIVE dimension chip (if
    // any) + a dashed `+ dimension` picker. The full dimensions / resulting-series
    // / roll-up surface is the focused (configure) density, not the eyebrow.
    if (compact) {
        const activeDim = dimensions.find(d => d.fieldId === active);
        const inactive = dimensions.filter(d => d.fieldId !== active);
        return (
            <Box display="flex" gap="{spacing.2}" alignItems="center" flexWrap="nowrap" flexShrink="0">
                {activeDim !== undefined && (
                    <Box css={chip({ tone: "brand", numeric: true, shape: "pill" })}>
                        <Box as="span">{activeDim.label}</Box>
                        <chakra.button type="button" cursor="pointer" color="{colors.brand.600}" onClick={clearBreakdown} aria-label="Clear breakdown">×</chakra.button>
                    </Box>
                )}
                {inactive.length > 0 && (
                    <SliceEditPopover
                        open={pickOpen}
                        onOpenChange={setPickOpen}
                        label="Split by"
                        footActions={<chakra.button type="button" css={btn({ variant: "outline", size: "xs" })} onClick={() => setPickOpen(false)}>Done</chakra.button>}
                        trigger={
                            <Box css={chip({ tone: "dashed", numeric: true, shape: "pill" })} cursor="pointer">
                                <FontAwesomeIcon icon={faPlus} style={{ fontSize: "9px" }} />
                                <Box as="span">dimension</Box>
                            </Box>
                        }
                    >
                        {pickOpen && (
                            <Box display="flex" flexDirection="column" gap="{spacing.1}">
                                {inactive.map(d => (
                                    <chakra.button key={d.fieldId} type="button" css={styles.footerAction} textAlign="left" onClick={() => { setBreakdown(d.fieldId); setPickOpen(false); }}>
                                        {d.label}
                                    </chakra.button>
                                ))}
                            </Box>
                        )}
                    </SliceEditPopover>
                )}
            </Box>
        );
    }
    const setLimit = (v: string) => {
        if (active === undefined) return;
        slice.setBreakdown(some({ fieldId: active, limit: v === "all" ? none : some(BigInt(v)) }));
    };

    const topN = limit !== undefined ? Number(limit) : DEFAULT_LIMIT;
    const shown = groups.slice(0, topN);
    const moreCount = Math.max(0, groups.length - topN);
    const moreTotal = groups.slice(topN).reduce((sum, g) => sum + Number(g.count), 0);

    return (
        <Box css={styles.root}>
            <Box css={styles.body}>
                <Box as="span" css={styles.footerLabel}>DIMENSIONS</Box>
                <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
                    {dimensions.map(d => {
                        const on = d.fieldId === active;
                        return (
                            <Box key={d.fieldId} css={chip({ tone: on ? "brand" : "neutral" })}>
                                <chakra.button type="button" cursor="pointer" onClick={() => (on ? clearBreakdown() : setBreakdown(d.fieldId))}>
                                    {d.label}
                                </chakra.button>
                                {on && (
                                    <chakra.button type="button" cursor="pointer" color="{colors.brand.600}" onClick={clearBreakdown} aria-label="Clear breakdown">×</chakra.button>
                                )}
                            </Box>
                        );
                    })}
                </Box>
                {groups.length > 0 && (
                    <Box display="flex" flexDirection="column" gap="{spacing.2}" mt="{spacing.1}">
                        <Box as="span" css={styles.footerLabel}>
                            {`RESULTING SERIES · TOP ${Math.min(topN, groups.length)} OF ${groups.length}`}
                        </Box>
                        <Box display="flex" gap="{spacing.2}" flexWrap="wrap" alignItems="center">
                            {shown.map((g, i) => {
                                // The WHOLE chip is the facet gesture when
                                // expressible (#188 — in-set membership toggle);
                                // the funnel renders only as the applied
                                // indicator. Roll-up/float chips stay plain.
                                const selectable = chipSelectable(g.key);
                                const applied = chipSelected.has(g.key);
                                const chipBody = (
                                    <>
                                        <Box as="span" width="8px" height="8px" borderRadius="full" background={SLICE_SERIES_PALETTE[i % SLICE_SERIES_PALETTE.length]} />
                                        <Box as="span" fontWeight="semibold" color={applied ? "{colors.brand.700}" : "fg"}>{g.key}</Box>
                                        <Box as="span" fontFamily="mono" fontVariantNumeric="tabular-nums" color="fg.muted">{Number(g.count).toLocaleString()}</Box>
                                        {applied && (
                                            <Box as="span" color="{colors.brand.600}" fontSize="9px">
                                                <FontAwesomeIcon icon={faFilter} />
                                            </Box>
                                        )}
                                    </>
                                );
                                const chipChrome = {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "{spacing.2}",
                                    borderRadius: "{radii.sm}",
                                    borderWidth: "1px",
                                    borderColor: applied ? "{colors.brand.600}" : "border.subtle",
                                    background: "bg.surface",
                                    paddingX: "10px",
                                    paddingY: "6px",
                                    fontFamily: "body",
                                    fontSize: "{fontSizes.xs}",
                                    lineHeight: "1",
                                } as const;
                                return selectable ? (
                                    <chakra.button
                                        key={g.key}
                                        type="button"
                                        {...chipChrome}
                                        cursor="pointer"
                                        onClick={() => chipClick(g.key)}
                                        aria-label={`Filter to ${g.key}`}
                                        aria-pressed={applied}
                                    >
                                        {chipBody}
                                    </chakra.button>
                                ) : (
                                    <Box key={g.key} {...chipChrome}>
                                        {chipBody}
                                    </Box>
                                );
                            })}
                            {moreCount > 0 && (
                                <Box
                                    as="span"
                                    borderRadius="{radii.sm}"
                                    borderWidth="1px"
                                    borderStyle="dashed"
                                    borderColor="border.strong"
                                    color="fg.muted"
                                    paddingX="10px"
                                    paddingY="6px"
                                    fontSize="{fontSizes.xs}"
                                    lineHeight="1"
                                >
                                    {`+${moreCount} more · ${moreTotal.toLocaleString()}`}
                                </Box>
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
            {active !== undefined && (
                <Box css={styles.footer}>
                    <Box display="inline-flex" alignItems="center" gap="{spacing.2}">
                        <Box as="span" css={styles.footerLabel}>ROLL-UP</Box>
                        <chakra.select
                            css={{ ...selectCss, cursor: "pointer" }}
                            value={limit !== undefined ? limit.toString() : "all"}
                            onChange={e => setLimit(e.target.value)}
                            aria-label="Roll-up limit"
                        >
                            {LIMIT_OPTIONS.map(o => <option key={o} value={o}>{o === "all" ? "all series" : `top ${o}`}</option>)}
                        </chakra.select>
                    </Box>
                    <Box as="span" color="fg.muted" fontFamily="body" fontSize="12px" lineHeight="1">
                        {limit !== undefined ? `group rest into “other”` : `showing all series`}
                    </Box>
                </Box>
            )}
        </Box>
    );
}, () => false);
