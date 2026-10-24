/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row's fields, read by name (#1367, #1386): the field types an option may
 * name, a field read as an East expression, and a field holding the key of a
 * keyed entity of a builder — one of Schedule's resources, one of the
 * Schematic's items — by one kind's key, or a kind per case. Such a field is
 * read as a reference to the entity, its kind's slot and its key, and written
 * back from one.
 *
 * Schedule's event kinds (`events.ts`, a resource field) and the Schematic's
 * links (a link's ends) check and read such a field through these, each
 * naming the option and what the keys are of in its own words.
 *
 * A row's fields are written by name too ({@link fieldSetters}): a setter for
 * every field at any depth, which an inspector's edit of a Schedule kind's
 * field writes through, and an author's card dropped on a Schematic entity
 * (#1390).
 *
 * @packageDocumentation
 */

import {
    BlobType, East, OptionType, StringType, isTypeEqual, none, some, variant,
    type EastType, type ExprType, type FunctionType, type StructType,
} from "@elaraai/east";
import { ScheduleResourceRefType } from "./types.js";
import { optionOf, typeText } from "./window.js";

/** The names of a struct's fields. */
export type FieldName<R extends StructType> = keyof R["fields"] & string;

/** The fields of a struct whose type is `T`. */
export type FieldsOf<R extends StructType, T> = { [F in FieldName<R>]: R["fields"][F] extends T ? F : never }[FieldName<R>];

/**
 * A field of a struct as an East expression, by name.
 *
 * @param row - The struct, as an East expression
 * @param name - The field's name
 * @returns The field
 */
export function fieldOf(row: unknown, name: string): ExprType<EastType> {
    return (row as Record<string, ExprType<EastType>>)[name]!;
}

/** One field of a row, at any depth, and what a write of its value leaves the row. */
export interface FieldSetter {
    /** The field's path: its name, after the names of the structs it is in. */
    readonly path: readonly string[];
    /** `(row, bytes)` → the row with the field set to the value the bytes hold at the field's type, every other field as it was. */
    readonly set: ExprType<FunctionType<[EastType, BlobType], EastType>>;
}

/**
 * A setter for every field of a row, at any depth: what an inspector's edit of
 * one field writes through — a Schedule kind's `field` gesture — and an
 * author's card's patch dropped on a Schematic entity, a field at a time
 * (#1390). Each takes the field's value as bytes at the field's type, and
 * rebuilds the structs down its path from the leaf up, every other field as it
 * was.
 *
 * @param rowType - The row type
 * @returns Each field's setter: a field, then the fields of a struct it holds, in the row's order
 */
export function fieldSetters(rowType: StructType): FieldSetter[] {
    const setters: FieldSetter[] = [];
    const setterOf = (prefix: readonly string[], name: string, type: EastType): ExprType<FunctionType<[EastType, BlobType], EastType>> =>
        East.function([rowType, BlobType], rowType, (_$, row, bytes) => {
            const value = bytes.decodeBeast(type, "v2") as ExprType<EastType>;
            // The structs down the path, each with the field below it replaced, rebuilt from the leaf up.
            const chain: { struct: StructType; field: string; at: ExprType<EastType> }[] = [];
            let at = row as ExprType<EastType>;
            let struct: StructType = rowType;
            for (const step of prefix) {
                chain.push({ struct, field: step, at });
                at = fieldOf(at, step);
                struct = (struct.fields as Record<string, EastType>)[step] as StructType;
            }
            const leaf = struct;
            const leafAt = at;
            let next = East.value(Object.fromEntries(Object.keys(leaf.fields).map((f) => [f, f === name ? value : fieldOf(leafAt, f)])) as never, leaf) as ExprType<EastType>;
            for (let i = chain.length - 1; i >= 0; i--) {
                const link = chain[i]!;
                const inner = next;
                next = East.value(Object.fromEntries(Object.keys(link.struct.fields).map((f) => [f, f === link.field ? inner : fieldOf(link.at, f)])) as never, link.struct) as ExprType<EastType>;
            }
            return next as never;
        }) as unknown as ExprType<FunctionType<[EastType, BlobType], EastType>>;
    const collect = (struct: StructType, prefix: readonly string[]): void => {
        for (const [name, type] of Object.entries(struct.fields as Record<string, EastType>)) {
            setters.push({ path: [...prefix, name], set: setterOf(prefix, name, type) });
            if (type.type === "Struct") collect(type, [...prefix, name]);
        }
    };
    collect(rowType, []);
    return setters;
}

/**
 * A variant's cases, when every one of them holds a String.
 *
 * @param type - The type
 * @returns Its cases, in order; `undefined` for a type that is no such variant, or an Option
 */
export function stringCases(type: EastType): string[] | undefined {
    if (type.type !== "Variant" || optionOf(type) !== undefined) return undefined;
    const cases = Object.entries(type.cases as Record<string, EastType>);
    return cases.length > 0 && cases.every(([, t]) => isTypeEqual(t, StringType)) ? cases.map(([c]) => c) : undefined;
}

/**
 * A field holding the key of a keyed entity, checked: a String holding a key
 * of the one kind `of` names, or a variant of String cases holding a key of
 * the kind its case names — either, or an Option of either.
 */
export type KeyField =
    | { readonly field: string; readonly shape: "key"; readonly of: string; readonly optional: boolean }
    | {
        readonly field: string; readonly shape: "cases"; readonly of: Readonly<Record<string, string>>; readonly cases: readonly string[];
        readonly optional: boolean; readonly variant: EastType;
    };

/** How a key field's refusals name it. */
export interface KeyFieldWords {
    /** What refuses it, as a refusal starts (`Schedule.events: "Shift"`). */
    readonly where: string;
    /** The option, as a refusal names it (`resource`, `from`). */
    readonly prop: string;
    /** What its keys are keys of (`resource`, `item`). */
    readonly noun: string;
}

/**
 * Checks a key field (see {@link KeyField}).
 *
 * @param field - The field's name
 * @param type - The field's type
 * @param of - What its option's `of` names: a slot, or a slot per case
 * @param words - How the refusals name it
 * @returns The field, checked
 * @throws {Error} Naming the option: a String field whose `of` names no slot;
 *   a variant whose `of` does not name a slot for each of its cases, or names
 *   one slot twice; a field holding neither a String nor a variant of String
 *   cases, nor an Option of either
 */
export function checkKeyField(field: string, type: EastType, of: unknown, words: KeyFieldWords): KeyField {
    const { where, prop, noun } = words;
    const inner = optionOf(type) ?? type;
    const optional = optionOf(type) !== undefined;
    const cases = stringCases(inner);
    if (isTypeEqual(inner, StringType)) {
        if (typeof of !== "string" || of === "") {
            throw new Error(`${where}: \`${prop}.of\` names the ${noun} slot "${field}" holds keys of — a String field holds one kind's keys`);
        }
        return { field, shape: "key", of, optional };
    }
    if (cases !== undefined) {
        if (typeof of !== "object" || of === null) {
            throw new Error(`${where}: "${field}" is a variant — \`${prop}.of\` names a ${noun} slot per case: { ${cases.map((c) => `${c}: "…"`).join(", ")} }`);
        }
        const slots = of as Readonly<Record<string, string>>;
        const named = Object.keys(slots);
        if (named.length !== cases.length || !named.every((c) => cases.includes(c))) {
            throw new Error(`${where}: \`${prop}.of\` names a ${noun} slot for each of "${field}"'s cases (${cases.join(", ")}) — and it names ${named.join(", ") || "none"}`);
        }
        const kinds = Object.values(slots);
        if (new Set(kinds).size !== kinds.length) {
            throw new Error(`${where}: \`${prop}.of\` names each ${noun} slot once — a case per kind of ${noun} — and it names ${kinds.join(", ")}`);
        }
        return { field, shape: "cases", of: slots, cases, optional, variant: inner };
    }
    throw new Error(`${where}: \`${prop}.field\` names a field holding a ${noun}'s key — a String, a variant of String cases, or an Option of either — and "${field}" holds ${typeText(type)}`);
}

/**
 * The slots a key field's keys are of, in order.
 *
 * @param field - The field, checked
 * @returns Its one slot, or a slot per case
 */
export function keyFieldSlots(field: KeyField): string[] {
    return field.shape === "key" ? [field.of] : Object.values(field.of);
}

/** A reference to a keyed entity, as an Option: none for an Option field holding none. */
const RefOption = OptionType(ScheduleResourceRefType);

/**
 * Reads a key field as a reference to the entity it names: its kind's slot
 * and its key — `none` for an Option field holding none, or for a row of a
 * builder whose kind has no such field.
 *
 * @param field - The field, checked; `undefined`, the kind has none
 * @param rowType - The row type
 * @returns `(row)` → the reference, if any
 */
export function keyFieldRef(field: KeyField | undefined, rowType: EastType): ExprType<FunctionType<[EastType], OptionType<typeof ScheduleResourceRefType>>> {
    return East.function([rowType], RefOption, (_$, row) => {
        if (field === undefined) return East.value(none, RefOption);
        const value = fieldOf(row, field.field);
        if (field.shape === "key") {
            const kind = field.of;
            const ref = (key: ExprType<StringType>) => East.value(some(East.value({ kind, key }, ScheduleResourceRefType)), RefOption);
            return field.optional
                ? (value as unknown as ExprType<OptionType<StringType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, key) => ref(key) })
                : ref(value as unknown as ExprType<StringType>);
        }
        const of = field.of;
        const byCase = (v: ExprType<EastType>) => (v as unknown as { match: (arms: object) => ExprType<EastType> }).match(Object.fromEntries(field.cases.map((c) =>
            [c, (_$2: unknown, key: ExprType<StringType>) => East.value(some(East.value({ kind: of[c]!, key }, ScheduleResourceRefType)), RefOption)])));
        return field.optional
            ? (value as unknown as ExprType<OptionType<EastType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, v) => byCase(v) })
            : byCase(value);
    }) as unknown as ExprType<FunctionType<[EastType], OptionType<typeof ScheduleResourceRefType>>>;
}

/**
 * The value a key field takes for a reference: `none` where the field
 * refuses it — a reference to a kind it does not hold keys of, or no
 * reference for a field that must hold one.
 *
 * @param field - The field, checked
 * @param valueType - The field's type
 * @returns `(ref)` → the field's value, if it takes the reference
 */
export function keyFieldValue(field: KeyField, valueType: EastType): ExprType<FunctionType<[OptionType<typeof ScheduleResourceRefType>], OptionType<EastType>>> {
    return East.function([RefOption], OptionType(valueType), ($, ref) => {
        const result = $.let(East.value(none as never, OptionType(valueType)), OptionType(valueType));
        $.match(ref, {
            none: ($2) => {
                if (field.optional) $2.assign(result, East.value(some(East.value(none as never, valueType)) as never, OptionType(valueType)));
            },
            some: ($2, r) => {
                if (field.shape === "key") {
                    const key = field.optional ? East.value(some(r.key) as never, valueType) : r.key;
                    $2.if(East.equal(r.kind, field.of), ($3) => { $3.assign(result, East.value(some(key) as never, OptionType(valueType))); });
                } else {
                    for (const c of field.cases) {
                        const caseValue = East.value(variant(c, r.key) as never, field.variant);
                        const held = field.optional ? East.value(some(caseValue) as never, valueType) : caseValue;
                        $2.if(East.equal(r.kind, field.of[c]!), ($3) => { $3.assign(result, East.value(some(held) as never, OptionType(valueType))); });
                    }
                }
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[OptionType<typeof ScheduleResourceRefType>], OptionType<EastType>>>;
}
