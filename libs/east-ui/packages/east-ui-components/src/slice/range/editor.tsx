/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Box, Button, useSlotRecipe } from "@chakra-ui/react";
import { CalendarDateTime } from "@internationalized/date";
import { DateTimeType, IntegerType, FloatType, compareFor, defaultValue, parseFor, printFor, some, variant } from "@elaraai/east";
import { Input } from "@elaraai/east-ui/internal";
import { EastChakraIntegerInput, EastChakraFloatInput } from "../../forms/input/index.js";
import { CompoundDateField, CompoundDateInput, CompoundDateSegment } from "../../forms/input/date/index.js";

export type SliceRangeKind = "datetime" | "integer" | "float";
const READ = { datetime: parseFor(DateTimeType), integer: parseFor(IntegerType), float: parseFor(FloatType) };
const PRINT = { datetime: printFor(DateTimeType), integer: printFor(IntegerType), float: printFor(FloatType) };
const dateEqual = compareFor(DateTimeType);
const integerEqual = compareFor(IntegerType);
const floatEqual = compareFor(FloatType);

/** Typed bounds shared by local and record adapters; all text uses East's codecs. */
export interface SliceRangeEditorProps {
    kind: SliceRangeKind; from: string; to: string; label: string;
    single?: boolean; exclusive?: boolean; immediate?: boolean;
    onApply: (from: string, to: string) => void;
    children?: ReactNode;
    proposal?: (from: string, to: string) => { hint?: string; disabled: boolean } | undefined;
}

/** Render a typed bound using existing numeric inputs or the shared date field. */
function BoundInput({ kind, value, label, onChange, onCompleteChange }: { kind: SliceRangeKind; value: string; label: string; onChange: (text: string) => void; onCompleteChange: (complete: boolean) => void }) {
    const dateStyles = useSlotRecipe({ key: "dateField" })({ size: "sm" });
    // Stable while a segment is incomplete: a fresh CalendarDateTime would
    // reset React Aria's draft whenever completeness changes in the parent.
    const date = useMemo(() => {
        const read = kind === "datetime" ? READ.datetime(value) : undefined;
        const d = read?.success ? read.value : undefined;
        return d === undefined ? undefined : new CalendarDateTime(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(),
            d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
    }, [kind, value]);
    useEffect(() => { if (kind !== "datetime") onCompleteChange(true); }, [kind, onCompleteChange]);
    if (kind === "datetime") {
        return <Box css={dateStyles.shell}><CompoundDateField size="sm" aria-label={label}
            {...(date === undefined ? {} : { value: date })} granularity="second" hourCycle={24} onCompleteChange={onCompleteChange}
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
    immediate = false, onApply, children, proposal }: SliceRangeEditorProps) {
    const styles = useSlotRecipe({ key: "sliceEdit" })();
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialTo);
    const [fromComplete, setFromComplete] = useState(true);
    const [toComplete, setToComplete] = useState(true);
    useEffect(() => { setFrom(initialFrom); setTo(initialTo); }, [initialFrom, initialTo]);
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
    const change = (a: string, b: string, otherComplete: boolean) => { setFrom(a); setTo(b); if (immediate && otherComplete && valid(a, b) && !proposal?.(a, b)?.disabled) onApply(a, b); };
    const proposed = complete ? proposal?.(from, to) : undefined;
    return <Box css={styles.choiceList}>
        {children}
        <Box css={styles.field}><Box as="span" css={styles.fieldLabel}>{single ? "Value" : "From"}</Box>
            <BoundInput kind={kind} value={from} label={`${label} ${single ? "value" : "from"}`} onChange={v => change(v, to, single || toComplete)} onCompleteChange={setFromComplete} /></Box>
        {!single && <Box css={styles.field}><Box as="span" css={styles.fieldLabel}>{exclusive ? "Until (exclusive)" : "To"}</Box>
            <BoundInput kind={kind} value={to} label={`${label} ${exclusive ? "until" : "to"}`} onChange={v => change(from, v, fromComplete)} onCompleteChange={setToComplete} /></Box>}
        {proposed?.hint && <Box css={styles.hint}>{proposed.hint}</Box>}
        {!complete && <Box css={styles.hint}>Enter {single ? "a valid value" : exclusive ? "valid bounds with From before Until" : "valid bounds with From at or before To"}.</Box>}
        {!immediate && <Box css={styles.controlRow}><Button size="xs" variant="solid" disabled={!complete || proposed?.disabled}
            onClick={() => onApply(from, to)}>Apply</Button></Box>}
    </Box>;
}
