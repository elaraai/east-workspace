/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useState, useEffect, useMemo } from "react";
import { HStack, VStack, Wrap, Button, Text, Box } from "@chakra-ui/react";
import { Time } from "@internationalized/date";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { TimeRangeInput } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { fieldChrome, fieldFocusRing } from "../../theme/field-chrome";
import { TimeField, TimeInput, TimeSegment } from "../input/date";

const timeRangeInputEqual = equalFor(TimeRangeInput.Types.Root);

export type TimeRangeInputValue = ValueTypeOf<typeof TimeRangeInput.Types.Root>;

export interface EastChakraTimeRangeInputProps {
    value: TimeRangeInputValue;
}

/** Convert minutes-since-midnight to a `Time` from `@internationalized/date`. */
function minutesToTime(minutes: bigint | number): Time {
    const m = typeof minutes === "bigint" ? Number(minutes) : minutes;
    const clamped = ((m % 1440) + 1440) % 1440;
    return new Time(Math.floor(clamped / 60), clamped % 60, 0);
}

/** Convert a `Time` back to minutes-since-midnight (BigInt). */
function timeToMinutes(t: Time): bigint {
    return BigInt(t.hour * 60 + t.minute);
}

/**
 * Renders an East UI TimeRangeInput as paired react-aria `TimeField`
 * segment-fields (consistent with `DateTimeInput` precision="time").
 * When `presets` is set, a chip row of preset buttons is rendered
 * beneath the inputs.
 */
export const EastChakraTimeRangeInput = memo(function EastChakraTimeRangeInput({ value }: EastChakraTimeRangeInputProps) {
    const style = getSomeorUndefined(value.style);
    const colour = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const focusBorderColor = style ? getSomeorUndefined(style.focusBorderColor) : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;

    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const disabled = getSomeorUndefined(value.disabled) ?? false;
    const presets = getSomeorUndefined(value.presets);

    const [localStart, setLocalStart] = useState<Time>(minutesToTime(value.startValue));
    const [localEnd, setLocalEnd] = useState<Time>(minutesToTime(value.endValue));
    useEffect(() => { setLocalStart(minutesToTime(value.startValue)); }, [value.startValue]);
    useEffect(() => { setLocalEnd(minutesToTime(value.endValue)); }, [value.endValue]);

    const handleStartChange = useCallback((next: Time | null) => {
        if (!next) return;
        setLocalStart(next);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(timeToMinutes(next), timeToMinutes(localEnd)));
        }
    }, [onChangeFn, localEnd]);

    const handleEndChange = useCallback((next: Time | null) => {
        if (!next) return;
        setLocalEnd(next);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(timeToMinutes(localStart), timeToMinutes(next)));
        }
    }, [onChangeFn, localStart]);

    const handlePreset = useCallback((startMin: bigint, endMin: bigint) => {
        const s = minutesToTime(startMin);
        const e = minutesToTime(endMin);
        setLocalStart(s);
        setLocalEnd(e);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(startMin, endMin));
        }
    }, [onChangeFn]);

    // Size mapping — sm/md/lg → tighter / default / looser padding + font.
    const fontSize = sizeTag === "sm" || sizeTag === "xs" ? "sm" : sizeTag === "lg" ? "lg" : "md";

    const fieldShell = {
        ...fieldChrome,
        display: "inline-flex",
        alignItems: "center",
        /* Touch (#348): 44px field rows on coarse pointers. */
        _coarse: { minHeight: "44px" },
        ...(background !== undefined ? { background } : {}),
        ...(colour !== undefined ? { color: colour } : {}),
        ...(borderColor !== undefined ? { borderColor } : {}),
        opacity: disabled ? 0.6 : 1,
        _focusWithin: focusBorderColor ? { borderColor: focusBorderColor } : fieldFocusRing,
    };

    const inputs = (
        // wrap (#348): compact containers drop the end field to a second line.
        <HStack gap="2" align="center" flexWrap="wrap">
            <Box css={fieldShell}>
                <TimeField value={localStart} onChange={handleStartChange} isReadOnly={disabled} aria-label="Start time">
                    <TimeInput>
                        {({ segment }) => <TimeSegment segment={segment} />}
                    </TimeInput>
                </TimeField>
            </Box>
            <Text color="fg.muted" fontSize={fontSize}>–</Text>
            <Box css={fieldShell}>
                <TimeField value={localEnd} onChange={handleEndChange} isReadOnly={disabled} aria-label="End time">
                    <TimeInput>
                        {({ segment }) => <TimeSegment segment={segment} />}
                    </TimeInput>
                </TimeField>
            </Box>
        </HStack>
    );

    if (!presets || presets.length === 0) {
        return inputs;
    }

    return (
        <VStack gap="2" align="flex-start">
            {inputs}
            <Wrap gap="2">
                {presets.map((p, i) => (
                    <Button
                        key={`${p.label}-${i}`}
                        size="xs"
                        variant="subtle"
                        disabled={disabled}
                        onClick={() => handlePreset(p.start, p.end)}
                    >
                        {p.label}
                    </Button>
                ))}
            </Wrap>
        </VStack>
    );
}, (prev, next) => timeRangeInputEqual(prev.value, next.value));
