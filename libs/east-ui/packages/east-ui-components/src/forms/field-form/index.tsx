/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `FieldForm` (#1147) — the typed form over an East struct that a builder's
 * inspector shows. east-ui's `Fields.specs(R, hints)` resolves a struct's
 * fields and hints into specs, and this draws each one with the form
 * renderers this package already has: the shared `Field` — its label and its
 * help line, never its key, which is no word for the people a builder is for
 * — around the shared input the field's East type takes, told by East's
 * `isTypeEqual`.
 * Each edit comes back as the field's path and its new value, typed as the
 * field.
 *
 * | Editor | Input |
 * |---|---|
 * | `text` | `StringInput` |
 * | `number` | `IntegerInput` or `FloatInput`, by the field's type: moved by its step, clamped to its bounds, its unit and bounds in the help line |
 * | `checkbox` | `Checkbox` |
 * | `datetime` | `DateTimeInput` |
 * | `select` | `RadioGroup` of the variant's cases while it has up to four, Not set first for an Option (#1473); `Select` past four; a case holding data, its fields in a block under the choice |
 * | `reference` | `Select` of the host's choices for its keyed set, Unassigned first for an Option; a key held as its text — a String as itself, any other key as East prints it, read back at the field's type |
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
 * no input shows — the field keeps its label and help line.
 *
 * A variant whose cases hold data has a block under its choice (#1549): the
 * fields of the case it holds, which `Fields.specs` puts after the variant's
 * at paths through the case, drawn as the form's own — a block inside it for
 * a case holding a variant of its own; an empty case, the choice alone.
 * Choosing a case starts its value as an empty Option's starts when it is set,
 * a struct's fields each their own; choosing the case it holds is no edit. Its
 * choice is tinted when its case differs from the baseline's, and each of the
 * block's fields when it does. Read only, the choice prints its case's words
 * and the block its fields.
 *
 * Every field is one column (#1220): its label, its control's line and its
 * help line, the control filling the line and an Option's Set or Clear at its
 * end, centred on it. Each input is the design system's Input size, 32px, so
 * every kind lands on one line. A text, a choice or a printed value longer
 * than its box — a description, or a reference's long name, in a phone's
 * pane — ends in an ellipsis where the box cuts it, and its control carries
 * the whole as its title (#1250).
 *
 * A host may draw a field on one line instead (`lines`, #1534): its label at
 * the start, cut with an ellipsis and whole in its tooltip, and its choices at
 * the end as one line of radios, none checked while it holds no value — a
 * Record's cycle, toggle and boolean. A choice is an edit at once; read only,
 * the choice made is printed there. Its help line, where it has one — a
 * Record's mark's words (#1561) — sits under it, as a field's does, in the
 * shared `Field`'s style for help. Lines that follow one another sit closer
 * than fields do, rows of choices. A field an issue names (`issues`) takes the
 * warn wash around it, as a changed one takes the brand's; and the field a
 * host names (`focus`) takes the keyboard as it is named — a new row's title —
 * or, where a tab or a fold still hides the form, once it shows, kept in view
 * while a pane sliding open widens the form under it.
 *
 * It is a React part for renderers, as `BuilderFrame` is: no East component.
 * Each input's payload is East's `defaultValue` of its type with the field's
 * parts set; the `fieldForm` recipe lays the fields out and tints a changed
 * one; the form sets data attributes (`data-field`, `data-editor`,
 * `data-layout`, `data-dirty`, `data-issue`, `data-field-line`,
 * `data-field-side`, `data-field-block`, `data-field-help`), a text's or a
 * choice's title and geometry only; a line's help takes the `field` recipe's
 * help style.
 *
 * @packageDocumentation
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Box, chakra, useRecipe, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import {
    ArrayType, BooleanType, DateTimeType, FloatType, IntegerType, NullType, SetType, StringType,
    SortedSet, compareFor, defaultValue, equalFor, fromEastTypeValue, isTypeEqual, isVariant, none, parseFor, printFor, some, variant,
    type EastType, type StructType, type ValueTypeOf, type VariantType, type option,
} from "@elaraai/east";
import {
    Checkbox, Field, FieldEditorType, Input, RadioGroup, Select, TagsInput, spellOut, type FieldEditorValue, type FieldSpecValue,
} from "@elaraai/east-ui/internal";
import { EastChakraRadioGroup, type RadioGroupValue } from "../radio-group/index.js";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
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

/** One choice of a field drawn on one line ({@link FieldFormProps.lines}): a value of the field, and what its radio reads. */
export interface FieldLineChoice {
    /** The value it sets, of the field's type — an Option's, of its value's: a String field's key, a Boolean field's `true`. */
    readonly value: unknown;
    /** What its radio reads. */
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
     * label and help line. `undefined` for a field the form draws. Keep it
     * stable (`useCallback`): each field's memo compares it.
     */
    renderControl?: ((spec: FieldSpecValue) => ReactNode | undefined) | undefined;
    /**
     * Tell each typed edit as it is typed, not once the focus leaves the field or on Enter: for a form whose host
     * shows what the values as they stand would do (a Sheet action's consequence, #1477). Esc still puts it back only
     * as far as the last edit told.
     */
    live?: boolean | undefined;
    /**
     * The fields drawn on one line (#1534), by key — the field's path, joined by "." — each with its choices in order:
     * the label at the start, the choices at the end as one line of radios, none checked while the field holds no
     * value. A field a host draws itself (`renderControl`) keeps its column. Keep it stable: each field's memo
     * compares it.
     */
    lines?: ReadonlyMap<string, readonly FieldLineChoice[]> | undefined;
    /** The fields an issue names, by key: each takes the warn wash around it. */
    issues?: ReadonlySet<string> | undefined;
    /**
     * The field that takes the keyboard, by key, as it is named: the first control in it that takes it — or, where a
     * tab or a fold still hides the form, once it shows. A later name takes its place; naming none leaves it to take it.
     */
    focus?: string | undefined;
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
const RADIO = defaultValue<typeof RadioGroup.Types.Root>(RadioGroup.Types.Root);
/** A choice's radio group: its options in one line. */
const RADIO_STYLE = some({ ...defaultValue<typeof RadioGroup.Types.Style>(RadioGroup.Types.Style), orientation: some(variant("horizontal", null)) });
/** The most cases a choice shows as a radio group; past it, a select (#1473). */
const RADIO_MAX = 4;

/** The inputs' size in a form: the design system's Input, one 32px line whatever the field's kind (#1220). */
const SIZE = some(variant("md", null));
const INPUT_STYLE = some({ ...defaultValue<typeof Input.Types.Style>(Input.Types.Style), size: SIZE });
const SELECT_STYLE = some({ ...defaultValue<typeof Select.Types.Root.fields.style.cases.some>(Select.Types.Root.fields.style.cases.some), size: SIZE });
const TAGS_STYLE = some({ ...defaultValue<typeof TagsInput.Types.Style>(TagsInput.Types.Style), size: SIZE });

const stringEqual = equalFor(StringType);
const pathEqual = equalFor(ArrayType(StringType));
const compareStrings = compareFor(StringType);
const compareIntegers = compareFor(IntegerType);
const compareFloats = compareFor(FloatType);

/** A select's choice for none — no case or key can be it. */
const NONE_CHOICE = "\u0000none";

const NO_OPTIONS: Readonly<Record<string, readonly FieldOption[]>> = {};
const NO_SPECS: readonly FieldSpecValue[] = [];

/** What takes the keyboard in a field: the first control in it that takes it. */
const FOCUSABLE = "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Keeps the field whose control took the keyboard in view — its label with it — while its form changes width, until
 * the control loses the keyboard: a pane sliding open shows the form narrow first, where the field sits far lower,
 * and widens it under the scroll that brought the control into view.
 *
 * @param root - The form
 * @param field - The field
 * @param control - Its control that took the keyboard
 */
function keepInView(root: HTMLElement, field: HTMLElement, control: HTMLElement): void {
    if (typeof ResizeObserver !== "function") return;
    let width = root.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
        if (control.ownerDocument.activeElement !== control) { observer.disconnect(); return; }
        const now = root.getBoundingClientRect().width;
        if (Math.abs(now - width) < 0.5) return;
        width = now;
        field.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    observer.observe(root);
}

/**
 * Gives the keyboard to a field of a form — the first control in it that takes it — at once where it shows, else once
 * it does: the browser gives it to nothing hidden, and a change of an element around the form (a tab's panel shown, a
 * fold opened) is when it may show. The control stays in view while the form settles.
 *
 * @param root - The form
 * @param key - The field, by key
 * @returns What stops the wait, while it waits; `undefined` once the field has the keyboard, or where it has nothing to take it
 */
function takeWhenShown(root: HTMLElement | null, key: string): (() => void) | undefined {
    if (root === null) return undefined;
    // Whether the wait is over: the keyboard given, or nothing in the field to take it.
    const take = (): boolean => {
        const field = [...root.querySelectorAll<HTMLElement>("[data-field]")].find((el) => stringEqual(el.getAttribute("data-field") ?? "", key));
        const control = field?.querySelector<HTMLElement>(FOCUSABLE);
        if (field === undefined || control === undefined || control === null) return true;
        if (typeof control.checkVisibility === "function" && !control.checkVisibility()) return false;
        control.focus();
        keepInView(root, field, control);
        return true;
    };
    if (take()) return undefined;
    const observer = new MutationObserver((records) => {
        if (records.some((record) => record.target.contains(root)) && take()) observer.disconnect();
    });
    observer.observe(root.ownerDocument.documentElement, { attributes: true, subtree: true });
    return () => observer.disconnect();
}

/**
 * A field's value, read along its path from the struct the form edits: a step
 * into a struct its field, a step into a variant its case's value while it
 * holds that case.
 *
 * @param value - The struct
 * @param path - The field's names, from the struct down, and the cases it is under
 * @returns The field's value, or `undefined` where the struct holds none, or its variant another case
 */
function valueAt(value: unknown, path: readonly string[]): unknown {
    let at: unknown = value;
    for (const name of path) {
        if (at === undefined || at === null) return undefined;
        at = isVariant(at) ? (stringEqual(at.type, name) ? at.value : undefined) : (at as Record<string, unknown>)[name];
    }
    return at;
}

/** Whether a field's path runs through another's: a case's value's, under its variant's. */
function isUnder(path: readonly string[], parent: readonly string[]): boolean {
    return path.length > parent.length && pathEqual(path.slice(0, parent.length), [...parent]);
}

/**
 * The specs under each variant's, by its spec's path: those after it at paths
 * through its cases, as `Fields.specs` puts them, which its block draws.
 */
function underOf(specs: readonly FieldSpecValue[]): ReadonlyMap<string, readonly FieldSpecValue[]> {
    const out = new Map<string, readonly FieldSpecValue[]>();
    specs.forEach((spec, i) => {
        let end = i + 1;
        while (end < specs.length && isUnder(specs[end]!.path, spec.path)) end += 1;
        if (end > i + 1) out.set(spec.path.join("\u001f"), specs.slice(i + 1, end));
    });
    return out;
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
function startOf(inner: EastType, editor: FieldEditorValue | undefined): unknown {
    if (isTypeEqual(inner, DateTimeType)) return new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const start = defaultValue<EastType>(inner) as unknown;
    if (editor?.type === "number") return clampOf(editor.value, isTypeEqual(inner, IntegerType))(start as bigint | number);
    return start;
}

/**
 * What a case's value starts from when the case is chosen: a field's start, as
 * an empty Option's when it is set; a struct's fields each their own; a
 * variant chosen among, East's default case, its value started the same way.
 *
 * @param type - The value's type
 * @param path - Its path, through the case
 * @param under - The specs under the variant's, by which the value's fields are edited
 * @returns The value
 */
function startAt(type: EastType, path: readonly string[], under: readonly FieldSpecValue[]): unknown {
    const spec = under.find((s) => pathEqual(s.path, [...path]));
    if (spec === undefined && type.type === "Struct") {
        return Object.fromEntries(Object.entries(type.fields as Record<string, EastType>).map(([name, field]) => [name, startAt(field, [...path, name], under)]));
    }
    if (spec !== undefined && !spec.optional && spec.editor.type === "select" && type.type === "Variant") {
        const first = (defaultValue<EastType>(type) as variant).type;
        return variant(first, startAt((type.cases as Record<string, EastType>)[first]!, [...path, first], under));
    }
    return startOf(type, spec === undefined || spec.optional ? undefined : spec.editor);
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
        // A key by its text: a String as itself, any other as East prints it.
        const text = isTypeEqual(type, StringType) ? value as string : printFor(type)(value as never);
        return options[editor.value.of]?.find((o) => stringEqual(o.key, text))?.label ?? text;
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
export const FieldForm = memo(function FieldForm({
    specs, value, baseline, options = NO_OPTIONS, onChange, readOnly = false, words, renderControl, live = false, lines, issues, focus,
}: FieldFormProps) {
    const styles = useSlotRecipe({ key: "fieldForm" })() as Styles;
    const formatters = useFormatters();
    const said = useMemo((): FieldFormWords => words ?? { ...formatters, m: fieldFormMessages }, [words, formatters]);
    const sections = useMemo(() => sectionsOf(specs), [specs]);
    const unders = useMemo(() => underOf(specs), [specs]);
    // The field named takes the keyboard (`focus`), once it shows: a later name stops the wait for the one before.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const taking = useRef<(() => void) | undefined>(undefined);
    useEffect(() => {
        if (focus === undefined) return;
        taking.current?.();
        taking.current = takeWhenShown(rootRef.current, focus);
    }, [focus]);
    useEffect(() => () => taking.current?.(), []);
    // A field, and the specs under it where it is a variant's choice — never drawn on one line.
    const row = (spec: FieldSpecValue, under: readonly FieldSpecValue[] | undefined) => {
        const key = spec.path.join(".");
        return (
            <FieldRow key={spec.path.join("\u001f")} spec={spec} under={under} current={valueAt(value, spec.path)}
                base={baseline === undefined ? undefined : valueAt(baseline, spec.path)} hasBaseline={baseline !== undefined}
                options={options} onChange={onChange} readOnly={readOnly} words={said} styles={styles} renderControl={renderControl} live={live}
                choices={under === undefined ? lines?.get(key) : undefined} issue={issues?.has(key) === true} />
        );
    };
    // A section's fields in order, each run of fields drawn on one line together, and under a variant's choice its
    // block: the fields of the case it holds.
    const draw = (run: readonly FieldSpecValue[]): ReactNode[] => {
        const out: ReactNode[] = [];
        let together: FieldSpecValue[] = [];
        const close = () => {
            if (together.length === 0) return;
            out.push(<Box key={`lines\u001f${together[0]!.path.join("\u001f")}`} css={styles.lines} data-field-lines="">{together.map((spec) => row(spec, undefined))}</Box>);
            together = [];
        };
        for (let i = 0; i < run.length; i += 1) {
            const spec = run[i]!;
            const under = unders.get(spec.path.join("\u001f"));
            if (under === undefined) {
                if (lines?.has(spec.path.join(".")) === true) together.push(spec);
                else { close(); out.push(row(spec, undefined)); }
                continue;
            }
            close();
            out.push(row(spec, under));
            let end = i + 1;
            while (end < run.length && isUnder(run[end]!.path, spec.path)) end += 1;
            const held = valueAt(value, spec.path);
            const shown = isVariant(held) ? run.slice(i + 1, end).filter((s) => stringEqual(s.path[spec.path.length]!, held.type)) : [];
            if (shown.length > 0) {
                out.push(<Box key={`block\u001f${spec.path.join("\u001f")}`} css={styles.block} data-field-block={spec.path.join(".")}>{draw(shown)}</Box>);
            }
            i = end - 1;
        }
        close();
        return out;
    };
    return (
        <Box ref={rootRef} css={styles.root} data-field-form="">
            {/* A section keyed by its first field: two runs of one group apart — `Other` twice — are two sections. */}
            {sections.map((section) => (section.group === undefined ? draw(section.specs) : (
                <Box key={`group\u001f${section.specs[0]!.path.join("\u001f")}`} css={styles.group} role="group" aria-label={section.group} data-field-group={section.group}>
                    <Box as="span" css={styles.groupHead}>{section.group}</Box>
                    <Box css={styles.groupFields}>{draw(section.specs)}</Box>
                </Box>
            )))}
        </Box>
    );
});

/** Props of {@link FieldRow}. */
interface FieldRowProps {
    spec: FieldSpecValue;
    /** The specs under it, where it is a variant's choice: what a case chosen starts from. */
    under: readonly FieldSpecValue[] | undefined;
    current: unknown;
    base: unknown;
    hasBaseline: boolean;
    options: Readonly<Record<string, readonly FieldOption[]>>;
    onChange: (path: readonly string[], value: unknown) => void;
    readOnly: boolean;
    words: FieldFormWords;
    styles: Styles;
    renderControl: FieldFormProps["renderControl"];
    live: boolean;
    /** Its choices, where it is drawn on one line. */
    choices: readonly FieldLineChoice[] | undefined;
    /** An issue names it. */
    issue: boolean;
}

/**
 * One field: the shared `Field` around its control's line — its input, and an Option's Set or Clear — and a
 * checklist's items; or, drawn on one line, its label and its choices.
 */
const FieldRow = memo(function FieldRow({
    spec, under, current, base, hasBaseline, options, onChange, readOnly, words, styles, renderControl, live, choices, issue,
}: FieldRowProps) {
    const { m } = words;
    const button = useRecipe({ key: "button" });
    const iconButton = useRecipe({ key: "iconButton" });
    // A line's help, in the shared Field's style for it: what the Field draws a column's in.
    const fieldStyles = useSlotRecipe({ key: "field" })() as Styles;
    const type = useMemo(() => fromEastTypeValue(spec.type) as EastType, [spec.type]);
    // Two values of the field, either of them none yet (a draft's field not given).
    const same = useMemo(() => {
        const equal = equalFor(type);
        return (a: unknown, b: unknown) => (a === undefined || b === undefined ? a === b : equal(a, b));
    }, [type]);
    // An Option's input edits its value's type; `none` is no value.
    const inner = useMemo(() => (spec.optional && type.type === "Variant" ? (type.cases as Record<string, EastType>)["some"]! : type), [spec.optional, type]);
    // Two values of what the input edits: a line's choice against the value the field holds.
    const sameInner = useMemo(() => equalFor(inner), [inner]);
    const held = spec.optional ? getSomeorUndefined(current as option<unknown>) : current;
    // A variant's choice differs where its case does: what the case holds is its block's fields' to tint.
    const dirty = hasBaseline && (under === undefined ? !same(current, base)
        : current === undefined || base === undefined ? current !== base : !stringEqual((current as variant).type, (base as variant).type));
    const key = spec.path.join(".");
    const editor = spec.editor;
    // A reference's key by its text: a String as itself, a key of any other type as East prints it and reads it back.
    const keyText = useMemo(() => (editor.type !== "reference" || isTypeEqual(inner, StringType) ? undefined
        : { print: printFor(inner), parse: parseFor(inner) }), [editor.type, inner]);
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
    // Live, each typed edit is told at once (`FieldFormProps.live`).
    const hold = useCallback((next: unknown) => { if (live) emit(next); else pending.current = { value: next }; }, [live, emit]);
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
    // An Option's Clear, beside a line's choices or an input that cannot show none.
    const clear = (
        <chakra.button type="button" css={iconButton({ variant: "ghost", size: "xs" })} aria-label={m.clear({ label: spec.label })}
            title={m.clear({ label: spec.label })} data-field-clear="" onClick={() => emit(undefined)}>
            <FontAwesomeIcon icon={faXmark} />
        </chakra.button>
    );

    // Drawn on one line: its label at the start, cut where the line is short and whole in its tooltip, and its choices
    // at the end as one line of radios, none checked while it holds no value — or, read only, the choice made — and its
    // help under it.
    if (choices !== undefined && own === undefined) {
        const chosen = held === undefined ? -1 : choices.findIndex((choice) => sameInner(choice.value, held));
        const printedLine = editor.type === "readonly" || readOnly;
        const lineHelp = getSomeorUndefined(spec.help);
        return (
            <Box css={styles.field} data-field={key} data-editor={printedLine ? "readonly" : editor.type} data-layout="line"
                data-dirty={dirty ? "" : undefined} data-issue={issue ? "" : undefined} title={spec.label}>
                <Box as="span" css={styles.lineLabel}>{spec.label}</Box>
                {printedLine
                    ? <Box as="span" css={styles.lineValue} data-field-value="">{chosen < 0 ? m.notSet() : choices[chosen]!.label}</Box>
                    : (
                        <Box css={styles.lineChoices} data-field-choice="radio">
                            <EastChakraRadioGroup label={spec.label} value={{
                                ...RADIO,
                                value: chosen < 0 ? "" : String(chosen),
                                items: choices.map((choice, i) => ({ value: String(i), label: some(choice.label), disabled: none })),
                                name: some(`fieldForm.${key}`),
                                onChange: some((next: string) => {
                                    const choice = choices[Number(next)];
                                    if (choice !== undefined) emit(choice.value);
                                    return null;
                                }),
                                style: RADIO_STYLE,
                            }} />
                        </Box>
                    )}
                {!printedLine && spec.optional && held !== undefined && <Box css={styles.side} data-field-side="clear">{clear}</Box>}
                {lineHelp !== undefined && lineHelp.length > 0 && (
                    <Box as="span" css={[fieldStyles.helperText, styles.lineHelp]} data-field-help="">{lineHelp}</Box>
                )}
            </Box>
        );
    }

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

    // A case chosen: its value starts as an empty Option's does when it is set, and the case the variant holds is no
    // edit, keeping its value.
    const choose = (next: string) => {
        if (stringEqual(next, NONE_CHOICE)) { emit(undefined); return; }
        if (isVariant(held) && stringEqual(held.type, next)) return;
        const value = ((inner as VariantType).cases as Record<string, EastType>)[next];
        if (value !== undefined) emit(variant(next, startAt(value, [...spec.path, next], under ?? NO_SPECS)));
    };

    // A value printed for a person: read only, or under the host's own control.
    const printedText = printed || own !== undefined ? printOf(inner, held, editor, options, words) : undefined;
    const control = ((): Control => {
        const printedValue = (text: string): Control => variant("StringInput", { ...STRING_INPUT, value: text, style: INPUT_STYLE });
        if (printed || own !== undefined) return printedValue(printedText as string);
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
                    onChange: some((next: string) => { choose(next); return null; }),
                    style: SELECT_STYLE,
                });
            case "reference": {
                const listed = options[editor.value.of] ?? [];
                const at = held === undefined ? undefined : keyText === undefined ? held as string : keyText.print(held);
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
                    // The key chosen, read back at the field's type from its text: one that does not read is no edit.
                    onChange: some((next: string) => {
                        if (stringEqual(next, NONE_CHOICE) || keyText === undefined) emit(stringEqual(next, NONE_CHOICE) ? undefined : next);
                        else {
                            const read = keyText.parse(next);
                            if (read.success) emit(read.value);
                        }
                        return null;
                    }),
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

    // A choice of up to four cases is a radio group, each in view, chosen at once; past four, the select above.
    const radio = ((): RadioGroupValue | undefined => {
        if (printed || own !== undefined || editor.type !== "select" || editor.value.length > RADIO_MAX) return undefined;
        return {
            ...RADIO,
            value: held !== undefined ? (held as variant).type as string : spec.optional ? NONE_CHOICE : "",
            items: [
                ...(spec.optional ? [{ value: NONE_CHOICE, label: some(m.notSet()), disabled: none }] : []),
                ...editor.value.map((o) => ({ value: o.case, label: some(o.label), disabled: none })),
            ],
            name: some(`fieldForm.${key}`),
            onChange: some((next: string) => { choose(next); return null; }),
            style: RADIO_STYLE,
        };
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
        style: some(FIELD_STYLE),
    };
    // The text a one-line box holds, whole — a value printed, a text field's, or the words of a choice made — its control's
    // title: an ellipsis ends it where the box cuts it short (the `fieldForm` recipe, a select's own), and the title says
    // the rest. A reference's choices are the host's, as long as its names are.
    const chosen = !printed && own === undefined && held !== undefined && (editor.type === "select" || editor.type === "reference")
        ? printOf(inner, held, editor, options, words) : undefined;
    const whole = own !== undefined ? undefined : printedText ?? chosen ?? (editor.type === "text" ? (held ?? "") as string : undefined);
    // Beside an input that cannot show none: Set while it holds no value, and an Option's Clear while it does.
    const side = own !== undefined || printed || readOnly || editor.type === "text" || editor.type === "select" || editor.type === "reference" ? undefined
        : held === undefined ? "set" : spec.optional ? "clear" : undefined;
    // The control's line: the control filling it — the host's own, or the input — and the Set or Clear at its end.
    const line = (
        <Box css={styles.line} data-field-line="">
            <Box ref={fieldRef} css={styles.control} title={radio !== undefined || whole === undefined || whole.length === 0 ? undefined : whole}
                data-field-choice={radio !== undefined ? "radio" : undefined}>
                {own ?? (radio !== undefined
                    ? <EastChakraRadioGroup value={radio} />
                    : <EastChakraComponent value={control} storageKey={`fieldForm.${key}.control`} />)}
            </Box>
            {side !== undefined && (
                <Box css={styles.side} data-field-side={side}>
                    {side === "set" ? (
                        <chakra.button type="button" css={button({ variant: "outline", size: "xs" })} data-field-set=""
                            onClick={() => emit(startOf(inner, editor))}>
                            {m.set()}
                        </chakra.button>
                    ) : clear}
                </Box>
            )}
        </Box>
    );

    return (
        <Box css={styles.field} data-field={key} data-editor={own !== undefined ? "custom" : printed ? "readonly" : editor.type} data-dirty={dirty ? "" : undefined}
            data-issue={issue ? "" : undefined} onBlur={onBlur} onKeyDown={onKeyDown}>
            <EastChakraField key={revision} value={field} storageKey={`fieldForm.${key}`} controlNode={line} />
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
    );
});
