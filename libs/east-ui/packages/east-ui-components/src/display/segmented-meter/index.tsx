/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, Flex, HStack, Text as ChakraText } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { SegmentedMeter } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const segmentedMeterEqual = equalFor(SegmentedMeter.Types.SegmentedMeter);

/** East SegmentedMeter value type. */
export type SegmentedMeterValue = ValueTypeOf<typeof SegmentedMeter.Types.SegmentedMeter>;

const THICKNESS_PX: Record<string, string> = {
    xs: "4px",
    sm: "6px",
    md: "10px",
    lg: "14px",
};

const TONE_FILL: Record<string, string> = {
    success: "green.500",
    warning: "orange.500",
    danger: "red.500",
    info: "blue.500",
    neutral: "gray.400",
};

export interface EastChakraSegmentedMeterProps {
    value: SegmentedMeterValue;
    storageKey: string;
}

/**
 * Renders an East UI SegmentedMeter using `<Flex>` — each segment is a
 * `<Box>` at `flex={seg.value}`, coloured by per-segment `color` or
 * the tone-default palette.
 *
 * @remarks
 * Labels render in one of three modes: `inside` (truncated text inside
 * the segment when it fits), `outside` (chips below the bar in a
 * horizontal row matching segment widths), or `none` (labels hidden).
 * When `max > sum(segments.value)`, remaining track space is rendered
 * as an explicit `trackColor` Box filling the residual flex.
 */
export const EastChakraSegmentedMeter = memo(function EastChakraSegmentedMeter({ value, storageKey }: EastChakraSegmentedMeterProps) {
    const caption = useMemo(() => getSomeorUndefined(value.caption), [value.caption]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const thicknessTag = style ? getSomeorUndefined(style.thickness)?.type ?? "sm" : "sm";
    const height = THICKNESS_PX[thicknessTag] ?? "6px";
    const labelsPos = style ? getSomeorUndefined(style.labels)?.type ?? "none" : "none";
    const trackColor = (style && getSomeorUndefined(style.trackColor)) ?? "gray.100";
    const captionColor = style ? getSomeorUndefined(style.captionColor) : undefined;
    const labelColor = (style && getSomeorUndefined(style.labelColor)) ?? "white";

    const segments = value.segments;
    const total = segments.reduce((sum: number, s: typeof segments[number]) => sum + Number(s.value), 0);
    const maxOpt = getSomeorUndefined(value.max);
    const max = maxOpt !== undefined ? Math.max(Number(maxOpt), total) : total;
    const residual = max - total;

    const bar = (
        <Flex width="full" height={height} borderRadius="full" overflow="hidden">
            {segments.map((seg: typeof segments[number], i: number) => {
                const toneTag = getSomeorUndefined(seg.tone)?.type;
                const color = getSomeorUndefined(seg.color)
                    ?? (toneTag ? TONE_FILL[toneTag] : "blue.500");
                const segLabel = getSomeorUndefined(seg.label);
                return (
                    <Box
                        key={i}
                        flex={Number(seg.value)}
                        bg={color}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        overflow="hidden"
                    >
                        {labelsPos === "inside" && segLabel && (
                            <ChakraText fontSize="xs" color={labelColor} truncate>{segLabel}</ChakraText>
                        )}
                    </Box>
                );
            })}
            {residual > 0 && <Box flex={residual} bg={trackColor} />}
        </Flex>
    );

    const outsideLabels = labelsPos === "outside" ? (
        <Flex width="full" mt="1">
            {segments.map((seg: typeof segments[number], i: number) => {
                const segLabel = getSomeorUndefined(seg.label);
                return (
                    <Box key={i} flex={Number(seg.value)} textAlign="center">
                        {segLabel && <ChakraText fontSize="xs" color="fg.muted" truncate>{segLabel}</ChakraText>}
                    </Box>
                );
            })}
            {residual > 0 && <Box flex={residual} />}
        </Flex>
    ) : null;

    if (!caption) {
        return (
            <Box width="full">
                {bar}
                {outsideLabels}
            </Box>
        );
    }

    return (
        <Box width="full">
            <HStack gap="3" align="center" mb="1">
                <Box color={captionColor} flexShrink={0}>
                    <EastChakraComponent value={caption} storageKey={`${storageKey}.caption`} />
                </Box>
                <Box flex="1">{bar}</Box>
            </HStack>
            {outsideLabels}
        </Box>
    );
}, (prev, next) => segmentedMeterEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
