/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `FieldForm` (#1147) — the typed form over an East struct that a builder's
 * inspector shows. east-ui's `Fields.specs(R, hints)` resolves a struct's
 * fields and hints into specs, and this draws each one with the form
 * renderers this package already has: the shared `Field` — its label, its key
 * (the field's path, as the field's `schemaKey`) and its help line — around
 * the shared input the field's East type takes, told by East's `isTypeEqual`.
 * Each edit comes back as the field's path and its new value, typed as the
 * field.
 *
 * | Editor | Input |
 * |---|---|
 * | `text` | `StringInput` |
 * | `number` | `IntegerInput` or `FloatInput`, by the field's type: moved by its step, clamped to its bounds, its unit and bounds in the help line |
 * | `checkbox` | `Checkbox` |
 * | `datetime` | `DateTimeInput` |
 * | `select` | `Select` of the variant's cases |
 * | `reference` | `Select` of the host's choices for its keyed set, Unassigned first for an Option |
 * | `tags` | `TagsInput`, its options suggested; a Set field's values held once, in East's order |
 * | `checklist` | a `StringInput` adding an item on Enter, the items done of all in the help line, and a `Checkbox` per item, labelled with its text, each with its remove |
 * | `readonly` | the value printed, in a read-only `StringInput` |
 *
 * What is typed — a text, a number, a date — is one edit when the focus
 * leaves the field, or on Enter, as typing in a cell is; Esc puts it back. A
 * choice is an edit at once. An Option's text is emptied to none, and its
 * select or reference set to none by choosing Not set or Unassigned; any other
 * Option has a Clear beside it, and a Set while it holds none. A field with
 * no value yet — a draft's field not given, whatever its type — shows Not
 * set: a text empty, a select or a reference with nothing chosen, any other
 * with a Set beside it (#1188). A date's input takes its editor's precision.
 * A field that differs from `baseline` — what the drafts began from — is
 * tinted. A nested struct's fields sit under its name. Read-only, every field
 * is printed, and tags and a checklist keep their shape without their
 * controls. A host may draw a field's control itself (`renderControl`), what
 * no input shows — the field keeps its label, key and help line.
 *
 * It is a React part for renderers, as `BuilderFrame` is: no East component.
 * Each input's payload is East's `defaultValue` of its type with the field's
 * parts set; the `fieldForm` recipe lays the fields out and tints a changed
 * one; the form sets data attributes (`data-field`, `data-editor`,
 * `data-dirty`) and geometry only.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import {
    ArrayType, BooleanType, DateTimeType, FloatType, IntegerType, NullType, SetType, StringType,
    SortedSet, compareFor, defaultValue, equalFor, fromEastTypeValue, isTypeEqual, none, printFor, some, variant,
    type EastType, type StructType, type ValueTypeOf, type option,
} from "@elaraai/east";
import {
    Checkbox, Field, FieldEditorType, Input, Select, TagsInput, spellOut, type FieldEditorValue, type FieldSpecValue,
} from "@elaraai/east-ui/internal";
import { getSomeorUndefined } from "../../utils";
import { useFormatters } from "../../format/index.js";
import { useValueSync } from "../../hooks/useValueSync.js";
import { EastChakraField, type FieldValue } from "../field/index.js";
import { EastChakraCheckbox } from "../checkbox/index.js";
import { fieldFormMessages, type FieldFormWords } from "./messages.js";

export { fieldFormMessages, type FieldFormMessages, type FieldFormWords } from "./messages.js";

type Styles = Record<string, SystemStyleObject>;

/** A field's control: one of the shared inputs, as the `Field` carries it. */
type Control = FieldValue["control"];

/** A number editor's hint. */
type NumberEditor = ValueTypeOf<typeof FieldEditorType.cases.number>;

/** One choice of a `reference` editor: a key of the keyed set, and what it shows. */
export interface FieldOption {
    /** The key the field holds. */
    readonly key: string;
    /** What the select shows for it. */
    readonly label: string;
}

/** Props of {@link FieldForm}. */
export interface FieldFormProps {
    /** The fields, as `Fields.specs` resolved them. */
    specs: readonly FieldSpecValue[];
    /** The struct the form edits — a decoded value of the struct the specs were resolved over; a field it holds no value for (`undefined`) shows Not set. */
    value: unknown;
    /** What the drafts began from: a field that differs from it is tinted. */
    baseline?: unknown;
    /** The host's choices for each `reference` editor, by the keyed set it names (`of`). */
    options?: Readonly<Record<string, readonly FieldOption[]>> | undefined;
    /** Told each edit: the field's path, and its new value, typed as the field — an Option's `some` or `none`. */
    onChange: (path: readonly string[], value: unknown) => void;
    /** Prints every value, and takes no edit. */
    readOnly?: boolean | undefined;
    /** The form's words: the host's, else English in the app's locale. */
    words?: FieldFormWords | undefined;
    /**
     * Draws a field's control itself, in place of the input its editor takes —
     * what no input shows (a sheet's link chips, #1188); the field keeps its
     * label, key and help line. `undefined` for a field the form draws. Keep it
     * stable (`useCallback`): each field's memo compares it.
     */
    renderControl?: ((spec: FieldSpecValue) => ReactNode | undefined) | undefined;
}

// Each shared input's payload with nothing set: East's default for its type.
const FIELD = defaultValue<typeof Field.Types.Field>(Field.Types.Field);
const FIELD_STYLE = defaultValue<typeof Field.Types.Field.fields.style.cases.some>(Field.Types.Field.fields.style.cases.some);
const STRING_INPUT = defaultValue<typeof Input.Types.String>(Input.Types.String);
const INTEGER_INPUT = defaultValue<typeof Input.Types.Integer>(Input.Types.Integer);
const FLOAT_INPUT = defaultValue<typeof Input.Types.Float>(Input.Types.Float);
const DATETIME_INPUT = defaultValue<typeof Input.Types.DateTime>(Input.Types.DateTime);
const CHECKBOX = defaultValue<typeof Checkbox.Types.Checkbox>(Checkbox.Types.Checkbox);
const SELECT = defaultValue<typeof Select.Types.Root>(Select.Types.Root);
const TAGS = defaultValue<typeof TagsInput.Types.Root>(TagsInput.Types.Root);

/** The inputs' size in a form: Studio's inspector's. */
const SMALL = some(variant("sm", null));
const INPUT_STYLE = some({ ...defaultValue<typeof Input.Types.Style>(Input.Types.Style), size: SMALL });
const SELECT_STYLE = some({ ...defaultValue<typeof Select.Types.Root.fields.style.cases.some>(Select.Types.Root.fields.style.cases.some), size: SMALL });
const TAGS_STYLE = some({ ...defaultValue<typeof TagsInput.Types.Style>(TagsInput.Types.Style), size: SMALL });

const stringEqual = equalFor(StringType);
const compareStrings = compareFor(StringType);
const compareIntegers = compareFor(IntegerType);
const compareFloats = compareFor(FloatType);

/** A select's choice for none — no case or key can be it. */
const NONE_CHOICE = "\u0000none";

const NO_OPTIONS: Readonly<Record<string, readonly FieldOption[]>> = {};

/**
 * A field's value, read along its path from the struct the form edits.
 *
 * @param value - The struct
 * @param path - The field's names, from the struct down
 * @returns The field's value, or `undefined` where the struct holds none
 */
function valueAt(value: unknown, path: readonly string[]): unknown {
    let at: unknown = value;
    for (const name of path) at = at === undefined || at === null ? undefined : (at as Record<string, unknown>)[name];
    return at;
}

/** The specs in runs of one group, in order. */
function sectionsOf(specs: readonly FieldSpecValue[]): { group: string | undefined; specs: FieldSpecValue[] }[] {
    const out: { group: string | undefined; specs: FieldSpecValue[] }[] = [];
    for (const spec of specs) {
        const group = getSomeorUndefined(spec.group);
        const last = out[out.length - 1];
        if (last !== undefined && (last.group === undefined ? group === undefined : group !== undefined && stringEqual(last.group, group))) last.specs.push(spec);
        else out.push({ group, specs: [spec] });
    }
    return out;
}

/** Whether a type is a variant whose every case is empty — a choice among names. */
function isEmptyCases(type: EastType): boolean {
    return type.type === "Variant" && Object.values(type.cases as Record<string, EastType>).every((t) => isTypeEqual(t, NullType));
}

/**
 * A number held to its editor's bounds: an Integer's as bigints, a Float's as
 * numbers, compared by East.
 *
 * @param editor - The number editor's hint
 * @param integer - Whether the field is an Integer
 * @returns The clamp
 */
function clampOf(editor: NumberEditor, integer: boolean): (n: bigint | number) => bigint | number {
    const min = getSomeorUndefined(editor.min);
    const max = getSomeorUndefined(editor.max);
    if (integer) {
        const lo = min === undefined ? undefined : BigInt(Math.ceil(min));
        const hi = max === undefined ? undefined : BigInt(Math.floor(max));
        return (n) => {
            let i = n as bigint;
            if (lo !== undefined && compareIntegers(i, lo) < 0) i = lo;
            if (hi !== undefined && compareIntegers(i, hi) > 0) i = hi;
            return i;
        };
    }
    return (n) => {
        let f = n as number;
        if (min !== undefined && compareFloats(f, min) < 0) f = min;
        if (max !== undefined && compareFloats(f, max) > 0) f = max;
        return f;
    };
}

/** A number editor's help line — `1–20 people · step 1` — in the form's words and its locale's figures, or none for a bare number. */
function numberLine(editor: NumberEditor, words: FieldFormWords): string | undefined {
    const min = getSomeorUndefined(editor.min);
    const max = getSomeorUndefined(editor.max);
    const unit = getSomeorUndefined(editor.unit);
    const step = getSomeorUndefined(editor.step);
    if (min === undefined && max === undefined && unit === undefined && step === undefined) return undefined;
    return words.m.numberHelp({
        min: min === undefined ? undefined : words.number(min),
        max: max === undefined ? undefined : words.number(max),
        unit,
        step: step === undefined ? undefined : words.number(step),
    });
}

/**
 * What an empty Option starts from when it is set: East's default for its
 * type, held to a number's bounds — and for a date, this minute.
 */
function startOf(inner: EastType, editor: FieldEditorValue): unknown {
    if (isTypeEqual(inner, DateTimeType)) return new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const start = defaultValue<EastType>(inner) as unknown;
    if (editor.type === "number") return clampOf(editor.value, isTypeEqual(inner, IntegerType))(start as bigint | number);
    return start;
}

/**
 * A value printed for a person: a reference by its choice's words, a case by
 * its select's, a String as itself, a number and a date in the locale's
 * figures, a Boolean in words, a name list joined; anything else as East
 * prints it. No value is shown as absent.
 */
function printOf(
    type: EastType, value: unknown, editor: FieldEditorValue,
    options: Readonly<Record<string, readonly FieldOption[]>>, words: FieldFormWords,
): string {
    if (value === undefined) return words.m.noValue();
    if (editor.type === "reference") {
        return options[editor.value.of]?.find((o) => stringEqual(o.key, value as string))?.label ?? (value as string);
    }
    if (editor.type === "select") {
        const tag = (value as variant).type as string;
        return editor.value.find((o) => stringEqual(o.case, tag))?.label ?? spellOut(tag);
    }
    if (isTypeEqual(type, StringType)) return value as string;
    if (isTypeEqual(type, IntegerType) || isTypeEqual(type, FloatType)) return words.number(value as bigint | number);
    if (isTypeEqual(type, BooleanType)) return words.m.yesNo({ value: value as boolean });
    if (isTypeEqual(type, DateTimeType)) return words.dateTime(value as Date);
    if (isEmptyCases(type)) return spellOut((value as variant).type as string);
    if (isTypeEqual(type, SetType(StringType)) || isTypeEqual(type, ArrayType(StringType))) return [...(value as Iterable<string>)].join(", ");
    return printFor(type)(value as never);
}

/**
 * Renders a typed form over an East struct, each field the shared `Field`
 * around the shared input its type takes — see the module docs.
 *
 * @param props - The specs, the struct and its baseline, the host's choices, where an edit goes, and the words ({@link FieldFormProps})
 * @returns The form
 * @example
 * ```tsx
 * import { IntegerType, OptionType, StringType, StructType } from "@elaraai/east";
 * import { Fields } from "@elaraai/east-ui";
 * import { FieldForm } from "@elaraai/east-ui-components";
 *
 * const Job = StructType({ task: StringType, crew: IntegerType, bay: OptionType(StringType) });
 * const specs = Fields.specs(Job, { crew: Fields.number({ unit: "people", min: 1n }), bay: Fields.reference({ of: "bays" }) });
 *
 * <FieldForm
 *     specs={specs}
 *     value={job}
 *     baseline={committed}
 *     options={{ bays: [{ key: "B1", label: "Bay 1" }, { key: "B2", label: "Bay 2" }] }}
 *     onChange={(path, value) => draft(path, value)}
 * />
 * ```
 */
export const FieldForm = memo(function FieldForm({ specs, value, baseline, options = NO_OPTIONS, onChange, readOnly = false, words, renderControl }: FieldFormProps) {
    const styles = useSlotRecipe({ key: "fieldForm" })() as Styles;
    const formatters = useFormatters();
    const said = useMemo((): FieldFormWords => words ?? { ...formatters, m: fieldFormMessages }, [words, formatters]);
    const sections = useMemo(() => sectionsOf(specs), [specs]);
    const row = (spec: FieldSpecValue) => (
        <FieldRow key={spec.path.join("\u001f")} spec={spec} current={valueAt(value, spec.path)}
            base={baseline === undefined ? undefined : valueAt(baseline, spec.path)} hasBaseline={baseline !== undefined}
            options={options} onChange={onChange} readOnly={readOnly} words={said} styles={styles} renderControl={renderControl} />
    );
    return (
        <Box css={styles.root} data-field-form="">
            {sections.map((section) => (section.group === undefined ? section.specs.map(row) : (
                <Box key={`group\u001f${section.group}`} css={styles.group} role="group" aria-label={section.group} data-field-group={section.group}>
                    <Box as="span" css={styles.groupHead}>{section.group}</Box>
                    {section.specs.map(row)}
                </Box>
            )))}
        </Box>
    );
});

/** Props of {@link FieldRow}. */
interface FieldRowProps {
    spec: FieldSpecValue;
    current: unknown;
    base: unknown;
    hasBaseline: boolean;
    options: Readonly<Record<string, readonly FieldOption[]>>;
    onChange: (path: readonly string[], value: unknown) => void;
    readOnly: boolean;
    words: FieldFormWords;
    styles: Styles;
    renderControl: FieldFormProps["renderControl"];
}

/** One field: the shared `Field` around its input, a checklist's items, and an Option's Set or Clear. */
const FieldRow = memo(function FieldRow({ spec, current, base, hasBaseline, options, onChange, readOnly, words, styles, renderControl }: FieldRowProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const iconButton = useRecipe({ key: "iconButton" });
    const type = useMemo(() => fromEastTypeValue(spec.type) as EastType, [spec.type]);
    // Two values of the field, either of them none yet (a draft's field not given).
    const same = useMemo(() => {
        const equal = equalFor(type);
        return (a: unknown, b: unknown) => (a === undefined || b === undefined ? a === b : equal(a, b));
    }, [type]);
    // An Option's input edits its value's type; `none` is no value.
    const inner = useMemo(() => (spec.optional && type.type === "Variant" ? (type.cases as Record<string, EastType>)["some"]! : type), [spec.optional, type]);
    const held = spec.optional ? getSomeorUndefined(current as option<unknown>) : current;
    const dirty = hasBaseline && !same(current, base);
    const key = spec.path.join(".");
    const editor = spec.editor;
    // A control the host draws itself, in the field.
    const own = renderControl?.(spec);
    // Read-only, a value is printed; tags and a checklist keep their shape.
    const printed = editor.type === "readonly" || (readOnly && editor.type !== "tags" && editor.type !== "checklist");

    // One edit of the field: its value, `undefined` being an Option's none.
    const emit = useCallback((next: unknown) => {
        const out = spec.optional ? (next === undefined ? none : some(next)) : next;
        if (same(out, current)) return;
        onChange(spec.path, out);
    }, [spec.optional, spec.path, same, current, onChange]);

    // A typed edit waits for the focus to leave the field, or Enter; Esc drops
    // it. A new value from the host drops it too: the input shows that one.
    const pending = useRef<{ value: unknown } | undefined>(undefined);
    const [revision, setRevision] = useState(0);
    useValueSync(current, same, () => { pending.current = undefined; });
    const hold = useCallback((next: unknown) => { pending.current = { value: next }; }, []);
    const commit = useCallback(() => {
        const edit = pending.current;
        if (edit === undefined) return;
        pending.current = undefined;
        emit(edit.value);
    }, [emit]);

    // A checklist: its items, and the item typed into its box.
    const checklist = own === undefined && editor.type === "checklist" ? editor.value : undefined;
    const items = (checklist === undefined || held === undefined ? [] : held) as readonly Record<string, unknown>[];
    const done = checklist === undefined ? 0 : items.filter((item) => item[checklist.done] as boolean).length;
    const typed = useRef("");
    const fieldRef = useRef<HTMLDivElement | null>(null);
    const addItem = () => {
        if (checklist === undefined || inner.type !== "Array") return;
        const text = typed.current.trim();
        if (text.length === 0) return;
        typed.current = "";
        const item = { ...(defaultValue<StructType>(inner.value as StructType) as Record<string, unknown>), [checklist.text]: text, [checklist.done]: false };
        emit([...items, item]);
        setRevision((r) => r + 1);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
            // Each after the input's own change, which it hands on in a microtask.
            if (checklist !== undefined) {
                if (fieldRef.current?.contains(e.target as Node)) {
                    e.preventDefault();
                    queueMicrotask(addItem);
                }
                return;
            }
            if (pending.current !== undefined) queueMicrotask(commit);
        } else if (e.key === "Escape" && pending.current !== undefined) {
            pending.current = undefined;
            setRevision((r) => r + 1);
        }
    };
    const onBlur = (e: FocusEvent<HTMLDivElement>) => {
        const to = e.relatedTarget;
        if (to !== null && e.currentTarget.contains(to as Node)) return;
        queueMicrotask(commit);
    };

    const control = ((): Control => {
        const printedValue = (text: string): Control => variant("StringInput", { ...STRING_INPUT, value: text, style: INPUT_STYLE });
        if (printed || own !== undefined) return printedValue(printOf(inner, held, editor, options, words));
        // No value — an empty Option, or a draft's field not given — in an input that cannot show none: Set gives it one.
        if (held === undefined && editor.type !== "text" && editor.type !== "select" && editor.type !== "reference") {
            return variant("StringInput", { ...STRING_INPUT, placeholder: some(m.notSet()), disabled: some(true), style: INPUT_STYLE });
        }
        switch (editor.type) {
            case "text": {
                const placeholder = getSomeorUndefined(editor.value.placeholder) ?? (spec.optional || held === undefined ? m.notSet() : undefined);
                return variant("StringInput", {
                    ...STRING_INPUT,
                    value: (held ?? "") as string,
                    placeholder: placeholder === undefined ? none : some(placeholder),
                    // An Option's emptied text is none.
                    onChange: some((next: string) => { hold(spec.optional && next.length === 0 ? undefined : next); return null; }),
                    style: INPUT_STYLE,
                });
            }
            case "number": {
                const number = editor.value;
                const min = getSomeorUndefined(number.min);
                const max = getSomeorUndefined(number.max);
                const step = getSomeorUndefined(number.step);
                if (isTypeEqual(inner, IntegerType)) {
                    const clamp = clampOf(number, true);
                    return variant("IntegerInput", {
                        ...INTEGER_INPUT,
                        value: held as bigint,
                        min: min === undefined ? none : some(BigInt(Math.ceil(min))),
                        max: max === undefined ? none : some(BigInt(Math.floor(max))),
                        step: step === undefined ? none : some(BigInt(Math.max(1, Math.round(step)))),
                        onChange: some((next: bigint) => { hold(clamp(next)); return null; }),
                        style: INPUT_STYLE,
                    });
                }
                const clamp = clampOf(number, false);
                return variant("FloatInput", {
                    ...FLOAT_INPUT,
                    value: held as number,
                    min: min === undefined ? none : some(min),
                    max: max === undefined ? none : some(max),
                    step: step === undefined ? none : some(step),
                    onChange: some((next: number) => { hold(clamp(next)); return null; }),
                    style: INPUT_STYLE,
                });
            }
            case "checkbox":
                return variant("Checkbox", { ...CHECKBOX, checked: held as boolean, onChange: some((next: boolean) => { emit(next); return null; }) });
            case "datetime":
                return variant("DateTimeInput", {
                    ...DATETIME_INPUT, value: held as Date, precision: editor.value.precision,
                    onChange: some((next: Date) => { hold(next); return null; }), style: INPUT_STYLE,
                });
            case "select":
                return variant("Select", {
                    ...SELECT,
                    value: held !== undefined ? some((held as variant).type as string) : spec.optional ? some(NONE_CHOICE) : none,
                    items: [
                        ...(spec.optional ? [{ value: NONE_CHOICE, label: m.notSet(), disabled: none }] : []),
                        ...editor.value.map((o) => ({ value: o.case, label: o.label, disabled: none })),
                    ],
                    onChange: some((next: string) => { emit(stringEqual(next, NONE_CHOICE) ? undefined : variant(next, null)); return null; }),
                    style: SELECT_STYLE,
                });
            case "reference": {
                const listed = options[editor.value.of] ?? [];
                const at = held as string | undefined;
                // A key the host does not list still shows, as itself.
                const unlisted = at !== undefined && !listed.some((o) => stringEqual(o.key, at));
                return variant("Select", {
                    ...SELECT,
                    value: at !== undefined ? some(at) : spec.optional ? some(NONE_CHOICE) : none,
                    items: [
                        ...(spec.optional ? [{ value: NONE_CHOICE, label: m.unassigned(), disabled: none }] : []),
                        ...listed.map((o) => ({ value: o.key, label: o.label, disabled: none })),
                        ...(unlisted ? [{ value: at, label: at.length === 0 ? m.noValue() : at, disabled: none }] : []),
                    ],
                    onChange: some((next: string) => { emit(stringEqual(next, NONE_CHOICE) ? undefined : next); return null; }),
                    style: SELECT_STYLE,
                });
            }
            case "tags": {
                const set = isTypeEqual(inner, SetType(StringType));
                return variant("TagsInput", {
                    ...TAGS,
                    value: [...(held as Iterable<string>)],
                    suggestions: editor.value.options.length === 0 ? none : some([...editor.value.options]),
                    placeholder: some(m.tagPlaceholder()),
                    readOnly: readOnly ? some(true) : none,
                    // A Set holds a value once, in East's order.
                    onChange: some((next: string[]) => { emit(set ? new SortedSet(next, compareStrings) : next); return null; }),
                    style: TAGS_STYLE,
                });
            }
            case "checklist":
                if (readOnly) return printedValue(m.checklistCount({ done: words.number(done), total: words.number(items.length) }));
                return variant("StringInput", {
                    ...STRING_INPUT,
                    placeholder: some(m.addItem()),
                    onChange: some((next: string) => { typed.current = next; return null; }),
                    style: INPUT_STYLE,
                });
        }
    })();

    const help = [
        getSomeorUndefined(spec.help),
        editor.type === "number" && !printed ? numberLine(editor.value, words) : undefined,
        checklist !== undefined && !readOnly && held !== undefined ? m.checklistCount({ done: words.number(done), total: words.number(items.length) }) : undefined,
    ].filter((part): part is string => part !== undefined && part.length > 0);
    const field: FieldValue = {
        ...FIELD,
        label: spec.label,
        control,
        helperText: help.length === 0 ? none : some(help.join(" · ")),
        readOnly: printed || readOnly ? some(true) : none,
        style: some({ ...FIELD_STYLE, schemaKey: some(key) }),
    };
    // Beside an input that cannot show none: Set while it holds no value, and an Option's Clear while it does.
    const side = own !== undefined || printed || readOnly || editor.type === "text" || editor.type === "select" || editor.type === "reference" ? undefined
        : held === undefined ? "set" : spec.optional ? "clear" : undefined;

    return (
        <Box css={styles.field} data-field={key} data-editor={own !== undefined ? "custom" : printed ? "readonly" : editor.type} data-dirty={dirty ? "" : undefined}
            onBlur={onBlur} onKeyDown={onKeyDown}>
            <Box css={styles.main}>
                <Box ref={fieldRef}>
                    <EastChakraField key={revision} value={field} storageKey={`fieldForm.${key}`} controlNode={own} />
                </Box>
                {checklist !== undefined && items.length > 0 && (
                    <Box css={styles.items} data-checklist-items="">
                        {items.map((item, i) => {
                            const text = item[checklist.text] as string;
                            return (
                                <Box key={i} css={styles.item} data-checklist-item="">
                                    <EastChakraCheckbox value={{
                                        ...CHECKBOX,
                                        checked: item[checklist.done] as boolean,
                                        label: some(text),
                                        disabled: readOnly ? some(true) : none,
                                        onChange: some((next: boolean) => {
                                            emit(items.map((it, j) => (j === i ? { ...it, [checklist.done]: next } : it)));
                                            return null;
                                        }),
                                    }} />
                                    {!readOnly && (
                                        <chakra.button type="button" css={iconButton({ variant: "ghost", size: "xs" })} aria-label={m.removeItem({ text })}
                                            title={m.removeItem({ text })} data-checklist-remove="" onClick={() => emit(items.filter((_item, j) => j !== i))}>
                                            <FontAwesomeIcon icon={faXmark} />
                                        </chakra.button>
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>
            {side !== undefined && (
                <Box css={styles.side}>
                    {side === "set" ? (
                        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-field-set=""
                            onClick={() => emit(startOf(inner, editor))}>
                            {m.set()}
                        </chakra.button>
                    ) : (
                        <chakra.button type="button" css={iconButton({ variant: "ghost", size: "xs" })} aria-label={m.clear({ label: spec.label })}
                            title={m.clear({ label: spec.label })} data-field-clear="" onClick={() => emit(undefined)}>
                            <FontAwesomeIcon icon={faXmark} />
                        </chakra.button>
                    )}
                </Box>
            )}
        </Box>
    );
});
