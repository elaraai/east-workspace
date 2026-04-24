/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useEffect, useState } from "react";
import {
    ProgressCircle as ChakraProgressCircle,
    type ProgressCircleRootProps,
    Box as ChakraBox,
} from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { ProgressCircle } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const progressCircleEqual = equalFor(ProgressCircle.Types.ProgressCircle);

export type ProgressCircleValue = ValueTypeOf<typeof ProgressCircle.Types.ProgressCircle>;

export function toChakraProgressCircle(value: ProgressCircleValue): ProgressCircleRootProps {
    const style = getSomeorUndefined(value.style);
    const indeterminate = getSomeorUndefined(value.indeterminate) ?? false;
    return {
        value: indeterminate ? null : value.value,
        min: getSomeorUndefined(value.min),
        max: getSomeorUndefined(value.max),
        colorPalette: style ? getSomeorUndefined(style.colorPalette)?.type : undefined,
        size: style ? (getSomeorUndefined(style.size)?.type as ProgressCircleRootProps["size"]) : undefined,
    };
}

export interface EastChakraProgressCircleProps {
    value: ProgressCircleValue;
}

function formatEta(startedAt: Date | undefined, estimatedDurationSec: bigint | undefined, now: number): string | undefined {
    if (!startedAt || estimatedDurationSec === undefined) return undefined;
    const elapsedMs = now - startedAt.getTime();
    const totalMs = Number(estimatedDurationSec) * 1000;
    const remainingMs = totalMs - elapsedMs;
    if (remainingMs <= 0) return undefined;
    const s = Math.max(0, Math.round(remainingMs / 1000));
    if (s < 60) return `~${s}s`;
    const m = Math.floor(s / 60);
    return `~${m}m`;
}

/**
 * Renders an East UI ProgressCircle using Chakra v3's Progress.Circle compound.
 */
export const EastChakraProgressCircle = memo(function EastChakraProgressCircle({ value }: EastChakraProgressCircleProps) {
    const props = useMemo(() => toChakraProgressCircle(value), [value]);
    const showValueText = getSomeorUndefined(value.showValueText) ?? false;
    const startedAt = getSomeorUndefined(value.startedAt);
    const estimatedDuration = getSomeorUndefined(value.estimatedDuration);

    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!startedAt || estimatedDuration === undefined) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [startedAt, estimatedDuration]);

    const style = getSomeorUndefined(value.style);
    const thickness = style ? getSomeorUndefined(style.thickness) : undefined;
    const trackColor = style ? getSomeorUndefined(style.trackColor) : undefined;
    const fillColor = style ? getSomeorUndefined(style.fillColor) : undefined;
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;

    const etaText = useMemo(
        () => formatEta(startedAt, estimatedDuration, now),
        [startedAt, estimatedDuration, now],
    );
    const computedValueText = showValueText && !getSomeorUndefined(value.indeterminate)
        ? `${Math.round(value.value)}%`
        : undefined;
    const valueText = etaText ?? computedValueText;

    return (
        <ChakraBox position="relative" display="inline-flex" alignItems="center" justifyContent="center">
            <ChakraProgressCircle.Root {...props}>
                <ChakraProgressCircle.Circle>
                    <ChakraProgressCircle.Track
                        {...(trackColor !== undefined ? { stroke: trackColor } : {})}
                    />
                    <ChakraProgressCircle.Range
                        {...(fillColor !== undefined ? { stroke: fillColor } : {})}
                        {...(thickness !== undefined ? { strokeWidth: thickness } : {})}
                    />
                </ChakraProgressCircle.Circle>
                {valueText ? (
                    <ChakraProgressCircle.ValueText
                        {...(labelColor !== undefined ? { color: labelColor } : {})}
                    >
                        {valueText}
                    </ChakraProgressCircle.ValueText>
                ) : null}
            </ChakraProgressCircle.Root>
        </ChakraBox>
    );
}, (prev, next) => progressCircleEqual(prev.value, next.value));
