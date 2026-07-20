/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { memo, useMemo, useCallback, useState, useEffect, useRef, type ChangeEvent, type FocusEvent, type KeyboardEvent } from "react";
import { Input as ChakraInput, NumberInput as ChakraNumberInput, type InputProps, type NumberInputRootProps, Box } from "@chakra-ui/react";
import { equalFor, type ValueTypeOf } from "@elaraai/east";
import { Input } from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { fieldChrome, fieldFocusRing } from "../../theme/field-chrome";

/** Bordered shell wrapping the date/time segments — same chrome as every input. */
const dateFieldShell = {
    ...fieldChrome,
    display: "inline-flex",
    alignItems: "center",
    gap: "{spacing.2}",
    _focusWithin: fieldFocusRing,
};
import { CalendarDate, Time, type DateValue } from "@internationalized/date";
import {
    CompoundDateField,
    CompoundDateInput,
    CompoundDateSegment,
    TimeField,
    TimeInput,
    TimeSegment,
} from "./date";


const stringInputEqual = equalFor(Input.Types.String);
/** East StringInput value type */
export type StringInputValue = ValueTypeOf<typeof Input.Types.String>;

/** Map an Input value's `style` sub-struct to Chakra `<Input>` props. */
function inputStyleProps(styleOpt: StringInputValue["style"]): Partial<InputProps> {
    const style = getSomeorUndefined(styleOpt);
    if (!style) return {};
    const variantTag = getSomeorUndefined(style.variant)?.type;
    const sizeTag = getSomeorUndefined(style.size)?.type;
    const colour = getSomeorUndefined(style.color);
    const background = getSomeorUndefined(style.background);
    const borderColor = getSomeorUndefined(style.borderColor);
    const focusBorderColor = getSomeorUndefined(style.focusBorderColor);
    const autoFocus = getSomeorUndefined(style.autoFocus);
    const out: Partial<InputProps> = {};
    if (variantTag) out.variant = variantTag;
    if (sizeTag) out.size = sizeTag;
    if (colour) out.color = colour;
    if (background) out.bg = background;
    if (borderColor) out.borderColor = borderColor;
    if (focusBorderColor) out._focus = { borderColor: focusBorderColor, boxShadow: `0 0 0 1px ${focusBorderColor}` };
    if (autoFocus) out.autoFocus = autoFocus;
    return out;
}

/**
 * Converts an East UI StringInput value to Chakra UI Input props.
 */
export function toChakraStringInput(value: StringInputValue): InputProps {
    return {
        value: value.value,
        placeholder: getSomeorUndefined(value.placeholder),
        ...inputStyleProps(value.style),
        maxLength: getSomeorUndefined(value.maxLength) !== undefined ? Number(getSomeorUndefined(value.maxLength)) : undefined,
        pattern: getSomeorUndefined(value.pattern),
        disabled: getSomeorUndefined(value.disabled),
    };
}


export interface EastChakraStringInputProps {
    value: StringInputValue;
}

/**
 * Renders an East UI StringInput value using Chakra UI Input component.
 */
export const EastChakraStringInput = memo(function EastChakraStringInput({ value }: EastChakraStringInputProps) {
    const [props, setProps] = useState(toChakraStringInput(value));
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onBlurFn = useMemo(() => getSomeorUndefined(value.onBlur), [value.onBlur]);
    const onFocusFn = useMemo(() => getSomeorUndefined(value.onFocus), [value.onFocus]);

    useEffect(() => {
        setProps(() => toChakraStringInput(value));
    }, [value]);

    const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        setProps(prev => ({ ...prev, value: next }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(next));
        }
    }, [onChangeFn]);

    const handleBlur = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onBlurFn) {
            queueMicrotask(() => onBlurFn());
        }
    }, [onBlurFn]);

    const handleFocus = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onFocusFn) {
            queueMicrotask(() => onFocusFn());
        }
    }, [onFocusFn]);


    return <ChakraInput
        {...props}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
    />
}, (prev, next) => stringInputEqual(prev.value, next.value));

const integerInputEqual = equalFor(Input.Types.Integer);

/** East IntegerInput value type */
export type IntegerInputValue = ValueTypeOf<typeof Input.Types.Integer>;


/** Map an Input value's `style` sub-struct to `NumberInput.Root` props. The
 *  numeric figure treatment lives in the `numberInput` recipe; only the
 *  `dirty` variant and the colour escape hatches pass through. */
function numberStyleProps(styleOpt: StringInputValue["style"]): Partial<NumberInputRootProps> {
    const style = getSomeorUndefined(styleOpt);
    if (!style) return {};
    const sizeTag = getSomeorUndefined(style.size)?.type;
    const colour = getSomeorUndefined(style.color);
    const background = getSomeorUndefined(style.background);
    const borderColor = getSomeorUndefined(style.borderColor);
    const focusBorderColor = getSomeorUndefined(style.focusBorderColor);
    const out: Partial<NumberInputRootProps> = {};
    if (sizeTag) out.size = sizeTag as NumberInputRootProps["size"];
    if (colour) out.color = colour;
    if (background) out.bg = background;
    if (borderColor) out.borderColor = borderColor;
    if (focusBorderColor) out._focusWithin = { borderColor: focusBorderColor, boxShadow: `0 0 0 1px ${focusBorderColor}` };
    return out;
}

/**
 * Converts an East UI IntegerInput value to Chakra UI NumberInput.Root props.
 */
export function toChakraIntegerInput(value: IntegerInputValue): NumberInputRootProps {
    return {
        value: value.value.toString(),
        min: getSomeorUndefined(value.min) !== undefined ? Number(getSomeorUndefined(value.min)) : undefined,
        max: getSomeorUndefined(value.max) !== undefined ? Number(getSomeorUndefined(value.max)) : undefined,
        step: getSomeorUndefined(value.step) !== undefined ? Number(getSomeorUndefined(value.step)) : 1,
        ...numberStyleProps(value.style),
        disabled: getSomeorUndefined(value.disabled),
    };
}

export interface EastChakraIntegerInputProps {
    value: IntegerInputValue;
}


/**
 * Renders an East UI IntegerInput value using Chakra UI Input component.
 */
export const EastChakraIntegerInput = memo(function EastChakraIntegerInput({ value }: EastChakraIntegerInputProps) {
    const [props, setProps] = useState(toChakraIntegerInput(value));
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onBlurFn = useMemo(() => getSomeorUndefined(value.onBlur), [value.onBlur]);
    const onFocusFn = useMemo(() => getSomeorUndefined(value.onFocus), [value.onFocus]);

    useEffect(() => {
        setProps(() => toChakraIntegerInput(value));
    }, [value]);

    // Prevent invalid characters for integers (only digits, minus, and control keys)
    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
        // Allow: backspace, delete, tab, escape, enter, arrows
        if (["Backspace", "Delete", "Tab", "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
            return;
        }
        // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
        if ((e.ctrlKey || e.metaKey) && ["a", "c", "v", "x"].includes(e.key.toLowerCase())) {
            return;
        }
        // Allow: minus at start only
        if (e.key === "-" && e.currentTarget.selectionStart === 0 && !e.currentTarget.value.includes("-")) {
            return;
        }
        // Allow: digits 0-9
        if (/^\d$/.test(e.key)) {
            return;
        }
        // Block everything else (including ".", "e", etc.)
        e.preventDefault();
    }, []);

    const handleValueChange = useCallback((details: { value: string }) => {
        const raw = details.value;
        // Always update local state so partial inputs ("-", "") render while typing
        setProps(prev => ({ ...prev, value: raw }));
        if (onChangeFn) {
            // Only fire East callback for fully-parsed integers
            if (raw === "" || raw === "-") return;
            try {
                const parsed = BigInt(raw);
                queueMicrotask(() => onChangeFn(parsed));
            } catch {
                // Invalid integer, don't call onChange
            }
        }
    }, [onChangeFn]);

    const handleBlur = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onBlurFn) {
            queueMicrotask(() => onBlurFn());
        }
    }, [onBlurFn]);

    const handleFocus = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onFocusFn) {
            queueMicrotask(() => onFocusFn());
        }
    }, [onFocusFn]);

    return (
        <ChakraNumberInput.Root {...props} onValueChange={handleValueChange}>
            {/* Mobile keyboards (#348): digits-only layout for integers. */}
            <ChakraNumberInput.Input
                inputMode="numeric"
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onFocus={handleFocus}
            />
            <ChakraNumberInput.Control>
                <ChakraNumberInput.IncrementTrigger />
                <ChakraNumberInput.DecrementTrigger />
            </ChakraNumberInput.Control>
        </ChakraNumberInput.Root>
    );
}, (prev, next) => integerInputEqual(prev.value, next.value));


const floatInputEqual = equalFor(Input.Types.Float);

/** East FloatInput value type */
export type FloatInputValue = ValueTypeOf<typeof Input.Types.Float>;


/**
 * Converts an East UI FloatInput value to Chakra UI NumberInput.Root props.
 */
export function toChakraFloatInput(value: FloatInputValue): NumberInputRootProps {
    const precision = getSomeorUndefined(value.precision);
    const displayValue = precision !== undefined
        ? value.value.toFixed(Number(precision))
        : value.value.toString();

    return {
        value: displayValue,
        min: getSomeorUndefined(value.min),
        max: getSomeorUndefined(value.max),
        step: getSomeorUndefined(value.step),
        ...numberStyleProps(value.style),
        disabled: getSomeorUndefined(value.disabled),
    };
}

export interface EastChakraFloatInputProps {
    value: FloatInputValue;
}


/**
 * Renders an East UI FloatInput value using Chakra UI Input component.
 */
export const EastChakraFloatInput = memo(function EastChakraFloatInput({ value }: EastChakraFloatInputProps) {
    const [props, setProps] = useState(toChakraFloatInput(value));
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);
    const onBlurFn = useMemo(() => getSomeorUndefined(value.onBlur), [value.onBlur]);
    const onFocusFn = useMemo(() => getSomeorUndefined(value.onFocus), [value.onFocus]);

    useEffect(() => {
        setProps(() => toChakraFloatInput(value));
    }, [value]);

    const handleValueChange = useCallback((details: { value: string }) => {
        const raw = details.value;
        // Always update local state so partial inputs ("-", ".", "-.") render while typing
        setProps(prev => ({ ...prev, value: raw }));
        if (onChangeFn) {
            // Only fire East callback for fully-parsed floats
            if (raw === "" || raw === "-" || raw === "." || raw === "-.") return;
            const parsed = parseFloat(raw);
            if (!Number.isNaN(parsed)) {
                queueMicrotask(() => onChangeFn(parsed));
            }
        }
    }, [onChangeFn]);

    const handleBlur = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onBlurFn) {
            queueMicrotask(() => onBlurFn());
        }
    }, [onBlurFn]);

    const handleFocus = useCallback((_e: FocusEvent<HTMLInputElement>) => {
        if (onFocusFn) {
            queueMicrotask(() => onFocusFn());
        }
    }, [onFocusFn]);

    return (
        <ChakraNumberInput.Root {...props} onValueChange={handleValueChange}>
            {/* Mobile keyboards (#348): decimal layout for floats. */}
            <ChakraNumberInput.Input
                inputMode="decimal"
                onBlur={handleBlur}
                onFocus={handleFocus}
            />
            <ChakraNumberInput.Control>
                <ChakraNumberInput.IncrementTrigger />
                <ChakraNumberInput.DecrementTrigger />
            </ChakraNumberInput.Control>
        </ChakraNumberInput.Root>
    );
}, (prev, next) => floatInputEqual(prev.value, next.value));


// Pre-define equality functions at module level
const dateTimeInputEqual = equalFor(Input.Types.DateTime);

/** East DateTimeInput value type */
export type DateTimeInputValue = ValueTypeOf<typeof Input.Types.DateTime>;

/**
 * Converts a JS Date (UTC) to a CalendarDate for the date field components.
 * East dates are UTC, so we use UTC methods.
 */
function dateToCalendarDate(date: Date): CalendarDate {
    return new CalendarDate(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1, // CalendarDate months are 1-indexed
        date.getUTCDate()
    );
}

/**
 * Converts a JS Date (UTC) to a Time for the time field components.
 * East dates are UTC, so we use UTC methods.
 */
function dateToTime(date: Date): Time {
    return new Time(
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
    );
}

/**
 * Converts a DateValue and optional Time back to a JS Date (UTC).
 * East dates are UTC, so we create a UTC date.
 */
function dateValueToDate(dateValue: DateValue, time?: Time): Date {
    return new Date(Date.UTC(
        dateValue.year,
        dateValue.month - 1, // JS Date months are 0-indexed
        dateValue.day,
        time?.hour ?? 0,
        time?.minute ?? 0,
        time?.second ?? 0
    ));
}

/** Props returned by toChakraDateTimeInput for memoization */
export interface ChakraDateTimeInputProps {
    calendarDate: CalendarDate;
    timeValue: Time;
    precision: "date" | "time" | "datetime";
    disabled: boolean;
}

/**
 * Converts an East UI DateTimeInput value to props for the compound date field components.
 * Use with useMemo for performance optimization.
 */
export function toChakraDateTimeInput(value: DateTimeInputValue): ChakraDateTimeInputProps {
    const dateValue = value.value instanceof Date ? value.value : new Date(value.value);
    return {
        calendarDate: dateToCalendarDate(dateValue),
        timeValue: dateToTime(dateValue),
        precision: (getSomeorUndefined(value.precision)?.type as "date" | "time" | "datetime") ?? "datetime",
        disabled: getSomeorUndefined(value.disabled) ?? false,
    };
}

export interface EastChakraDateTimeInputProps {
    value: DateTimeInputValue;
}

/**
 * Renders an East UI DateTimeInput value using compound date field components.
 * Supports date-only, time-only, and datetime modes based on the precision property.
 */
export const EastChakraDateTimeInput = memo(function EastChakraDateTimeInput({ value }: EastChakraDateTimeInputProps) {
    const [props, setProps] = useState(toChakraDateTimeInput(value));
    const onChangeFn = useMemo(() => getSomeorUndefined(value.onChange), [value.onChange]);

    // Mirror the latest local props so handlers can read the cross-field
    // component (date for time-handler, time for date-handler) without
    // a stale closure on the handler's render-time props.
    const propsRef = useRef(props);
    propsRef.current = props;

    useEffect(() => {
        setProps(() => toChakraDateTimeInput(value));
    }, [value]);

    // Handle date change
    const handleDateChange = useCallback((newDate: DateValue | null) => {
        if (!newDate) return;
        const current = propsRef.current;
        const nextCalendar = newDate as CalendarDate;
        const currentTime = current.precision === "date" ? undefined : current.timeValue;
        const out = dateValueToDate(newDate, currentTime);
        setProps(prev => ({ ...prev, calendarDate: nextCalendar }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(out));
        }
    }, [onChangeFn]);

    // Handle time change
    const handleTimeChange = useCallback((newTime: Time | null) => {
        if (!newTime) return;
        const current = propsRef.current;
        const out = dateValueToDate(current.calendarDate, newTime);
        setProps(prev => ({ ...prev, timeValue: newTime }));
        if (onChangeFn) {
            queueMicrotask(() => onChangeFn(out));
        }
    }, [onChangeFn]);

    // Render based on precision
    if (props.precision === "time") {
        return (
            <Box css={dateFieldShell}>
                <TimeField value={props.timeValue} onChange={handleTimeChange} isReadOnly={props.disabled}>
                    <TimeInput>
                        {({ segment }) => <TimeSegment segment={segment} />}
                    </TimeInput>
                </TimeField>
            </Box>
        );
    }

    if (props.precision === "date") {
        return (
            <Box css={dateFieldShell}>
                <CompoundDateField value={props.calendarDate} onChange={handleDateChange} isReadOnly={props.disabled}>
                    <CompoundDateInput>
                        {({ segment }) => <CompoundDateSegment segment={segment} />}
                    </CompoundDateInput>
                </CompoundDateField>
            </Box>
        );
    }

    // Default: datetime (both date and time)
    return (
        <Box css={dateFieldShell}>
            <CompoundDateField value={props.calendarDate} onChange={handleDateChange} isReadOnly={props.disabled}>
                <CompoundDateInput>
                    {({ segment }) => <CompoundDateSegment segment={segment} />}
                </CompoundDateInput>
            </CompoundDateField>
            <TimeField value={props.timeValue} onChange={handleTimeChange} isReadOnly={props.disabled}>
                <TimeInput>
                    {({ segment }) => <TimeSegment segment={segment} />}
                </TimeInput>
            </TimeField>
        </Box>
    );
}, (prev, next) => dateTimeInputEqual(prev.value, next.value));
