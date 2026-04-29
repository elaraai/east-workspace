/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useCallback, useState, useEffect, useMemo, useRef } from "react";
import { HStack, VStack, Wrap, Button, Text, Box } from "@chakra-ui/react";
import { CalendarDate, Time, type DateValue } from "@internationalized/date";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { DateRangeInput } from "@elaraai/east-ui";
import { getSomeorUndefined } from "../../utils";
import {
    CompoundDateField,
    CompoundDateInput,
    CompoundDateSegment,
    TimeField,
    TimeInput,
    TimeSegment,
} from "../input/date";

const dateRangeInputEqual = equalFor(DateRangeInput.Types.Root);

export type DateRangeInputValue = ValueTypeOf<typeof DateRangeInput.Types.Root>;

export interface EastChakraDateRangeInputProps {
    value: DateRangeInputValue;
}

type Precision = "date" | "time" | "datetime";

interface DateTimeBits {
    calendar: CalendarDate;
    time: Time;
}

function dateToBits(d: Date): DateTimeBits {
    return {
        calendar: new CalendarDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
        time: new Time(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()),
    };
}

function bitsToDate(b: DateTimeBits): Date {
    return new Date(Date.UTC(
        b.calendar.year,
        b.calendar.month - 1,
        b.calendar.day,
        b.time.hour,
        b.time.minute,
        b.time.second,
    ));
}

/**
 * Renders an East UI DateRangeInput as paired react-aria date / time
 * fields — same primitives as `DateTimeInput`. When `presets` is set,
 * a chip row of preset buttons is rendered beneath the inputs.
 */
export const EastChakraDateRangeInput = memo(function EastChakraDateRangeInput({ value }: EastChakraDateRangeInputProps) {
    const style = getSomeorUndefined(value.style);
    const colour = style ? getSomeorUndefined(style.color) : undefined;
    const background = style ? getSomeorUndefined(style.background) : undefined;
    const borderColor = style ? getSomeorUndefined(style.borderColor) : undefined;
    const focusBorderColor = style ? getSomeorUndefined(style.focusBorderColor) : undefined;
    const sizeTag = style ? getSomeorUndefined(style.size)?.type : undefined;

    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const disabled = getSomeorUndefined(value.disabled) ?? false;
    const precision = (getSomeorUndefined(value.precision)?.type as Precision | undefined) ?? "date";
    const presets = getSomeorUndefined(value.presets);

    const startDate = value.startValue instanceof Date ? value.startValue : new Date(value.startValue);
    const endDate = value.endValue instanceof Date ? value.endValue : new Date(value.endValue);

    const [localStart, setLocalStart] = useState<DateTimeBits>(() => dateToBits(startDate));
    const [localEnd, setLocalEnd] = useState<DateTimeBits>(() => dateToBits(endDate));
    useEffect(() => { setLocalStart(dateToBits(startDate)); }, [startDate]);
    useEffect(() => { setLocalEnd(dateToBits(endDate)); }, [endDate]);

    // Cross-handler refs — read latest peer-bits without stale closures.
    const startRef = useRef(localStart);
    const endRef = useRef(localEnd);
    startRef.current = localStart;
    endRef.current = localEnd;

    const fireChange = useCallback((next: { start: DateTimeBits; end: DateTimeBits }) => {
        if (!onChangeFn) return;
        queueMicrotask(() => onChangeFn(bitsToDate(next.start), bitsToDate(next.end)));
    }, [onChangeFn]);

    const handleStartDate = useCallback((nextDate: DateValue | null) => {
        if (!nextDate) return;
        const calendar = nextDate as CalendarDate;
        const updated = { ...startRef.current, calendar };
        setLocalStart(updated);
        fireChange({ start: updated, end: endRef.current });
    }, [fireChange]);

    const handleStartTime = useCallback((nextTime: Time | null) => {
        if (!nextTime) return;
        const updated = { ...startRef.current, time: nextTime };
        setLocalStart(updated);
        fireChange({ start: updated, end: endRef.current });
    }, [fireChange]);

    const handleEndDate = useCallback((nextDate: DateValue | null) => {
        if (!nextDate) return;
        const calendar = nextDate as CalendarDate;
        const updated = { ...endRef.current, calendar };
        setLocalEnd(updated);
        fireChange({ start: startRef.current, end: updated });
    }, [fireChange]);

    const handleEndTime = useCallback((nextTime: Time | null) => {
        if (!nextTime) return;
        const updated = { ...endRef.current, time: nextTime };
        setLocalEnd(updated);
        fireChange({ start: startRef.current, end: updated });
    }, [fireChange]);

    const handlePreset = useCallback((startD: Date, endD: Date) => {
        const sb = dateToBits(startD);
        const eb = dateToBits(endD);
        setLocalStart(sb);
        setLocalEnd(eb);
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(startD, endD));
        }
    }, [onChangeFn]);

    const fontSize = sizeTag === "sm" || sizeTag === "xs" ? "sm" : sizeTag === "lg" ? "lg" : "md";
    const px = sizeTag === "sm" || sizeTag === "xs" ? 2 : sizeTag === "lg" ? 4 : 3;
    const py = sizeTag === "sm" || sizeTag === "xs" ? 1 : sizeTag === "lg" ? 2.5 : 1.5;

    const fieldShell = {
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: borderColor ?? "border",
        borderRadius: "md",
        bg: background,
        color: colour,
        px,
        py,
        fontSize,
        opacity: disabled ? 0.6 : 1,
        _focusWithin: focusBorderColor
            ? { borderColor: focusBorderColor, boxShadow: `0 0 0 1px ${focusBorderColor}` }
            : { borderColor: "blue.500", boxShadow: "0 0 0 1px var(--chakra-colors-blue-500)" },
    } as const;

    const renderField = (
        bits: DateTimeBits,
        onDateChange: (d: DateValue | null) => void,
        onTimeChange: (t: Time | null) => void,
        ariaPrefix: string,
    ) => {
        if (precision === "time") {
            return (
                <Box {...fieldShell}>
                    <TimeField value={bits.time} onChange={onTimeChange} isReadOnly={disabled} aria-label={`${ariaPrefix} time`}>
                        <TimeInput>
                            {({ segment }) => <TimeSegment segment={segment} />}
                        </TimeInput>
                    </TimeField>
                </Box>
            );
        }
        if (precision === "date") {
            return (
                <Box {...fieldShell}>
                    <CompoundDateField value={bits.calendar} onChange={onDateChange} isReadOnly={disabled} aria-label={`${ariaPrefix} date`}>
                        <CompoundDateInput>
                            {({ segment }) => <CompoundDateSegment segment={segment} />}
                        </CompoundDateInput>
                    </CompoundDateField>
                </Box>
            );
        }
        return (
            <Box {...fieldShell}>
                <CompoundDateField value={bits.calendar} onChange={onDateChange} isReadOnly={disabled} aria-label={`${ariaPrefix} date`}>
                    <CompoundDateInput>
                        {({ segment }) => <CompoundDateSegment segment={segment} />}
                    </CompoundDateInput>
                </CompoundDateField>
                <TimeField value={bits.time} onChange={onTimeChange} isReadOnly={disabled} aria-label={`${ariaPrefix} time`}>
                    <TimeInput>
                        {({ segment }) => <TimeSegment segment={segment} />}
                    </TimeInput>
                </TimeField>
            </Box>
        );
    };

    const inputs = (
        <HStack gap="2" align="center">
            {renderField(localStart, handleStartDate, handleStartTime, "Start")}
            <Text color="fg.muted" fontSize={fontSize}>–</Text>
            {renderField(localEnd, handleEndDate, handleEndTime, "End")}
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
                        onClick={() => handlePreset(
                            p.start instanceof Date ? p.start : new Date(p.start),
                            p.end instanceof Date ? p.end : new Date(p.end),
                        )}
                    >
                        {p.label}
                    </Button>
                ))}
            </Wrap>
        </VStack>
    );
}, (prev, next) => dateRangeInputEqual(prev.value, next.value));
