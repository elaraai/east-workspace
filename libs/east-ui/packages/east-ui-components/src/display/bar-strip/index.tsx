/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { BarStrip } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const barStripEqual = equalFor(BarStrip.Types.BarStrip);

/** East BarStrip value type. */
export type BarStripValue = ValueTypeOf<typeof BarStrip.Types.BarStrip>;

const TONE_FILL: Record<string, string> = {
    success: "fg.success",
    warning: "fg.warning",
    danger:  "fg.danger",
    info:    "fg.info",
    neutral: "fg.muted",
};

export interface EastChakraBarStripProps {
    value: BarStripValue;
    storageKey: string;
}

/**
 * Renders an East UI BarStrip from the `barStrip` slot recipe — a ranked
 * horizontal bar list (label · 6px paper-3 track / radius-full brand-d fill ·
 * mono tabular value). The renderer supplies the dynamic fill width + per-item
 * colour/trailing.
 */
export const EastChakraBarStrip = memo(function EastChakraBarStrip({ value, storageKey }: EastChakraBarStripProps) {
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);
    const showValues = useMemo(() => getSomeorUndefined(value.showValues) ?? true, [value.showValues]);
    const sortTag = useMemo(() => getSomeorUndefined(value.sort)?.type ?? "none", [value.sort]);
    const maxItems = useMemo(() => getSomeorUndefined(value.maxItems), [value.maxItems]);

    const thickness = style ? getSomeorUndefined(style.thickness)?.type : undefined;
    const trackColor = style ? getSomeorUndefined(style.trackColor) : undefined;
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;
    const valueColor = style ? getSomeorUndefined(style.valueColor) : undefined;
    const borderRadius = style ? getSomeorUndefined(style.borderRadius) : undefined;

    const styles = useSlotRecipe({ key: "barStrip" })({ thickness });

    const items = useMemo(() => {
        let arr = [...value.items] as typeof value.items;
        if (sortTag === "asc") arr.sort((a, b) => Number(a.value) - Number(b.value));
        else if (sortTag === "desc") arr.sort((a, b) => Number(b.value) - Number(a.value));
        if (maxItems !== undefined) arr = arr.slice(0, Number(maxItems));
        return arr;
    }, [value, sortTag, maxItems]);

    const peakValue = useMemo(() => {
        let m = 0;
        for (const it of items) {
            const v = Number(it.value);
            if (v > m) m = v;
        }
        return m === 0 ? 1 : m;
    }, [items]);

    return (
        <Box css={styles.root}>
            {items.map((item: typeof items[number], i: number) => {
                const toneTag = getSomeorUndefined(item.tone)?.type;
                const fillColor = getSomeorUndefined(item.color)
                    ?? (toneTag ? TONE_FILL[toneTag] : undefined);
                const trailing = getSomeorUndefined(item.trailing);
                const percent = `${((Number(item.value) / peakValue) * 100).toFixed(2)}%`;

                return (
                    <Box key={i} css={styles.row}>
                        <Box css={styles.label} color={labelColor}>
                            <EastChakraComponent value={item.label} storageKey={`${storageKey}.${i}.label`} />
                        </Box>
                        <Box css={styles.track} bg={trackColor} borderRadius={borderRadius}>
                            <Box css={styles.fill} width={percent} bg={fillColor} borderRadius={borderRadius} />
                        </Box>
                        {showValues && (
                            <Box as="span" css={styles.value} color={valueColor}>
                                {Number(item.value).toLocaleString()}
                            </Box>
                        )}
                        {trailing && (
                            <Box css={styles.trailing}>
                                <EastChakraComponent value={trailing} storageKey={`${storageKey}.${i}.trailing`} />
                            </Box>
                        )}
                    </Box>
                );
            })}
        </Box>
    );
}, (prev, next) => barStripEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
