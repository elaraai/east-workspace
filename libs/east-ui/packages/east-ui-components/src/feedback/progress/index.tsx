/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useEffect, useState } from "react";
import { Progress as ChakraProgress, type ProgressRootProps } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Progress } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const progressEqual = equalFor(Progress.Types.Progress);

export type ProgressValue = ValueTypeOf<typeof Progress.Types.Progress>;

/**
 * Converts an East UI Progress value to Chakra root props. Visual presets
 * (variant / colorPalette / size / striped / animated) come from the `style`
 * sub-struct per §0.10.
 */
export function toChakraProgress(value: ProgressValue): ProgressRootProps {
    const style = getSomeorUndefined(value.style);
    const indeterminate = getSomeorUndefined(value.indeterminate) ?? false;
    const tone = style ? getSomeorUndefined(style.tone)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const sizeAllowed: ProgressRootProps["size"] = sizeTag === "xs" || sizeTag === "sm" || sizeTag === "md"
        ? sizeTag
        : undefined;
    return {
        value: indeterminate ? null : value.value,
        min: getSomeorUndefined(value.min),
        max: getSomeorUndefined(value.max),
        size: sizeAllowed,
        variant: style ? (getSomeorUndefined(style.variant)?.type as ProgressRootProps["variant"]) : undefined,
        striped: style ? getSomeorUndefined(style.striped) : undefined,
        animated: style ? getSomeorUndefined(style.animated) : undefined,
        // Drive recipe sentiment via Chakra's variant routing.
        ...(tone !== undefined ? { ["sentiment"]: tone } as Record<string, string> : {}),
    };
}

export interface EastChakraProgressProps {
    value: ProgressValue;
}

/**
 * Format an ETA string from `estimatedDuration` (seconds) and `startedAt`.
 * Returns `undefined` if either is missing or the ETA has already elapsed.
 */
function formatEta(startedAt: Date | undefined, estimatedDurationSec: bigint | undefined, now: number): string | undefined {
    if (!startedAt || estimatedDurationSec === undefined) return undefined;
    const elapsedMs = now - startedAt.getTime();
    const totalMs = Number(estimatedDurationSec) * 1000;
    const remainingMs = totalMs - elapsedMs;
    if (remainingMs <= 0) return undefined;
    const s = Math.max(0, Math.round(remainingMs / 1000));
    if (s < 60) return `~${s}s remaining`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `~${m}m remaining` : `~${m}m ${rem}s remaining`;
}

/**
 * Renders an East UI Progress. `indeterminate` sets `value={null}` on Chakra.
 * `estimatedDuration` + `startedAt` drive a client-side ETA refresh every 1s.
 */
export const EastChakraProgress = memo(function EastChakraProgress({ value }: EastChakraProgressProps) {
    const props = useMemo(() => toChakraProgress(value), [value]);
    const label = useMemo(() => getSomeorUndefined(value.label), [value.label]);
    const explicitValueText = useMemo(() => getSomeorUndefined(value.valueText), [value.valueText]);
    const showValue = getSomeorUndefined(value.showValue) ?? false;
    const estimatedDuration = getSomeorUndefined(value.estimatedDuration);
    const startedAt = getSomeorUndefined(value.startedAt);

    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!startedAt || estimatedDuration === undefined) return;
        const id = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [startedAt, estimatedDuration]);

    const etaText = useMemo(
        () => formatEta(startedAt, estimatedDuration, now),
        [startedAt, estimatedDuration, now],
    );
    const computedValueText = showValue && !getSomeorUndefined(value.indeterminate)
        ? `${Math.round(value.value)}%`
        : undefined;
    const derivedValueText = etaText ?? explicitValueText ?? computedValueText;

    const style = getSomeorUndefined(value.style);
    const trackColor = style ? getSomeorUndefined(style.trackColor) : undefined;
    const fillColor = style ? getSomeorUndefined(style.fillColor) : undefined;
    const labelColor = style ? getSomeorUndefined(style.labelColor) : undefined;

    return (
        <ChakraProgress.Root {...props}>
            {(label || derivedValueText) ? (
                <ChakraProgress.Label {...(labelColor !== undefined ? { color: labelColor } : {})}>
                    {label}
                    {derivedValueText ? (
                        <ChakraProgress.ValueText>{derivedValueText}</ChakraProgress.ValueText>
                    ) : null}
                </ChakraProgress.Label>
            ) : null}
            <ChakraProgress.Track
                {...(trackColor !== undefined ? { style: { background: trackColor } } : {})}
            >
                <ChakraProgress.Range
                    {...(fillColor !== undefined ? { style: { background: fillColor } } : {})}
                />
            </ChakraProgress.Track>
        </ChakraProgress.Root>
    );
}, (prev, next) => progressEqual(prev.value, next.value));
