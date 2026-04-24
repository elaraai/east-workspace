/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, HStack, Text as ChakraText } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconName, IconPrefix } from "@fortawesome/fontawesome-svg-core";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { MetricChip } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const metricChipEqual = equalFor(MetricChip.Types.MetricChip);

/** East MetricChip value type. */
export type MetricChipValue = ValueTypeOf<typeof MetricChip.Types.MetricChip>;

/**
 * Default palette derived from tone (Chakra semantic colour tokens).
 *
 * @remarks
 * Renderer layers explicit colour-slot overrides on top of these
 * defaults. Emphasis selects between subtle (tinted bg), solid
 * (high-contrast fill), and outline (border-only).
 */
const TONE_PALETTE: Record<string, { bg: string; fg: string; border: string; solidBg: string; solidFg: string }> = {
    positive: { bg: "green.50", fg: "green.700", border: "green.200", solidBg: "green.500", solidFg: "white" },
    negative: { bg: "red.50", fg: "red.700", border: "red.200", solidBg: "red.500", solidFg: "white" },
    neutral: { bg: "gray.100", fg: "gray.700", border: "gray.200", solidBg: "gray.500", solidFg: "white" },
    info: { bg: "blue.50", fg: "blue.700", border: "blue.200", solidBg: "blue.500", solidFg: "white" },
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

/** Renders an East UI MetricChip value using pure Chakra v3 primitives. */
export const EastChakraMetricChip = memo(function EastChakraMetricChip({ value, storageKey }: EastChakraMetricChipProps) {
    const tone = value.tone.type;
    const unit = useMemo(() => getSomeorUndefined(value.unit), [value.unit]);
    const icon = useMemo(() => getSomeorUndefined(value.icon), [value.icon]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const emphasis = style ? getSomeorUndefined(style.emphasis)?.type ?? "subtle" : "subtle";
    const sizeTag = style ? getSomeorUndefined(style.size)?.type ?? "sm" : "sm";
    const sizeProps = SIZE_PADDING[sizeTag] ?? SIZE_PADDING["sm"]!;

    const palette = TONE_PALETTE[tone] ?? TONE_PALETTE["neutral"]!;

    const color = (style && getSomeorUndefined(style.color))
        ?? (emphasis === "solid" ? palette.solidFg : palette.fg);
    const background = (style && getSomeorUndefined(style.background))
        ?? (emphasis === "solid" ? palette.solidBg : emphasis === "outline" ? "transparent" : palette.bg);
    const borderColor = (style && getSomeorUndefined(style.borderColor))
        ?? (emphasis === "outline" ? palette.border : undefined);
    const iconColor = (style && getSomeorUndefined(style.iconColor)) ?? color;

    return (
        <Box
            display="inline-flex"
            alignItems="center"
            borderRadius="md"
            borderWidth={emphasis === "outline" ? "1px" : "0"}
            borderStyle="solid"
            borderColor={borderColor}
            bg={background}
            color={color}
            px={sizeProps.px}
            py={sizeProps.py}
            fontSize={sizeProps.fontSize}
            fontWeight="medium"
        >
            <HStack gap="1" align="center">
                {icon && (
                    <Box color={iconColor}>
                        <FontAwesomeIcon icon={[icon.prefix as IconPrefix, icon.name as IconName]} aria-hidden />
                    </Box>
                )}
                <EastChakraComponent value={value.value} storageKey={`${storageKey}.value`} />
                {unit && <ChakraText as="span" color={color} opacity={0.75}>{unit}</ChakraText>}
            </HStack>
        </Box>
    );
}, (prev, next) => metricChipEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
