/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useState, useEffect } from "react";
import { SegmentGroup } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf, variant } from "@elaraai/east";
import { TimeScaleControl } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";

const timeScaleControlEqual = equalFor(TimeScaleControl.Types.Root);

export type TimeScaleControlValue = ValueTypeOf<typeof TimeScaleControl.Types.Root>;

export interface EastChakraTimeScaleControlProps {
    value: TimeScaleControlValue;
}

const ALL_SCALES: ReadonlyArray<"minute" | "hour" | "day" | "week" | "month" | "quarter" | "year"> = [
    "minute", "hour", "day", "week", "month", "quarter", "year",
];

const SCALE_LABEL: Record<typeof ALL_SCALES[number], string> = {
    minute: "Minute",
    hour: "Hour",
    day: "Day",
    week: "Week",
    month: "Month",
    quarter: "Quarter",
    year: "Year",
};

/**
 * Renders an East UI TimeScaleControl as a Chakra UI SegmentGroup —
 * mutually-exclusive segment buttons, one per available scale.
 */
export const EastChakraTimeScaleControl = memo(function EastChakraTimeScaleControl({ value }: EastChakraTimeScaleControlProps) {
    const style = getSomeorUndefined(value.style);
    const variantTag = style ? getSomeorUndefined(style.variant)?.type : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;
    const size: "sm" | "md" | "lg" | undefined = sizeTag === "xs" ? "sm" : sizeTag;
    const colorPalette = style ? getSomeorUndefined(style.colorPalette)?.type : undefined;

    const onChangeFn = getSomeorUndefined(value.onChange);
    const disabled = getSomeorUndefined(value.disabled);

    // Resolve the available scales — IR list, or all 7 by default.
    const irAvailable = getSomeorUndefined(value.availableScales);
    const availableScales: ReadonlyArray<typeof ALL_SCALES[number]> = irAvailable
        ? irAvailable.map(s => s.type as typeof ALL_SCALES[number])
        : ALL_SCALES;

    const [localScale, setLocalScale] = useState<string>(value.value.type);
    useEffect(() => { setLocalScale(value.value.type); }, [value.value]);

    const handleChange = useCallback((details: { value: string | null }) => {
        const next = details.value;
        if (!next) return;
        setLocalScale(next);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(variant(next as typeof ALL_SCALES[number], null) as ValueTypeOf<typeof TimeScaleControl.Types.Scale>));
        }
    }, [onChangeFn]);

    const items = availableScales.map(s => ({ value: s, label: SCALE_LABEL[s] }));

    return (
        <SegmentGroup.Root
            value={localScale}
            onValueChange={handleChange}
            colorPalette={colorPalette ?? "brand"}
            size={size}
            disabled={disabled}
            // Chakra v3 SegmentGroup doesn't have an explicit `variant`
            // prop for solid/outline/subtle the same way Button does;
            // use `data-variant` for theme-level overrides. Plain
            // default rendering is the closest equivalent here.
            data-variant={variantTag}
        >
            <SegmentGroup.Indicator />
            <SegmentGroup.Items items={items} />
        </SegmentGroup.Root>
    );
}, (prev, next) => timeScaleControlEqual(prev.value, next.value));
