/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { CalendarDateTime } from "@internationalized/date";
import { DateTimeType, IntegerType, FloatType, compareFor, defaultValue, parseFor, printFor, some, variant } from "@elaraai/east";
import { Input } from "@elaraai/east-ui/internal";
import { EastChakraIntegerInput, EastChakraFloatInput } from "../../forms/input/index.js";
import { CompoundDateField, CompoundDateInput, CompoundDateSegment } from "../../forms/input/date/index.js";
import { useFormatters } from "../../format/index.js";
import { SliceChoiceGroup, SliceFieldActions } from "../choice.js";

export type SliceRangeKind = "datetime" | "integer" | "float";
const READ = { datetime: parseFor(DateTimeType), integer: parseFor(IntegerType), float: parseFor(FloatType) };
const PRINT = { datetime: printFor(DateTimeType), integer: printFor(IntegerType), float: printFor(FloatType) };
const dateEqual = compareFor(DateTimeType);
const integerEqual = compareFor(IntegerType);
const floatEqual = compareFor(FloatType);
type Period = "day" | "week" | "month" | "custom";
const PERIODS = [{ id: "day", label: "1 day" }, { id: "week", label: "1 week" }, { id: "month", label: "1 month" }, { id: "custom", label: "Custom" }] as const;
const calendarDate = (d: Date) => new CalendarDateTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
const hasTime = (text: string) => { const d = READ.datetime(text); return d.success && (d.value.getUTCHours() !== 0 || d.value.getUTCMinutes() !== 0 || d.value.getUTCSeconds() !== 0 || d.value.getUTCMilliseconds() !== 0); };
function periodEnd(from: string, period: Period, exclusive: boolean): string | undefined {
    const start = READ.datetime(from);
    if (!start.success || period === "custom") return undefined;
    const end = calendarDate(start.value).add(period === "month" ? { months: 1 } : { days: period === "week" ? 7 : 1 }).toDate("UTC");
    return PRINT.datetime(exclusive ? end : new Date(end.getTime() - 1));
}
function periodOf(from: string, to: string, exclusive: boolean): Period {
    return PERIODS.find(p => p.id !== "custom" && periodEnd(from, p.id, exclusive) === to)?.id ?? "custom";
}

/** Typed bounds shared by local and record adapters; all text uses East's codecs. */
export interface SliceRangeEditorProps {
    kind: SliceRangeKind; from: string; to: string; label: string;
    single?: boolean; exclusive?: boolean; immediate?: boolean;
    onApply: (from: string, to: string) => void;
    onClear?: () => void;
    clearDisabled?: boolean;
    children?: ReactNode;
    proposal?: (from: string, to: string) => { hint?: string; disabled: boolean } | undefined;
    /** Suggested draft only; opening an unfiltered field never applies these bounds. */
    defaultFrom?: string;
    defaultTo?: string;
}

/** Render a typed bound using existing numeric inputs or the shared date field. */
function BoundInput({ kind, value, label, time, onChange, onCompleteChange }: { kind: SliceRangeKind; value: string; label: string; time: boolean; onChange: (text: string) => void; onCompleteChange: (complete: boolean) => void }) {
    const dateStyles = useSlotRecipe({ key: "dateField" })({ size: "sm" });
    // Stable while a segment is incomplete: a fresh CalendarDateTime would
    // reset React Aria's draft whenever completeness changes in the parent.
    const date = useMemo(() => {
        const read = kind === "datetime" ? READ.datetime(value) : undefined;
        const d = read?.success ? read.value : undefined;
        return d === undefined ? undefined : calendarDate(d);
    }, [kind, value]);
    useEffect(() => { if (kind !== "datetime") onCompleteChange(true); }, [kind, onCompleteChange]);
    if (kind === "datetime") {
        return <Box css={dateStyles.shell}><CompoundDateField size="sm" aria-label={label}
            {...(date === undefined ? {} : { value: date })} granularity={time ? "second" : "day"} hourCycle={24} onCompleteChange={onCompleteChange}
            onChange={next => onChange(next === null ? "" : PRINT.datetime(next.toDate("UTC")))}>
            <CompoundDateInput>{({ segment }) => <CompoundDateSegment segment={segment} />}</CompoundDateInput>
        </CompoundDateField></Box>;
    }
    const draft = { text: value, label, onChange };
    const style = some({ ...defaultValue(Input.Types.Style), size: some(variant("sm", null)) });
    return kind === "integer"
        ? <EastChakraIntegerInput value={{ ...defaultValue(Input.Types.Integer), style }} draft={draft} />
        : <EastChakraFloatInput value={{ ...defaultValue(Input.Types.Float), style }} draft={draft} />;
}

/** Keep invalid/partial input local and commit only complete, ordered bounds. */
export function SliceRangeEditor({ kind, from: initialFrom, to: initialTo, label, single = false, exclusive = false,
    immediate = false, onApply, onClear, clearDisabled, children, proposal, defaultFrom, defaultTo }: SliceRangeEditorProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const words = useFormatters();
    const [today] = useState(() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return PRINT.datetime(d); });
    const suggestedFrom = initialFrom || (kind === "datetime" ? defaultFrom ?? today : "");
    const suggestedTo = initialTo || (kind === "datetime" ? defaultTo ?? periodEnd(suggestedFrom, "week", exclusive) ?? "" : "");
    const [from, setFrom] = useState(suggestedFrom);
    const [to, setTo] = useState(suggestedTo);
    const suggestedPeriod = periodOf(suggestedFrom, suggestedTo, exclusive);
    const suggestedTime = hasTime(suggestedFrom) || (suggestedPeriod === "custom" && hasTime(suggestedTo));
    const [period, setPeriod] = useState<Period>(suggestedPeriod);
    const [time, setTime] = useState(suggestedTime);
    const edited = useRef(false);
    const external = useRef({ from: initialFrom, to: initialTo });
    const [fromComplete, setFromComplete] = useState(true);
    const [toComplete, setToComplete] = useState(true);
    const fromCompletion = useCallback((complete: boolean) => { setFromComplete(complete); if (!complete) edited.current = true; }, []);
    const toCompletion = useCallback((complete: boolean) => { setToComplete(complete); if (!complete) edited.current = true; }, []);
    useEffect(() => {
        const changed = external.current.from !== initialFrom || external.current.to !== initialTo;
        external.current = { from: initialFrom, to: initialTo };
        if (changed) edited.current = false;
        if (edited.current) return;
        setFrom(suggestedFrom); setTo(suggestedTo);
        setPeriod(suggestedPeriod); setTime(suggestedTime);
    }, [initialFrom, initialTo, suggestedFrom, suggestedTo, suggestedPeriod, suggestedTime]);
    const valid = (a: string, b: string): boolean => {
        const l = READ[kind](a); const r = READ[kind](b);
        if (!l.success || (!single && !r.success)) return false;
        if (single) return true;
        if (!r.success) return false;
        const order = kind === "datetime" ? dateEqual(l.value as Date, r.value as Date)
            : kind === "integer" ? integerEqual(l.value as bigint, r.value as bigint) : floatEqual(l.value as number, r.value as number);
        return exclusive ? order < 0 : order <= 0;
    };
    const complete = valid(from, to) && fromComplete && (single || toComplete);
    const change = (a: string, b: string, otherComplete: boolean) => { edited.current = true; setFrom(a); setTo(b); if (immediate && otherComplete && valid(a, b) && !proposal?.(a, b)?.disabled) onApply(a, b); };
    const proposed = complete ? proposal?.(from, to) : undefined;
    const end = kind === "datetime" ? READ.datetime(to) : undefined;
    return <Box css={styles.choiceList}>
        {children}
        <Box css={styles.field}><Box as="span" css={styles.fieldLabel}>{single ? "Value" : kind === "datetime" ? "Start" : "From"}</Box>
            <BoundInput kind={kind} value={from} time={time} label={`${label} ${single ? "value" : "from"}`} onChange={v => change(v, kind === "datetime" && !single ? periodEnd(v, period, exclusive) ?? to : to, single || toComplete)} onCompleteChange={fromCompletion} /></Box>
        {kind === "datetime" && !single && <Box css={styles.field}>
            <Box as="span" css={styles.fieldLabel}>Duration</Box>
            <SliceChoiceGroup choices={PERIODS.map(p => ({ ...p, active: p.id === period }))} onPick={id => {
                edited.current = true;
                const next = id as Period; setPeriod(next); const end = periodEnd(from, next, exclusive);
                if (end !== undefined) { setToComplete(true); change(from, end, fromComplete); }
            }} />
        </Box>}
        {!single && (kind !== "datetime" || period === "custom") && <Box css={styles.field}><Box as="span" css={styles.fieldLabel}>{exclusive ? "Until (exclusive)" : "To"}</Box>
            <BoundInput kind={kind} value={to} time={time} label={`${label} ${exclusive ? "until" : "to"}`} onChange={v => change(from, v, fromComplete)} onCompleteChange={toCompletion} /></Box>}
        {kind === "datetime" && <Box css={styles.hintRow}>
            {end?.success && !single && <Box css={styles.hint}>{exclusive ? "Until " : "Through "}{time ? words.dateTime(end.value) : words.weekdayDate(end.value)}{exclusive ? " (excluded)" : ""}</Box>}
            <Button size="xs" variant="ghost" aria-pressed={time} onClick={() => {
                edited.current = true; setTime(!time);
                if (time) {
                    const midnight = (text: string) => { const parsed = READ.datetime(text); if (!parsed.success) return text; parsed.value.setUTCHours(0, 0, 0, 0); return PRINT.datetime(parsed.value); };
                    const start = midnight(from);
                    change(start, single ? start : periodEnd(start, period, exclusive) ?? midnight(to), fromComplete && (single || toComplete));
                }
            }}>Include time</Button>
        </Box>}
        {proposed?.hint && <Box css={styles.hint}>{proposed.hint}</Box>}
        {!complete && <Box css={styles.hint}>Enter {single ? "a valid value" : exclusive ? "valid bounds with From before Until" : "valid bounds with From at or before To"}.</Box>}
        <SliceFieldActions label={label} {...(onClear === undefined ? {} : { onClear })}
            {...(clearDisabled === undefined ? {} : { clearDisabled })}
            {...(immediate ? {} : { onApply: () => onApply(from, to), applyDisabled: !complete || proposed?.disabled === true })} />
    </Box>;
}
