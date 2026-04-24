/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, HStack } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Meter } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const meterEqual = equalFor(Meter.Types.Meter);

/** East Meter value type. */
export type MeterValue = ValueTypeOf<typeof Meter.Types.Meter>;

const THICKNESS_PX: Record<string, string> = {
    xs: "2px",
    sm: "4px",
    md: "6px",
    lg: "8px",
};

const TONE_FILL: Record<string, string> = {
    success: "green.500",
    warning: "orange.500",
    danger: "red.500",
    info: "blue.500",
    neutral: "gray.400",
};

export interface EastChakraMeterProps {
    value: MeterValue;
    storageKey: string;
}

/**
 * Renders an East UI Meter using pure Chakra v3 `Box` composition.
 *
 * @remarks
 * Track = outer `Box` at full width with the thickness height. Fill =
 * inner `Box` with `width = (value / max) * 100%`. Tone drives the
 * default fill palette; `style.fillColor` / `style.trackColor` override.
 */
export const EastChakraMeter = memo(function EastChakraMeter({ value, storageKey }: EastChakraMeterProps) {
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const max = useMemo(() => getSomeorUndefined(value.max) ?? 100, [value.max]);
    const tone = useMemo(() => getSomeorUndefined(value.tone)?.type, [value.tone]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const thicknessTag = style ? getSomeorUndefined(style.thickness)?.type ?? "sm" : "sm";
    const height = THICKNESS_PX[thicknessTag] ?? "4px";
    const fillColor = (style && getSomeorUndefined(style.fillColor))
        ?? (tone ? TONE_FILL[tone] : "blue.500");
    const trackColor = (style && getSomeorUndefined(style.trackColor)) ?? "gray.100";
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;

    const clamped = Math.max(0, Math.min(Number(value.value) / Number(max), 1));
    const percent = `${(clamped * 100).toFixed(2)}%`;

    const track = (
        <Box
            position="relative"
            width="full"
            height={height}
            bg={trackColor}
            borderRadius="full"
            overflow="hidden"
        >
            <Box
                position="absolute"
                top="0"
                left="0"
                bottom="0"
                width={percent}
                bg={fillColor}
                borderRadius="full"
            />
        </Box>
    );

    if (!label) {
        return track;
    }

    return (
        <HStack gap="3" align="center" width="full">
            <Box color={labelColor} flexShrink={0}>
                <EastChakraComponent value={label} storageKey={`${storageKey}.label`} />
            </Box>
            <Box flex="1">{track}</Box>
        </HStack>
    );
}, (prev, next) => meterEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
