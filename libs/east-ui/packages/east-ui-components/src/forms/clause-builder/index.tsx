/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `ClauseBuilder` — the shared field → operator → value authoring row.
 *
 * One primitive behind every clause-building surface: Slice.Edit's filter /
 * cohort builders and the decision judgement panel's constraint inject. The
 * consumer supplies the field vocabulary and the per-kind operator set; the
 * builder owns control composition — the real `EastChakraSelect` for field /
 * operator / boolean, the typed `forms/input` renderers for values (so
 * parsing to the correct East type happens natively), `TagsInput` for
 * set-valued ops, and a min – max pair for range ops. Control size follows
 * the density cascade (`condensed`/`compact` → `sm`, `comfortable` → `md`)
 * unless overridden.
 *
 * `ClauseChip` renders an authored clause back as the compact
 * field · op · value chip, so authored clauses read identically everywhere.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe } from "@chakra-ui/react";
import { some, none, variant, isEastSet } from "@elaraai/east";
import { useDensity } from "../../contracts/density.js";
import { useContainerBelow } from "../../contracts/adaptive.js";
import { EastChakraSelect } from "../select/index.js";
import { EastChakraStringInput, EastChakraIntegerInput, EastChakraFloatInput, EastChakraDateTimeInput } from "../input/index.js";
import { EastChakraTagsInput } from "../tags-input/index.js";

/** The primitive kinds a clause field can have. */
export type ClauseKind = "string" | "integer" | "float" | "datetime" | "boolean";

/** One authorable field: id (the clause's subject), display label, kind, and
 *  optional autocomplete hints for the set / string value controls (#131). */
export interface ClauseFieldSpec {
    readonly id: string;
    readonly label: string;
    readonly kind: ClauseKind;
    readonly hints?: readonly string[];
}

/** One operator choice: `tag` identifies it, `glyph` is the label, `input`
 *  picks the value control (`single` default; `set` → TagsInput; `range` →
 *  min – max pair; `none` → no value control). */
export interface ClauseOpSpec {
    readonly tag: string;
    readonly glyph: string;
    readonly input?: "single" | "set" | "range" | "none";
}

/** An authored clause handed to `onSubmit`. `value` is the typed value the
 *  control produced: `string`/`bigint`/`number`/`Date`/`boolean` for single,
 *  `string[]` for set, `{ min, max }` for range, `null` for none. */
export interface ClauseSubmitValue {
    readonly fieldId: string;
    readonly kind: ClauseKind;
    readonly op: string;
    readonly value: unknown;
}

export interface ClauseBuilderProps {
    fields: ReadonlyArray<ClauseFieldSpec>;
    /** Operator choices per kind. */
    opsFor: (kind: ClauseKind) => ReadonlyArray<ClauseOpSpec>;
    onSubmit: (clause: ClauseSubmitValue) => void;
    /** Seed the form (edit mode) — field/op/value prefilled. */
    initial?: { fieldId: string; op: string; value: unknown };
    /** Lock the field to the seeded one (edit changes op / value, not field). */
    lockField?: boolean;
    /** Submit-button label (default `Add`). */
    submitLabel?: string;
    /** Control size override; defaults from the density cascade. */
    size?: "sm" | "md";
}

const sizeVariant = (size: "sm" | "md") => some({ size: some(variant(size, null)) });

/** Fabricate a decoded `Select` payload for the shared select renderer —
 *  the same trick the typed inputs use (decoded-value shape, JS callbacks). */
function selectValue(
    val: string,
    items: ReadonlyArray<{ value: string; label: string }>,
    onChange: (v: string) => void,
    size: "sm" | "md",
): never {
    return {
        value: some(val),
        items: items.map(i => ({ value: i.value, label: i.label, disabled: none })),
        placeholder: none,
        multiple: none,
        disabled: none,
        onChange: some(onChange),
        onChangeMultiple: none,
        onOpenChange: none,
        style: sizeVariant(size),
    } as never;
}

/** A set-op value merged with the TagsInput's in-flight text (#194): text a
 *  user typed or picked from the suggestions but never Enter-committed into a
 *  tag still counts — validity and submit both see it. */
function withPending(tags: unknown, pending: string): unknown[] {
    const arr = tags as unknown[];
    const p = pending.trim();
    return p !== "" ? [...arr, p] : arr;
}

function emptyValue(kind: ClauseKind, input: ClauseOpSpec["input"]): unknown {
    if (input === "set") return [] as string[];
    if (input === "none") return null;
    if (input === "range") {
        if (kind === "integer") return { min: 0n, max: 0n };
        if (kind === "datetime") return { min: new Date(), max: new Date() };
        return { min: 0, max: 0 };
    }
    if (kind === "integer") return 0n;
    if (kind === "float") return 0;
    if (kind === "datetime") return new Date();
    if (kind === "boolean") return false;
    return "";
}

/**
 * Why the in-progress value cannot produce a meaningful clause, or `undefined`
 * when it can. Drives the submit button's `disabled` + the inline hint so a
 * click is never a silent no-op (#164). Values here are the raw JS values the
 * controls produce (string / bigint / number / Date / string[] / {min,max}),
 * not decoded East values.
 */
function invalidReason(kind: ClauseKind, input: ClauseOpSpec["input"], value: unknown): string | undefined {
    if (input === "none") return undefined;
    if (input === "set") {
        // Entries are strings from the TagsInput, but an edit seed may carry
        // typed members (bigints from an integer in-set) — stringify, never
        // assume (`bigint.trim` is not a function).
        const entries = (value as unknown[]).map(s => String(s).trim()).filter(Boolean);
        if (entries.length === 0) return "Enter at least one value.";
        if (kind === "integer" && !entries.some(e => { try { BigInt(e); return true; } catch { return false; } })) {
            return "Enter at least one whole number.";
        }
        return undefined;
    }
    if (input === "range") {
        const { min, max } = value as { min: unknown; max: unknown };
        const inverted = min instanceof Date && max instanceof Date
            ? min.getTime() > max.getTime()
            : (typeof min === "bigint" && typeof max === "bigint") || (typeof min === "number" && typeof max === "number")
                ? min > max
                : false;
        return inverted ? "Start must not exceed end." : undefined;
    }
    if (kind === "string" && String(value ?? "").trim() === "") return "Enter a value.";
    return undefined;
}

export function ClauseBuilder({ fields, opsFor, onSubmit, initial, lockField, submitLabel, size }: ClauseBuilderProps) {
    const styles = useSlotRecipe({ key: "clauseBuilder" })();
    const btn = useRecipe({ key: "button" });
    const density = useDensity();
    const controlSize = size ?? (density === "comfortable" ? "md" : "sm");
    const inputStyle = sizeVariant(controlSize);

    // Compact containers (#348): the 4-track inline grid squeezes below
    // ~480px — fall back to the existing #193 stacked layout instead.
    const rowRef = useRef<HTMLDivElement | null>(null);
    const compact = useContainerBelow(rowRef, 480);

    const [fieldId, setFieldId] = useState(initial?.fieldId ?? fields[0]?.id ?? "");
    const field = fields.find(f => f.id === fieldId) ?? fields[0];
    const kind: ClauseKind = field?.kind ?? "string";
    const ops = opsFor(kind);
    const [opTag, setOpTag] = useState(initial?.op ?? ops[0]?.tag ?? "");
    const op = ops.find(o => o.tag === opTag) ?? ops[0];
    const input = op?.input ?? "single";

    // The value control owns its in-progress state (the interactive-state
    // pattern); the builder only collects commits in a ref. Keeping the
    // control's payload identity-stable per field/op (and remounting on
    // field/op change via `key`) means typing never round-trips through a
    // parent re-render — which would reset the control mid-edit.
    // A Set seed becomes the TagsInput's string entries regardless of member
    // type (bigints round-trip back through the consumer's submit conversion).
    const seedValue = initial !== undefined
        ? (isEastSet(initial.value) ? [...initial.value].map(v => String(v)) : initial.value)
        : emptyValue(kind, input);
    const valRef = useRef<unknown>(seedValue);
    // Validity mirrors valRef for the submit button + hint. Commits call
    // setReason with a recomputed string; React bails identical values, so
    // keystrokes only re-render when validity actually flips (#164).
    const [reason, setReason] = useState<string | undefined>(() => invalidReason(kind, input, seedValue));
    // In-flight TagsInput text (#194) — a suggestion pick or plain typing sets
    // the input's TEXT, and Zag only converts text→tag on Enter/comma; the
    // pending text must still count toward validity and submit.
    const pendingRef = useRef("");
    const controlKey = `${fieldId}:${op?.tag ?? ""}`;
    const prevKeyRef = useRef(controlKey);
    if (prevKeyRef.current !== controlKey) {
        prevKeyRef.current = controlKey;
        valRef.current = emptyValue(kind, input);
        pendingRef.current = "";
        setReason(invalidReason(kind, input, valRef.current));
    }
    const commit = useCallback((next: unknown) => {
        valRef.current = next;
        setReason(invalidReason(kind, input, input === "set" ? withPending(next, pendingRef.current) : next));
    }, [kind, input]);
    const commitPending = useCallback((text: string) => {
        pendingRef.current = text;
        setReason(invalidReason(kind, input, withPending(valRef.current, text)));
    }, [kind, input]);

    const onFieldChange = (nextId: string) => {
        const nextKind = fields.find(f => f.id === nextId)?.kind ?? "string";
        setFieldId(nextId);
        setOpTag(opsFor(nextKind)[0]?.tag ?? "");
    };
    const onOpChange = (nextTag: string) => {
        setOpTag(nextTag);
    };

    const submit = () => {
        if (field === undefined || op === undefined) return;
        const effective = input === "set" ? withPending(valRef.current, pendingRef.current) : valRef.current;
        // The button is disabled while invalid; this guard is the backstop.
        if (invalidReason(kind, input, effective) !== undefined) return;
        let value: unknown = effective;
        if (input === "set") {
            value = [...new Set((effective as unknown[]).map(s => String(s).trim()).filter(Boolean))];
        }
        onSubmit({ fieldId: field.id, kind, op: op.tag, value });
    };

    // Stable per-(field, op) payloads for the typed value controls — built
    // once per remount key, so keystroke commits never recreate them. Range
    // controls take their OWN bound (`v.min` / `v.max`) and a distinct key —
    // feeding the whole `{min,max}` object to a date field is an Invalid
    // Date crash, and sibling controls sharing one key collide.
    const controls = useMemo(() => {
        const v = valRef.current;
        const single = (keySuffix: string, val: unknown, onChange: (next: unknown) => void): ReactNode => {
            const key = `${controlKey}${keySuffix}`;
            switch (kind) {
                case "integer":
                    return <EastChakraIntegerInput key={key} value={{ value: val as bigint, onChange: some(onChange), style: inputStyle } as never} />;
                case "float":
                    return <EastChakraFloatInput key={key} value={{ value: val as number, onChange: some(onChange), style: inputStyle } as never} />;
                case "datetime":
                    // Date precision (#196): clause chips format date-only and
                    // day-grained filtering is the norm — the time segments
                    // were pure width pressure in the popover. (The Range
                    // picker's Custom inputs keep full datetime precision.)
                    return <EastChakraDateTimeInput key={key} value={{ value: val as Date, precision: some(variant("date", null)), onChange: some(onChange), style: inputStyle } as never} />;
                default:
                    return <EastChakraStringInput key={key} value={{ value: String(val ?? ""), onChange: some(onChange), style: inputStyle } as never} />;
            }
        };
        const range = v as { min?: unknown; max?: unknown } | undefined;
        return {
            single: single("", v, next => { commit(next); }),
            rangeMin: single(":min", range?.min, next => { commit({ ...(valRef.current as object), min: next }); }),
            rangeMax: single(":max", range?.max, next => { commit({ ...(valRef.current as object), max: next }); }),
        };
    }, [controlKey, kind, inputStyle, commit]);

    const fieldControl = lockField
        ? <Box as="span" css={styles.fieldLock} aria-label="Field">{field?.label}</Box>
        : (
            <EastChakraSelect
                ariaLabel="Field"
                value={selectValue(
                    fieldId,
                    fields.map(f => ({ value: f.id, label: f.label })),
                    onFieldChange,
                    controlSize,
                )}
            />
        );

    const opControl = (
        <EastChakraSelect
            ariaLabel="Operator"
            value={selectValue(
                op?.tag ?? "",
                ops.map(o => ({ value: o.tag, label: o.glyph })),
                onOpChange,
                controlSize,
            )}
        />
    );

    const valueControl: ReactNode = input === "none" ? null
        : kind === "boolean" ? (
            <EastChakraSelect
                key={controlKey}
                ariaLabel="Value"
                value={selectValue(
                    String(valRef.current),
                    [{ value: "true", label: "true" }, { value: "false", label: "false" }],
                    v => { commit(v === "true"); },
                    controlSize,
                )}
            />
        ) : input === "set" ? (
            <EastChakraTagsInput key={controlKey} value={{ value: valRef.current as string[], placeholder: some("a, b, c"), suggestions: field?.hints !== undefined && field.hints.length > 0 ? some([...field.hints]) : none, onChange: some((v: string[]) => { commit(v); }), onInputChange: some((s: string) => { commitPending(s); }), style: inputStyle } as never} />
        ) : input === "range" ? (
            <Box css={styles.rangeLine}>
                <Box css={styles.rangeBound}>{controls.rangeMin}</Box>
                <Box as="span" css={styles.rangeJoin}>–</Box>
                <Box css={styles.rangeBound}>{controls.rangeMax}</Box>
            </Box>
        ) : controls.single;

    // Disabled + inline hint while the value can't form a clause — a click is
    // never a silent no-op (#164). The hint mirrors the cohort-name grammar.
    const submitButton = (
        <chakra.button type="button" onClick={submit} disabled={reason !== undefined} css={btn({ variant: "solid", size: "xs" })}>
            {submitLabel ?? "Add"}
        </chakra.button>
    );
    const hint = reason !== undefined ? <Box as="span" css={styles.hint}>{reason}</Box> : null;

    // Intrinsically wide value controls stack on their own full-width line
    // (#193): set ops (a TagsInput grows with its values), range ops (two
    // bounds + join), and datetime singles (a segmented date input cannot
    // shrink into the inline grid's value track — it overflowed the popover).
    // The inline grid stays for the compact singles.
    if (input === "set" || input === "range" || kind === "datetime" || compact) {
        return (
            <Box ref={rowRef} css={styles.rowStacked} data-clause-stacked>
                <Box css={styles.stackControls}>
                    {fieldControl}
                    {opControl}
                </Box>
                {valueControl !== null && <Box css={styles.stackValue}>{valueControl}</Box>}
                {hint}
                <Box css={styles.stackSubmit}>{submitButton}</Box>
            </Box>
        );
    }
    return (
        <Box ref={rowRef} css={styles.row}>
            {fieldControl}
            {opControl}
            {valueControl ?? <Box />}
            {submitButton}
            {hint}
        </Box>
    );
}

export interface ClauseChipProps {
    field: string;
    op: string;
    value?: string;
}

/** Render an authored clause as the compact field · op · value chip. */
export function ClauseChip({ field, op, value }: ClauseChipProps) {
    const styles = useSlotRecipe({ key: "clauseBuilder" })();
    return (
        <Box as="span" css={styles.chip}>
            <Box as="span" css={styles.chipField}>{field}</Box>
            <Box as="span" css={styles.chipOp}>{op}</Box>
            {value !== undefined && <Box as="span" css={styles.chipVal}>{value}</Box>}
        </Box>
    );
}
