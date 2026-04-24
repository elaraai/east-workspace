/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, HStack, VStack, Text as ChakraText } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { BarStrip } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const barStripEqual = equalFor(BarStrip.Types.BarStrip);

/** East BarStrip value type. */
export type BarStripValue = ValueTypeOf<typeof BarStrip.Types.BarStrip>;

const THICKNESS_PX: Record<string, string> = {
    xs: "4px",
    sm: "6px",
    md: "10px",
};

const TONE_FILL: Record<string, string> = {
    success: "green.500",
    warning: "orange.500",
    danger: "red.500",
    info: "blue.500",
    neutral: "gray.400",
};

export interface EastChakraBarStripProps {
    value: BarStripValue;
    storageKey: string;
}

/**
 * Renders an East UI BarStrip as a vertical stack of rows. Each row is
 * a horizontal layout of `label | track+fill | value / trailing`.
 *
 * @remarks
 * Bars are sized proportionally to the max value across visible rows.
 * Sort direction is applied at render time (since the IR preserves
 * input order when no sort is set). `maxItems` clips the visible list.
 */
export const EastChakraBarStrip = memo(function EastChakraBarStrip({ value, storageKey }: EastChakraBarStripProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const showValues = useMemo(() => getSomeorUndefined(value.showValues) ?? true, [value.showValues]);
    const sortTag = useMemo(() => getSomeorUndefined(value.sort)?.type ?? "none", [value.sort]);
    const maxItems = useMemo(() => getSomeorUndefined(value.maxItems), [value.maxItems]);

    const thicknessTag = style ? getSomeorUndefined(style.thickness)?.type ?? "sm" : "sm";
    const height = THICKNESS_PX[thicknessTag] ?? "6px";
    const trackColor = (style && getSomeorUndefined(style.trackColor)) ?? "gray.100";
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;
    const valueColor = style ? getSomeorUndefined(style.valueColor) : undefined;

    const items = useMemo(() => {
        let arr = [...value.items] as typeof value.items;
        if (sortTag === "asc") arr.sort((a, b) => Number(a.value) - Number(b.value));
        else if (sortTag === "desc") arr.sort((a, b) => Number(b.value) - Number(a.value));
        if (maxItems !== undefined) arr = arr.slice(0, Number(maxItems));
        return arr;
    }, [value.items, sortTag, maxItems]);

    const peakValue = useMemo(() => {
        let m = 0;
        for (const it of items) {
            const v = Number(it.value);
            if (v > m) m = v;
        }
        return m === 0 ? 1 : m;
    }, [items]);

    return (
        <VStack gap="2" align="stretch" width="full">
            {items.map((item: typeof items[number], i: number) => {
                const toneTag = getSomeorUndefined(item.tone)?.type;
                const fillColor = getSomeorUndefined(item.color)
                    ?? (toneTag ? TONE_FILL[toneTag] : "blue.500");
                const trailing = getSomeorUndefined(item.trailing);
                const percent = `${((Number(item.value) / peakValue) * 100).toFixed(2)}%`;

                return (
                    <HStack key={i} gap="3" align="center" width="full">
                        <Box color={labelColor} minWidth="6rem" flexShrink={0}>
                            <EastChakraComponent value={item.label} storageKey={`${storageKey}.${i}.label`} />
                        </Box>
                        <Box flex="1" position="relative" height={height} bg={trackColor} borderRadius="full" overflow="hidden">
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
                        {showValues && (
                            <ChakraText color={valueColor ?? "fg.muted"} minWidth="3rem" textAlign="right" fontSize="sm">
                                {Number(item.value).toLocaleString()}
                            </ChakraText>
                        )}
                        {trailing && (
                            <Box flexShrink={0}>
                                <EastChakraComponent value={trailing} storageKey={`${storageKey}.${i}.trailing`} />
                            </Box>
                        )}
                    </HStack>
                );
            })}
        </VStack>
    );
}, (prev, next) => barStripEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
