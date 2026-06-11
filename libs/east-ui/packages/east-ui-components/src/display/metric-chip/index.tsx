/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, HStack, Text as ChakraText, useSlotRecipe } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { MetricChip } from "@elaraai/east-ui/internal";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";
import { useDensity } from "../../contracts/density";

const metricChipEqual = equalFor(MetricChip.Types.MetricChip);

/** East MetricChip value type. */
export type MetricChipValue = ValueTypeOf<typeof MetricChip.Types.MetricChip>;

/**
 * Default palette derived from tone — uses the muted spec status hues
 * (`fg.success / fg.danger / fg.muted / fg.info`) routed through the
 * `*.subtle` semantic tokens so the visual reads as a soft tinted chip
 * per pattern_spec/spec.css `.delta` / `.deltapill.*`.
 */
const TONE_PALETTE: Record<string, { bg: string; fg: string; border: string; solidBg: string; solidFg: string }> = {
    positive: { bg: "success.subtle", fg: "fg.success", border: "fg.success", solidBg: "fg.success", solidFg: "white" },
    negative: { bg: "danger.subtle",  fg: "fg.danger",  border: "fg.danger",  solidBg: "fg.danger",  solidFg: "white" },
    neutral:  { bg: "bg.subtle",      fg: "fg.muted",   border: "border.strong", solidBg: "fg.muted", solidFg: "white" },
    info:     { bg: "info.subtle",    fg: "fg.info",    border: "fg.info",    solidBg: "fg.info",    solidFg: "white" },
};

const SIZE_PADDING: Record<string, { px: string; py: string; fontSize: string }> = {
    xs: { px: "1.5", py: "0", fontSize: "xs" },
    sm: { px: "2", py: "0.5", fontSize: "sm" },
    md: { px: "2.5", py: "1", fontSize: "sm" },
    lg: { px: "3", py: "1.5", fontSize: "md" },
    xl: { px: "3.5", py: "2", fontSize: "md" },
};

export interface EastChakraMetricChipProps {
    value: MetricChipValue;
    storageKey: string;
}

/* Map the IR tone tag onto the metricChip slot recipe sentiment variant. */
const TONE_TO_SENTIMENT: Record<string, "up" | "down" | "flat" | "brand"> = {
    positive: "up",
    negative: "down",
    neutral:  "flat",
    info:     "brand",
};

/** Renders an East UI MetricChip value, consuming the `metricChip` slot
 * recipe upstream so its sentiment chrome flows from
 * `theme/slot-recipes/metricChip.ts`. */
export const EastChakraMetricChip = memo(function EastChakraMetricChip({ value, storageKey }: EastChakraMetricChipProps) {
    const recipe = useSlotRecipe({ key: "metricChip" });

    const tone = value.tone.type;
    const sentiment = TONE_TO_SENTIMENT[tone] ?? "flat";
    const inheritedDensity = useDensity();
    const localDensity = useMemo(() => getSomeorUndefined(value.density)?.type, [value.density]);
    const density = localDensity ?? inheritedDensity;
    const styles = recipe({ sentiment, density });

    const unit = useMemo(() => getSomeorUndefined(value.unit), [value.unit]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const emphasis = style ? getSomeorUndefined(style.emphasis)?.type ?? "subtle" : "subtle";
    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "sm" : "sm";
    const sizeProps = SIZE_PADDING[sizeTag] ?? SIZE_PADDING["sm"]!;

    const palette = TONE_PALETTE[tone] ?? TONE_PALETTE["neutral"]!;

    /* Allow caller-side colour-slot overrides on top of the recipe defaults.
     * For solid emphasis we flip the foreground to the high-contrast `solidFg`
     * (white over the saturated background) — without this, the text inherits
     * the tone's recipe colour (e.g. `fg.danger`) and reads as red-on-red. */
    const colorOverride = (style && getSomeorUndefined(style.color))
        ?? (emphasis === "solid" ? palette.solidFg : undefined);
    const backgroundOverride = (style && getSomeorUndefined(style.background))
        ?? (emphasis === "solid" ? palette.solidBg : emphasis === "outline" ? "transparent" : undefined);
    const borderColorOverride = (style && getSomeorUndefined(style.borderColor))
        ?? (emphasis === "outline" ? palette.border : undefined);
    const iconColor = (style && getSomeorUndefined(style.iconColor)) ?? colorOverride ?? palette.fg;

    return (
        <Box
            css={styles.root}
            px={sizeProps.px}
            py={sizeProps.py}
            fontSize={sizeProps.fontSize}
            {...(colorOverride !== undefined ? { color: colorOverride } : {})}
            {...(backgroundOverride !== undefined ? { bg: backgroundOverride } : {})}
            {...(borderColorOverride !== undefined ? { borderColor: borderColorOverride } : {})}
            {...(emphasis === "solid" ? { borderColor: "transparent" } : {})}
        >
            <HStack gap="1" align="center">
                {icon && (
                    <Box color={iconColor}>
                        <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} aria-hidden />
                    </Box>
                )}
                <Box css={styles.value}>
                    <EastChakraComponent value={value.value} storageKey={`${storageKey}.value`} />
                </Box>
                {unit && <ChakraText as="span" opacity={0.75}>{unit}</ChakraText>}
            </HStack>
        </Box>
    );
}, (prev, next) => metricChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
