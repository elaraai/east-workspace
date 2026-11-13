/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The fields contract (#1147) — a typed form over an East struct: the form a
 * builder's inspector shows for what it has selected. Each field's editor
 * comes from its East type, and a hint adds only what a type cannot say — a
 * label, a unit, the words for a variant's cases, the keyed set a String
 * names. A hint is checked against the field it is given to, so
 * `Fields.number` on a String field fails to compile.
 *
 * `Fields.specs(R, hints)` resolves a struct's fields and hints into the
 * closed {@link FieldSpecType} a renderer reads: east-ui-components'
 * `FieldForm` draws each as the shared `Field` around the shared input its
 * type takes. It is a shared part, never an East component — e3-ui's
 * builders carry the specs in their payloads: the Sheet's and the Plan's
 * inspectors, and the Calendar's, whose `Calendar.field` is `Fields`.
 *
 * | Field type | Editor with no hint | Hint |
 * |---|---|---|
 * | `String` | Text | `Fields.text`, `Fields.reference` |
 * | `Integer`, `Float` | Number, with its steppers | `Fields.number` (bigints for an Integer field, numbers for a Float) |
 * | `Boolean` | Checkbox | — |
 * | `DateTime` | Date and time | `Fields.date` — a date, a time, or both |
 * | A variant | A choice of its cases, each case's name spelled out; a case holding data, its value's fields under the choice | `Fields.select`, its `cases` a hint for a case's value |
 * | `Set<String>`, `Array<String>` | Tags, typed freely | `Fields.tags` |
 * | `Array` of a struct with one String and one Boolean field | Checklist | `Fields.checklist` |
 * | A struct | Its fields, grouped under its name | a hint per nested field |
 * | `Option<T>` | `T`'s editor, which can be cleared — an Option of a struct, or of a variant whose cases hold data, printed whole | `T`'s hint |
 * | Anything else | Printed, read-only | `Fields.readonly`; `Fields.hidden` hides any field |
 *
 * A variant's case holding data has its value's specs after the variant's, at
 * paths through the case's name (#1549): a struct case's fields, any other
 * case's one spec at the case's own path, an empty case none — as deep as the
 * type goes. A recursive type is printed whole, and so is a variant with a
 * case holding one, which no default starts. `Fields.reference` names a keyed
 * set's key in a field of any type a Dict may be keyed by, or an Option of
 * one: its choices are the keys' text, in their keys' order at the field's
 * type — a String field's in the host's.
 *
 * A field's type is told by East's own `isTypeEqual`.
 *
 * @packageDocumentation
 */

import {
    ArrayType, BooleanType, DateTimeType, EastTypeType, FloatType, IntegerType, NullType, OptionType, SetType, StringType, StructType, VariantType,
    isImmutableType, isTypeEqual, none, some, toEastTypeValue, variant,
    type BlobType, type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { DateTimePrecisionType, type DateTimePrecisionLiteral } from "../forms/input/types.js";

// ============================================================================
// The closed spec a renderer reads
// ============================================================================

/**
 * One choice of a select: a case of the field's variant, and its words.
 *
 * @property case - The case's name
 * @property label - What the select shows for it
 */
export const FieldOptionType = StructType({ case: StringType, label: StringType });

/**
 * How a field is edited — the closed set of editors a renderer draws. Which
 * input draws one is the field's type's: an Integer's or a Float's number, a
 * Set's or an Array's tags.
 *
 * @property text - A text box, showing `placeholder` while empty
 * @property number - A number with its steppers, moved by `step`, clamped to `min` and `max`; its `unit` and bounds in the line under it
 * @property checkbox - A checkbox
 * @property datetime - A date and a time — or, at `precision`, a date or a time alone (a host's choice: the Sheet's inspector picks a date at a date column's level, #1188)
 * @property select - A choice of the variant's cases, each with its words: a case holding data has its value's specs after the select's, under the case's name
 * @property tags - Values typed freely, `options` suggested as they are typed
 * @property checklist - Items each with its done box: the item struct's `text` and `done` fields
 * @property reference - A key of the keyed set the host lists under `of`, chosen by its text and held at the field's type
 * @property readonly - Printed, never edited
 */
export const FieldEditorType = VariantType({
    text: StructType({ placeholder: OptionType(StringType) }),
    number: StructType({ unit: OptionType(StringType), step: OptionType(FloatType), min: OptionType(FloatType), max: OptionType(FloatType) }),
    checkbox: NullType,
    datetime: StructType({ precision: OptionType(DateTimePrecisionType) }),
    select: ArrayType(FieldOptionType),
    tags: StructType({ options: ArrayType(StringType) }),
    checklist: StructType({ text: StringType, done: StringType }),
    reference: StructType({ of: StringType }),
    readonly: NullType,
});

/**
 * One field of a form, resolved: where it is, what it is called, how it is
 * edited, and its type, to read and write its value.
 *
 * @property path - The field's names from the struct down — one name, a nested struct's field under its own, or a case's value under its variant's, through the case's name
 * @property label - Its label
 * @property help - A line under it, the hint's
 * @property group - The nested struct it sits in, as its heading names it (`Address`, `Address · Geo`) — a case's value its variant's
 * @property type - The field's East type, an `Option` included: what its value is read and written as
 * @property optional - Whether it is an `Option`, which its editor can clear
 * @property editor - How it is edited
 */
export const FieldSpecType = StructType({
    path: ArrayType(StringType),
    label: StringType,
    help: OptionType(StringType),
    group: OptionType(StringType),
    type: EastTypeType,
    optional: BooleanType,
    editor: FieldEditorType,
});

/** One resolved field, decoded — what `Fields.specs` returns, a payload carries and `FieldForm` reads. */
export type FieldSpecValue = ValueTypeOf<typeof FieldSpecType>;

/** How a field is edited, decoded. */
export type FieldEditorValue = ValueTypeOf<typeof FieldEditorType>;

// ============================================================================
// Hints
// ============================================================================

/** The key a hint carries its kind under — a symbol, so no struct field's name is taken for a hint. */
export const FIELD_HINT: unique symbol = Symbol("Fields.hint");

/** What every hint but `hidden` takes. */
export interface FieldHintOptions {
    /** The field's label — its name spelled out by default (`created_by` → "Created by"). */
    readonly label?: string;
    /** A line under the field. */
    readonly help?: string;
}

/** A hint of one kind. */
export interface FieldHintOf<K extends string> {
    /** The hint's kind. */
    readonly [FIELD_HINT]: K;
}

/** A DateTime field's date field ({@link fieldDate}). */
export interface DateFieldHint extends FieldHintOf<"date">, FieldHintOptions {
    /** What it picks: a date, a time of day, or both — both by default. */
    readonly precision?: DateTimePrecisionLiteral;
}

/** A String field's text box ({@link fieldText}). */
export interface TextFieldHint extends FieldHintOf<"text">, FieldHintOptions {
    /** What the box shows while empty. */
    readonly placeholder?: string;
}

/**
 * A number field's number ({@link fieldNumber}).
 *
 * @typeParam N - `bigint` for an Integer field, `number` for a Float
 */
export interface NumberFieldHint<N extends bigint | number> extends FieldHintOf<"number">, FieldHintOptions {
    /** What a number counts — `people`, `kg` — in the line under it. */
    readonly unit?: string;
    /** How far its steppers move it: 1 by default. */
    readonly step?: N;
    /** The least it may be. */
    readonly min?: N;
    /** The most it may be. */
    readonly max?: N;
}

/**
 * A variant field's select ({@link fieldSelect}).
 *
 * @typeParam C - The variant's cases
 * @typeParam H - The hints for the cases' values
 */
export interface SelectFieldHint<C extends string, H extends object = Record<never, never>> extends FieldHintOf<"select">, FieldHintOptions {
    /** The words for a case, where its name spelled out will not do. */
    readonly labels?: { readonly [K in C]?: string };
    /** A hint for a case's value, as a field of its type takes — a struct case's a hint per field. */
    readonly cases?: H;
}

/** A string collection's tags ({@link fieldTags}). */
export interface TagsFieldHint extends FieldHintOf<"tags">, FieldHintOptions {
    /** The values suggested as a tag is typed. */
    readonly options?: readonly string[];
}

/** An item list's checklist ({@link fieldChecklist}). */
export interface ChecklistFieldHint extends FieldHintOf<"checklist">, FieldHintOptions {
    /** The item's String field its text is — needed when it has several. */
    readonly text?: string;
    /** The item's Boolean field its done box is — needed when it has several. */
    readonly done?: string;
}

/** A field holding a key of a keyed set the host lists ({@link fieldReference}). */
export interface ReferenceFieldHint extends FieldHintOf<"reference">, FieldHintOptions {
    /** The keyed set's name: the host's choices for it are what the select offers. */
    readonly of: string;
}

/** A field printed, never edited ({@link fieldReadonly}). */
export interface ReadonlyFieldHint extends FieldHintOf<"readonly">, FieldHintOptions {}

/** A field the form leaves out ({@link fieldHidden}). */
export type HiddenFieldHint = FieldHintOf<"hidden">;

/** What any field takes. */
type AnyFieldHint = ReadonlyFieldHint | HiddenFieldHint;

/** Whether a variant's cases are an Option's. */
type IsOption<C> = [Exclude<keyof C, "none" | "some">] extends [never] ? ("none" extends keyof C ? ("some" extends keyof C ? true : false) : false) : false;

/**
 * The hints a field of type `T` takes: its editor's own, `readonly` and
 * `hidden`, and, for a type a key may be, `reference`; an `Option`'s are its
 * value's — but an `Option` of a struct, or of a variant whose cases hold
 * data, printed whole, takes only `reference`, `readonly` and `hidden`; a
 * struct's a hint per field; and a variant's select a hint per case's value.
 *
 * @typeParam T - The field's East type
 */
export type FieldHint<T> =
    T extends VariantType<infer C>
        ? IsOption<C> extends true
            ? OptionFieldHint<C["some" & keyof C]>
            : SelectFieldHint<keyof C & string, FieldCaseHints<C>> | ReferenceFieldHint | AnyFieldHint
        : T extends StringType ? TextFieldHint | ReferenceFieldHint | AnyFieldHint
        : T extends IntegerType ? NumberFieldHint<bigint> | ReferenceFieldHint | AnyFieldHint
        : T extends FloatType ? NumberFieldHint<number> | ReferenceFieldHint | AnyFieldHint
        : T extends SetType<StringType> ? TagsFieldHint | AnyFieldHint
        : T extends ArrayType<StringType> ? TagsFieldHint | AnyFieldHint
        : T extends ArrayType<StructType> ? ChecklistFieldHint | AnyFieldHint
        : T extends StructType<infer F extends { [K in string]: unknown }> ? FieldHints<F> | ReferenceFieldHint | AnyFieldHint
        : T extends DateTimeType ? DateFieldHint | ReferenceFieldHint | AnyFieldHint
        : T extends BooleanType ? ReferenceFieldHint | AnyFieldHint
        : T extends BlobType ? ReferenceFieldHint | AnyFieldHint
        : AnyFieldHint;

/**
 * The hints an `Option` field takes, by its value's type: its value's — but an
 * `Option` of a struct, or of a variant whose cases hold data, is printed
 * whole, and takes only `reference`, `readonly` and `hidden`.
 *
 * @typeParam T - The `Option`'s value's type
 */
type OptionFieldHint<T> =
    T extends StructType ? ReferenceFieldHint | AnyFieldHint
    : T extends VariantType<infer C>
        ? IsOption<C> extends true ? FieldHint<T> : C[keyof C] extends NullType ? FieldHint<T> : ReferenceFieldHint | AnyFieldHint
    : FieldHint<T>;

/**
 * A variant's select's hints for its cases' values: for any case holding
 * data, a hint that fits its value's type — a struct case's a hint per field.
 *
 * @typeParam C - The variant's cases
 */
export type FieldCaseHints<C> = { readonly [K in keyof C as C[K] extends NullType ? never : K]?: FieldHint<C[K]> };

/**
 * A struct's hints: for any of its fields, a hint that fits the field's type.
 *
 * @typeParam F - The struct's fields
 */
export type FieldHints<F extends { [K in string]: unknown }> = { readonly [K in keyof F]?: FieldHint<F[K]> };

/**
 * A String field's text box.
 *
 * @param options - Its label, a line under it, and its placeholder
 * @returns The hint
 */
export function fieldText(options: FieldHintOptions & { readonly placeholder?: string } = {}): TextFieldHint {
    return { ...options, [FIELD_HINT]: "text" };
}

/**
 * A DateTime field's date field, picking a date, a time of day, or both.
 *
 * @param options - Its label, a line under it, and what it picks (`"date"`, `"time"` or `"datetime"`, the default)
 * @returns The hint
 * @example
 * ```ts
 * import { ArrayType, DateTimeType, East, StringType, StructType } from "@elaraai/east";
 * import { Fields } from "@elaraai/east-ui";
 *
 * const until = East.function([], StringType, ($) => {
 *     const Deferral = StructType({ reason: StringType, until: DateTimeType });
 *     const specs = $.const(Fields.specs(Deferral, {
 *         until: Fields.date({ label: "Until", precision: "date" }),
 *     }), ArrayType(Fields.Types.Spec));
 *     const field = $.const(specs.get(0n));
 *     return East.str`${field.label}: ${field.editor.unwrap("datetime").precision.unwrap("some").getTag()}`;
 * });
 * ```
 */
export function fieldDate(options: FieldHintOptions & { readonly precision?: DateTimePrecisionLiteral } = {}): DateFieldHint {
    return { ...options, [FIELD_HINT]: "date" };
}

/**
 * A number field's number: its steppers move it by its step, clamped to its
 * bounds; its unit and bounds in the line under it.
 *
 * @typeParam N - `bigint` for an Integer field, `number` for a Float: the bounds and the step are the field's
 * @param options - Its label, a line under it, its unit, its step and its bounds
 * @returns The hint
 */
export function fieldNumber<N extends bigint | number = never>(
    options: FieldHintOptions & { readonly unit?: string; readonly step?: N; readonly min?: N; readonly max?: N } = {},
): NumberFieldHint<N> {
    return { ...options, [FIELD_HINT]: "number" };
}

/**
 * A variant field's select, with words for the cases whose names, spelled
 * out, will not do, and hints for the values its cases hold. The select
 * offers the cases it labels first, in its order, then the rest in the
 * variant's: East keeps a variant's cases in name order, and a status reads
 * best in its own. A case holding data has its value's fields under the
 * select while it is the case chosen, each hinted as a field of its type is.
 *
 * @typeParam C - The cases it labels
 * @typeParam H - The hints for the cases' values
 * @param options - Its label, a line under it, the words for its cases, and a hint for any case's value — a struct case's a hint per field
 * @returns The hint
 * @example
 * ```ts
 * import { ArrayType, East, NullType, StringType, StructType, VariantType } from "@elaraai/east";
 * import { Fields } from "@elaraai/east-ui";
 *
 * const choices = East.function([], ArrayType(StringType), ($) => {
 *     const Status = VariantType({ planned: NullType, in_progress: NullType, on_hold: NullType, done: NullType });
 *     const Job = StructType({ task: StringType, status: Status });
 *     const specs = $.const(Fields.specs(Job, {
 *         status: Fields.select({ labels: { planned: "Planned", in_progress: "Underway", on_hold: "Paused" } }),
 *     }), ArrayType(Fields.Types.Spec));
 *     return specs.get(0n).editor.unwrap("select").map((_$, option) => option.label);
 * });
 * ```
 */
export function fieldSelect<C extends string = never, H extends object = Record<never, never>>(
    options: FieldHintOptions & { readonly labels?: { readonly [K in C]?: string }; readonly cases?: H } = {},
): SelectFieldHint<C, H> {
    return { ...options, [FIELD_HINT]: "select" };
}

/**
 * A string collection's tags, typed freely, with the values suggested as a
 * tag is typed.
 *
 * @param options - Its label, a line under it, and the values suggested
 * @returns The hint
 */
export function fieldTags(options: FieldHintOptions & { readonly options?: readonly string[] } = {}): TagsFieldHint {
    return { ...options, [FIELD_HINT]: "tags" };
}

/**
 * An item list's checklist: each item's text and done box, the items done of
 * all, an item added by name. Names the item's text and done fields where it
 * has several.
 *
 * @param options - Its label, a line under it, and the item's text and done fields
 * @returns The hint
 */
export function fieldChecklist(options: FieldHintOptions & { readonly text?: string; readonly done?: string } = {}): ChecklistFieldHint {
    return { ...options, [FIELD_HINT]: "checklist" };
}

/**
 * A field holding a key of a keyed set the host lists, of any type a Dict may
 * be keyed by: a select of the host's choices for `of`, each a key's text,
 * with Unassigned first for an `Option`. The key chosen is held at the
 * field's type, read from its text. A String field offers the choices in the
 * host's order; a field of any other type in its keys' order at that type,
 * never their text's — a choice whose text reads as none of its values last,
 * and, chosen, no edit: the field says why under it.
 *
 * @param options - The keyed set's name, the field's label and a line under it
 * @returns The hint
 */
export function fieldReference(options: FieldHintOptions & { readonly of: string }): ReferenceFieldHint {
    return { ...options, [FIELD_HINT]: "reference" };
}

/**
 * A field printed, never edited.
 *
 * @param options - Its label and a line under it
 * @returns The hint
 */
export function fieldReadonly(options: FieldHintOptions = {}): ReadonlyFieldHint {
    return { ...options, [FIELD_HINT]: "readonly" };
}

/**
 * A field the form leaves out.
 *
 * @returns The hint
 */
export function fieldHidden(): HiddenFieldHint {
    return { [FIELD_HINT]: "hidden" };
}

// ============================================================================
// Resolving a struct's fields and hints
// ============================================================================

/** A hint of any kind, as the resolver reads it. */
type AnyHint = { readonly [FIELD_HINT]: string } & FieldHintOptions & {
    readonly placeholder?: string;
    readonly unit?: string; readonly step?: unknown; readonly min?: unknown; readonly max?: unknown;
    readonly labels?: Readonly<Record<string, string | undefined>>;
    readonly cases?: Readonly<Record<string, unknown>>;
    readonly options?: readonly unknown[];
    readonly text?: string; readonly done?: string;
    readonly of?: string;
    readonly precision?: string;
};

/**
 * Whether a value is a hint rather than a nested struct's hints.
 *
 * @param value - A struct's hint for one field
 * @returns Whether it is a hint
 */
function isHint(value: unknown): value is AnyHint {
    return value !== null && typeof value === "object" && FIELD_HINT in value;
}

/**
 * A field's or a case's name spelled out for a person: its words split at
 * underscores, dashes and case changes, the first capitalised —
 * `in_progress` → "In progress", `createdBy` → "Created by".
 *
 * @param name - The name
 * @returns Its words
 */
export function spellOut(name: string): string {
    const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter((w) => w !== "").map((w) => w.toLowerCase());
    const [first, ...rest] = words;
    return first === undefined ? name : [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** Whether a type is an `Option`: the `OptionType` of its `some` case's type. */
function isOptionType(type: EastType): type is OptionType<EastType> {
    if (type.type !== "Variant") return false;
    const some = (type.cases as Record<string, EastType | undefined>)["some"];
    return some !== undefined && isTypeEqual(type, OptionType(some));
}

/** Whether a type is a variant a select chooses among: one with a case, and not an `Option`. */
function isChoice(type: EastType): type is VariantType {
    return type.type === "Variant" && !isOptionType(type) && Object.keys(type.cases).length > 0;
}

/** Whether any of a variant's cases holds data: a value other than an empty one (NullType). */
function holdsData(type: VariantType): boolean {
    return Object.values(type.cases as Record<string, EastType>).some((t) => !isTypeEqual(t, NullType));
}

/**
 * Whether East has a default for a type, which a case's value starts from when
 * the case is chosen: none for a recursive type, a function or Never, nor for
 * a struct holding one or a variant whose first case is one.
 */
function hasDefault(type: EastType): boolean {
    switch (type.type) {
        case "Recursive": case "Function": case "AsyncFunction": case "Never": return false;
        case "Struct": return Object.values(type.fields as Record<string, EastType>).every(hasDefault);
        case "Variant": {
            const first = Object.values(type.cases as Record<string, EastType>)[0];
            return first !== undefined && hasDefault(first);
        }
        case "Ref": return hasDefault(type.value as EastType);
        default: return true;
    }
}

/** Whether a type is a Set or an Array of String — what tags edit. */
function isStrings(type: EastType): boolean {
    return isTypeEqual(type, SetType(StringType)) || isTypeEqual(type, ArrayType(StringType));
}

/** Whether a type is an Array of structs — what a checklist's items may be. */
function isItemList(type: EastType): type is ArrayType<StructType> {
    return type.type === "Array" && (type.value as EastType).type === "Struct";
}

/** A type as the refusals name it. */
function kindOf(type: EastType): string {
    if (isOptionType(type)) return `an Option of ${kindOf(type.cases.some).replace(/^an? /, "")}`;
    switch (type.type) {
        case "Array": return `an Array of ${(type.value as EastType).type}`;
        case "Set": return `a Set of ${(type.key as EastType).type}`;
        case "Integer": return "an Integer";
        default: return `a ${type.type}`;
    }
}

/** A checklist's item struct's text and done fields, named or found. */
function checklistOf(item: StructType, hint: AnyHint | undefined, at: string): { text: string; done: string } | undefined {
    const fields = item.fields as Record<string, EastType>;
    const named = (field: string | undefined, kind: StringType | BooleanType, role: "text" | "done"): string | undefined => {
        if (field !== undefined) {
            const type = fields[field];
            if (type === undefined || !isTypeEqual(type, kind)) {
                throw new Error(`Fields: "${at}"'s checklist names "${field}" as its ${role} field — its items' ${role} field is a ${kind.type} field of theirs`);
            }
            return field;
        }
        const found = Object.keys(fields).filter((f) => isTypeEqual(fields[f]!, kind));
        if (found.length === 1) return found[0];
        if (hint === undefined) return undefined;
        throw new Error(found.length === 0
            ? `Fields: "${at}"'s items have no ${kind.type} field to be a checklist's ${role}`
            : `Fields: "${at}"'s items have ${found.length} ${kind.type} fields (${found.join(", ")}) — name the checklist's ${role} field: Fields.checklist({ ${role}: "${found[0]}" })`);
    };
    const text = named(hint?.text, StringType, "text");
    const done = named(hint?.done, BooleanType, "done");
    return text === undefined || done === undefined ? undefined : { text, done };
}

/** A number hint's step or bound, as the spec holds it — checked against the field's type. */
function bound(value: unknown, integer: boolean, what: string, at: string): number | undefined {
    if (value === undefined) return undefined;
    if (integer ? typeof value !== "bigint" : typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(integer
            ? `Fields: "${at}" is an Integer field — its number hint's ${what} is a bigint (1n), not ${typeof value === "number" ? "a number" : "this"}`
            : `Fields: "${at}" is a Float field — its number hint's ${what} is a finite number, not ${typeof value === "bigint" ? "a bigint" : "this"}`);
    }
    return Number(value);
}

/**
 * How a field of a type is edited: its hint's editor, checked against the
 * type, or the type's own.
 *
 * @param type - The field's type, an `Option`'s value's type
 * @param hint - Its hint
 * @param at - Its path, for a refusal
 * @param optional - Whether the field is an `Option` of `type`
 * @returns Its editor
 * @throws {Error} Naming the field, for a hint that does not fit its type
 */
function editorOf(type: EastType, hint: AnyHint | undefined, at: string, optional: boolean): FieldEditorValue {
    const kind = hint?.[FIELD_HINT];
    // A declaration, so a refusal ends the path it is on for the checker too.
    function refuse(what: string): never {
        throw new Error(`Fields: "${at}" is ${kindOf(type)} field — ${what}`);
    }
    // A variant printed whole: an Option of one whose cases hold data — a
    // case's value under its choice is at a path through the case, and an
    // Option's value one step further in — or one with a case whose value has
    // no default to start from when it is chosen.
    const whole = isChoice(type) && ((optional && holdsData(type)) || Object.values(type.cases as Record<string, EastType>).some((t) => !hasDefault(t)));
    switch (kind) {
        case undefined: break;
        case "readonly": return variant("readonly", null);
        case "text":
            if (!isTypeEqual(type, StringType)) refuse("Fields.text edits a String field");
            return variant("text", { placeholder: hint!.placeholder === undefined ? none : some(hint!.placeholder) });
        case "date": {
            if (!isTypeEqual(type, DateTimeType)) refuse("Fields.date edits a DateTime field");
            const precision = hint!.precision;
            if (precision !== undefined && precision !== "date" && precision !== "time" && precision !== "datetime") {
                refuse(`its date hint's precision is "${precision}" — it picks a "date", a "time" or a "datetime"`);
            }
            return variant("datetime", { precision: precision === undefined ? none : some(variant(precision, null)) });
        }
        case "reference":
            if (!isImmutableType(type)) refuse("Fields.reference names a keyed set's key, a field of a type a Dict may be keyed by");
            if (hint!.of === undefined || hint!.of === "") refuse("Fields.reference names the keyed set its key is of: Fields.reference({ of: \"…\" })");
            return variant("reference", { of: hint!.of! });
        case "number": {
            const integer = isTypeEqual(type, IntegerType);
            if (!integer && !isTypeEqual(type, FloatType)) refuse("Fields.number edits an Integer or a Float field");
            const step = bound(hint!.step, integer, "step", at);
            const min = bound(hint!.min, integer, "min", at);
            const max = bound(hint!.max, integer, "max", at);
            if (step !== undefined && !(step > 0)) refuse(`its number hint's step is ${step}, and a step moves the number up or down — it is more than 0`);
            if (min !== undefined && max !== undefined && min > max) refuse(`its number hint's min, ${min}, is more than its max, ${max}`);
            return variant("number", {
                unit: hint!.unit === undefined ? none : some(hint!.unit),
                step: step === undefined ? none : some(step), min: min === undefined ? none : some(min), max: max === undefined ? none : some(max),
            });
        }
        case "select": {
            if (!isChoice(type)) refuse("Fields.select chooses among a variant's cases");
            if (optional && holdsData(type)) {
                throw new Error(`Fields: "${at}" is ${kindOf(OptionType(type))} field whose cases hold data, printed whole — Fields.select chooses among a variant's cases, or an Option's whose cases are each empty (NullType)`);
            }
            if (whole) refuse("a case of it holds a value East has no default for (a recursive type), so it is printed whole — Fields.select chooses among cases whose values can start");
            const types = (type as VariantType).cases as Record<string, EastType>;
            const cases = Object.keys(types);
            const labels = hint!.labels ?? {};
            const named = Object.keys(labels);
            const stray = named.filter((c) => !cases.includes(c));
            if (stray.length > 0) refuse(`its select hint labels ${stray.map((c) => `"${c}"`).join(", ")}, ${stray.length === 1 ? "a case" : "cases"} the variant does not have (${cases.join(", ")})`);
            const hinted = Object.keys(hint!.cases ?? {});
            const unknown = hinted.filter((c) => !cases.includes(c));
            if (unknown.length > 0) refuse(`its select hint gives a hint to ${unknown.map((c) => `"${c}"`).join(", ")}, ${unknown.length === 1 ? "a case" : "cases"} the variant does not have (${cases.join(", ")})`);
            const empty = hinted.filter((c) => isTypeEqual(types[c]!, NullType));
            if (empty.length > 0) refuse(`its select hint gives a hint to ${empty.map((c) => `"${c}"`).join(", ")}, ${empty.length === 1 ? "an empty case" : "empty cases"} (NullType), with no value to edit`);
            // The cases the hint labels, in its order, then the rest in the variant's.
            const order = [...named, ...cases.filter((c) => !named.includes(c))];
            return variant("select", order.map((c) => ({ case: c, label: labels[c] ?? spellOut(c) })));
        }
        case "tags": {
            if (!isStrings(type)) refuse("Fields.tags edits a Set or an Array of String");
            const options = hint!.options ?? [];
            if (options.some((o) => typeof o !== "string")) refuse("its tags hint's options are the String values it suggests");
            return variant("tags", { options: [...new Set(options as readonly string[])] });
        }
        case "checklist": {
            if (!isItemList(type)) refuse("Fields.checklist edits an Array of item structs");
            return variant("checklist", checklistOf(type.value, hint, at)!);
        }
        default:
            throw new Error(`Fields: "${at}"'s hint is "${String(kind)}", which is not one of Fields' hints`);
    }
    // The type's own editor.
    if (isTypeEqual(type, StringType)) return variant("text", { placeholder: none });
    if (isTypeEqual(type, IntegerType) || isTypeEqual(type, FloatType)) return variant("number", { unit: none, step: none, min: none, max: none });
    if (isTypeEqual(type, BooleanType)) return variant("checkbox", null);
    if (isTypeEqual(type, DateTimeType)) return variant("datetime", { precision: none });
    if (isStrings(type)) return variant("tags", { options: [] });
    if (isItemList(type)) {
        const found = checklistOf(type.value, undefined, at);
        if (found !== undefined) return variant("checklist", found);
    }
    if (isChoice(type) && !whole) return variant("select", Object.keys(type.cases).map((c) => ({ case: c, label: spellOut(c) })));
    return variant("readonly", null);
}

/**
 * Resolves a struct's fields under `path`, appending their specs in order: the
 * hinted fields in hint order, then the rest in declared order, `omit`'s left
 * out.
 */
function specsOf(
    struct: StructType,
    hints: Readonly<Record<string, unknown>>,
    path: readonly string[],
    group: string | undefined,
    nest: boolean,
    out: FieldSpecValue[],
    omit: ReadonlySet<string> = new Set(),
): void {
    const fields = struct.fields as Record<string, EastType>;
    for (const name of Object.keys(hints)) {
        if (!(name in fields)) throw new Error(`Fields: a hint names "${[...path, name].join(".")}", a field the struct does not have (${Object.keys(fields).join(", ")})`);
    }
    const order = [...Object.keys(hints), ...Object.keys(fields).filter((name) => !(name in hints))];
    for (const name of order) {
        if (!omit.has(name)) specOf(fields[name]!, hints[name], [...path, name], spellOut(name), group, nest, out);
    }
}

/**
 * Resolves one field, or one case's value, at `at`, appending its specs: a
 * struct's fields — grouped under `label` where `nest` says so, and among the
 * specs around them in a case's block — or its own spec, then, after a
 * variant's select, each case's value's, in the select's order.
 */
function specOf(
    type: EastType,
    hint: unknown,
    at: string[],
    label: string,
    group: string | undefined,
    nest: boolean,
    out: FieldSpecValue[],
): void {
    const where = at.join(".");
    if (hint !== undefined && !isHint(hint) && (hint === null || typeof hint !== "object" || type.type !== "Struct")) {
        throw new Error(`Fields: "${where}" is ${kindOf(type)} field — its hint is one of Fields' hints${type.type === "Struct" ? ", or a hint per field of its struct" : ""}`);
    }
    if (isHint(hint) && hint[FIELD_HINT] === "hidden") return;
    // A nested struct: its own fields, grouped under its name.
    if (type.type === "Struct" && !isHint(hint)) {
        const heading = !nest ? group : group === undefined ? label : `${group} · ${label}`;
        specsOf(type, (hint ?? {}) as Readonly<Record<string, unknown>>, at, heading, nest, out);
        return;
    }
    const typed = isHint(hint) ? hint : undefined;
    const optional = isOptionType(type);
    const editor = editorOf(optional ? type.cases.some : type, typed, where, optional);
    out.push({
        path: at,
        label: typed?.label ?? label,
        help: typed?.help === undefined ? none : some(typed.help),
        group: group === undefined ? none : some(group),
        type: toEastTypeValue(type),
        optional,
        editor,
    });
    // A variant chosen among: each case's value at a path through the case's
    // name, labelled with the case's words — a struct case's fields among the
    // block's, never under a heading of their own.
    if (optional || editor.type !== "select") return;
    const cases = (type as VariantType).cases as Record<string, EastType>;
    const hints = typed?.cases ?? {};
    for (const option of editor.value) {
        const value = cases[option.case]!;
        if (!isTypeEqual(value, NullType)) specOf(value, hints[option.case], [...at, option.case], option.label, group, false, out);
    }
}

/**
 * Resolves a struct's fields and hints into the specs a form draws: each
 * field's editor from its type, or from its hint, checked against the type;
 * the hinted fields first, in hint order, then the rest in declared order; a
 * nested struct's fields flattened by path, under its name; a variant's
 * cases' values after its select, at paths through the case's name; `omit`'s
 * and the hidden fields left out.
 *
 * @typeParam R - The struct
 * @param rowType - The struct the form edits
 * @param hints - A hint for any of its fields, a nested struct's a hint per field
 * @param omit - Fields of the struct the form leaves out — a host's own (the Calendar's title, start and end)
 * @returns The specs, in the form's order
 * @throws {Error} Naming the field, for a hint that does not fit its field's type, a select labelling or hinting a case its variant does not have or hinting an empty one, a select over an Option of a variant whose cases hold data, a reference in a field no Dict may be keyed by, a checklist whose text and done fields cannot be found, or a name the struct does not have
 * @example
 * ```ts
 * import { ArrayType, BooleanType, East, IntegerType, OptionType, StringType, StructType, VariantType, NullType } from "@elaraai/east";
 * import { Fields } from "@elaraai/east-ui";
 *
 * const form = East.function([], ArrayType(StringType), ($) => {
 *     const Status = VariantType({ planned: NullType, in_progress: NullType, on_hold: NullType });
 *     const Check = StructType({ text: StringType, done: BooleanType });
 *     const Job = StructType({
 *         task: StringType, crew: IntegerType, status: Status, rush: BooleanType,
 *         bay: OptionType(StringType), checks: ArrayType(Check), notes: StringType,
 *     });
 *     const specs = $.const(Fields.specs(Job, {
 *         crew: Fields.number({ unit: "people", min: 1n, max: 20n }),
 *         status: Fields.select({ labels: { on_hold: "Paused" } }),
 *         bay: Fields.reference({ of: "bays", label: "Work bay" }),
 *         notes: Fields.hidden(),
 *     }), ArrayType(Fields.Types.Spec));
 *     return specs.map((_$, spec) => East.str`${spec.label}: ${spec.editor.getTag()}`);
 * });
 * ```
 */
export function fieldSpecs<R extends StructType>(
    rowType: R,
    hints: FieldHints<R["fields"]> = {} as FieldHints<R["fields"]>,
    omit: readonly (keyof R["fields"] & string)[] = [],
): FieldSpecValue[] {
    if ((rowType as EastType).type !== "Struct") throw new Error(`Fields: a form is over a struct, not ${kindOf(rowType)}`);
    const fields = rowType.fields as Record<string, EastType>;
    for (const name of omit) {
        if (!(name in fields)) throw new Error(`Fields: omit names "${name}", a field the struct does not have (${Object.keys(fields).join(", ")})`);
    }
    const out: FieldSpecValue[] = [];
    specsOf(rowType, hints as Readonly<Record<string, unknown>>, [], undefined, true, out, new Set(omit));
    return out;
}

// ============================================================================
// Namespace
// ============================================================================

/**
 * The type of the {@link Fields} namespace — declared explicitly so the
 * declaration emit stays within TypeScript's serialization limit.
 */
export interface FieldsNamespace {
    /** A String field's text box. */
    text: typeof fieldText;
    /** A DateTime field's date field — a date, a time, or both. */
    date: typeof fieldDate;
    /** A number field's stepper — bigints for an Integer field, numbers for a Float. */
    number: typeof fieldNumber;
    /** A variant field's select, with words for its cases and hints for their values. */
    select: typeof fieldSelect;
    /** A string collection's tags, with the values offered. */
    tags: typeof fieldTags;
    /** An item list's checklist, naming its items' text and done fields. */
    checklist: typeof fieldChecklist;
    /** A field holding a key of a keyed set the host lists, of any type a Dict may be keyed by. */
    reference: typeof fieldReference;
    /** A field printed, never edited. */
    readonly: typeof fieldReadonly;
    /** A field the form leaves out. */
    hidden: typeof fieldHidden;
    /** Resolves a struct's fields and hints into the specs a form draws. */
    specs: typeof fieldSpecs;
    /** The fields contract's East types. */
    Types: {
        /** One field of a form, resolved ({@link FieldSpecType}). */
        Spec: typeof FieldSpecType;
        /** How a field is edited ({@link FieldEditorType}). */
        Editor: typeof FieldEditorType;
        /** One choice of a select ({@link FieldOptionType}). */
        Option: typeof FieldOptionType;
    };
}

/**
 * The fields contract (#1147) — a typed form over an East struct: each
 * field's editor from its type, a hint for what a type cannot say, and
 * `Fields.specs` resolving them into the specs east-ui-components'
 * `FieldForm` draws. A builder's inspector carries them; the Calendar's
 * `Calendar.field` is this namespace.
 */
export const Fields: FieldsNamespace = {
    text: fieldText,
    date: fieldDate,
    number: fieldNumber,
    select: fieldSelect,
    tags: fieldTags,
    checklist: fieldChecklist,
    reference: fieldReference,
    readonly: fieldReadonly,
    hidden: fieldHidden,
    specs: fieldSpecs,
    Types: {
        Spec: FieldSpecType,
        Editor: FieldEditorType,
        Option: FieldOptionType,
    },
};
