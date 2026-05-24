/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo } from "react";
import { Box, useSlotRecipe } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Meter } from "@elaraai/east-ui";
import { EastChakraComponent } from "../../component";
import { getSomeorUndefined } from "../../utils";

const meterEqual = equalFor(Meter.Types.Meter);

/** East Meter value type. */
export type MeterValue = ValueTypeOf<typeof Meter.Types.Meter>;

export interface EastChakraMeterProps {
    value: MeterValue;
    storageKey: string;
}

/**
 * Renders an East UI Meter from the `meter` slot recipe — spec progress
 * grammar (6px paper-3 track, radius-full, brand-d fill, mono percent). The
 * renderer supplies only the dynamic fill width + escape-hatch overrides.
 */
export const EastChakraMeter = memo(function EastChakraMeter({ value, storageKey }: EastChakraMeterProps) {
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const max = useMemo(() => getSomeorUndefined(value.max) ?? 100, [value.max]);
    const tone = useMemo(() => getSomeorUndefined(value.tone)?.type, [value.tone]);
    const style = useMemo(() => getSomeorUndefined(value.style), [value.style]);

    const thickness = style ? getSomeorUndefined(style.thickness)?.type : undefined;
    const fillColor = style ? getSomeorUndefined(style.fillColor) : undefined;
    const trackColor = style ? getSomeorUndefined(style.trackColor) : undefined;
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;
    const borderRadius = style ? getSomeorUndefined(style.borderRadius) : undefined;
    const showValue = (style ? getSomeorUndefined(style.showValue) : undefined) ?? true;

    const styles = useSlotRecipe({ key: "meter" })({ thickness, tone });

    const clamped = Math.max(0, Math.min(Number(value.value) / Number(max), 1));
    const percent = `${(clamped * 100).toFixed(2)}%`;
    const percentLabel = `${Math.round(clamped * 100)}%`;

    return (
        <Box css={styles.root}>
            {label && (
                <Box css={styles.label} color={labelColor}>
                    <EastChakraComponent value={label} storageKey={`${storageKey}.label`} />
                </Box>
            )}
            <Box css={styles.track} bg={trackColor} borderRadius={borderRadius}>
                <Box css={styles.fill} width={percent} bg={fillColor} borderRadius={borderRadius} />
            </Box>
            {showValue && <Box as="span" css={styles.value}>{percentLabel}</Box>}
        </Box>
    );
}, (prev, next) => meterEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
