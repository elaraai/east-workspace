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
 * back from one. A key may be of any type a Dict is keyed by (#1549): a
 * reference holds it as its text, a String key as itself and any other as
 * East prints it, and a write reads it back at the field's type.
 *
 * Schedule's event kinds (`events.ts`, a resource field) and the Schematic's
 * links (a link's ends) check and read such a field through these, each
 * naming the option and what the keys are of in its own words. An event
 * kind's resource field holds a resource's key as text, so it takes a String
 * or String cases alone, and says so itself.
 *
 * A row's fields are written by name too ({@link fieldSetters}): a setter for
 * every field at any depth, and for the value of a variant's case (#1549),
 * which an inspector's edit of a Schedule kind's field writes through, and an
 * author's card dropped on a Schematic entity (#1390).
 *
 * @packageDocumentation
 */

import {
    BlobType, East, NullType, OptionType, StringType, isImmutableType, isTypeEqual, none, some, variant,
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
    /** The field's path: its name, after the names of the structs it is in and the cases it is under. */
    readonly path: readonly string[];
    /** `(row, bytes)` → the row with the field set to the value the bytes hold at the field's type, every other field as it was. */
    readonly set: ExprType<FunctionType<[EastType, BlobType], EastType>>;
}

/**
 * A setter for every field of a row, at any depth, and for every value a
 * variant's case holds (#1549): what an inspector's edit of one field writes
 * through — a Schedule kind's `field` gesture — and an author's card's patch
 * dropped on a Schematic entity, a field at a time (#1390). Each takes the
 * field's value as bytes at the field's type, and rebuilds what is down its
 * path from the leaf up, every other field as it was: a struct with the field
 * below it replaced, and a variant with its case's value rebuilt while it
 * holds that case — while it holds another, the row is left as it was.
 *
 * @param rowType - The row type
 * @returns Each field's setter: a field, then the fields of a struct it holds and the values of a variant's cases holding data — never an Option's — in the row's order
 */
export function fieldSetters(rowType: StructType): FieldSetter[] {
    const setters: FieldSetter[] = [];
    // `at`, of `type`, with what is at `steps` below it set to `value`: the structs and the cases down the path, each
    // rebuilt from the leaf up.
    const rebuild = (at: ExprType<EastType>, type: EastType, steps: readonly string[], value: ExprType<EastType>): ExprType<EastType> => {
        const [step, ...rest] = steps;
        if (step === undefined) return value;
        if (type.type === "Variant") {
            const held = (type.cases as Record<string, EastType>)[step]!;
            return (at as unknown as { matchTag: (tag: string, arm: (_$: unknown, inner: ExprType<EastType>) => ExprType<EastType>, other: (_$: unknown) => ExprType<EastType>) => ExprType<EastType> })
                .matchTag(step, (_$, inner) => East.value(variant(step, rebuild(inner, held, rest, value)) as never, type) as ExprType<EastType>, (_$) => at);
        }
        const fields = (type as StructType).fields as Record<string, EastType>;
        return East.value(Object.fromEntries(Object.keys(fields).map((f) => [f, f === step ? rebuild(fieldOf(at, f), fields[f]!, rest, value) : fieldOf(at, f)])) as never, type) as ExprType<EastType>;
    };
    const setterOf = (path: readonly string[], type: EastType): ExprType<FunctionType<[EastType, BlobType], EastType>> =>
        East.function([rowType, BlobType], rowType, (_$, row, bytes) =>
            rebuild(row as ExprType<EastType>, rowType, path, bytes.decodeBeast(type, "v2") as ExprType<EastType>) as never,
        ) as unknown as ExprType<FunctionType<[EastType, BlobType], EastType>>;
    const collect = (type: EastType, prefix: readonly string[]): void => {
        const below = type.type === "Struct" ? Object.entries(type.fields as Record<string, EastType>)
            : type.type === "Variant" && optionOf(type) === undefined ? Object.entries(type.cases as Record<string, EastType>).filter(([, t]) => !isTypeEqual(t, NullType))
            : [];
        for (const [name, inner] of below) {
            setters.push({ path: [...prefix, name], set: setterOf([...prefix, name], inner) });
            collect(inner, [...prefix, name]);
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
 * A variant's cases, when each holds a type a Dict may be keyed by (#1549):
 * what a field naming a kind per case holds, each case a key of the kind it
 * names.
 *
 * @param type - The type
 * @returns Its cases, in order; `undefined` for a type that is no such variant, or an Option
 */
export function keyCases(type: EastType): string[] | undefined {
    if (type.type !== "Variant" || optionOf(type) !== undefined) return undefined;
    const cases = Object.entries(type.cases as Record<string, EastType>);
    return cases.length > 0 && cases.every(([, t]) => isImmutableType(t)) ? cases.map(([c]) => c) : undefined;
}

/**
 * A field holding the key of a keyed entity, checked: a field holding a key
 * of the one kind `of` names, or a variant holding a key of the kind its case
 * names — either, or an Option of either. Each key is of any type a Dict may be
 * keyed by (#1549): `key` is the one a field holds, `keys` each case's.
 */
export type KeyField =
    | { readonly field: string; readonly shape: "key"; readonly of: string; readonly optional: boolean; readonly key: EastType }
    | {
        readonly field: string; readonly shape: "cases"; readonly of: Readonly<Record<string, string>>; readonly cases: readonly string[];
        readonly optional: boolean; readonly variant: EastType; readonly keys: Readonly<Record<string, EastType>>;
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
 * Checks a key field (see {@link KeyField}). Its `of` decides its shape
 * (#1549): a slot's name, and the field holds that slot's key — of any type a
 * Dict may be keyed by, a variant among them; a slot per case, and the field
 * is a variant whose cases each hold their own slot's key. Whether a key is of
 * its slot's key type is the builder's to check, where both kinds are known.
 *
 * @param field - The field's name
 * @param type - The field's type
 * @param of - What its option's `of` names: a slot, or a slot per case
 * @param words - How the refusals name it
 * @returns The field, checked
 * @throws {Error} Naming the option: a field holding a type no Dict is keyed
 *   by, nor an Option of one; an `of` naming no slot, for a field that is no
 *   variant of keys, or neither a slot nor a slot per case, for one that is;
 *   an `of` that does not name a slot for each of the variant's cases, or
 *   names one slot twice
 */
export function checkKeyField(field: string, type: EastType, of: unknown, words: KeyFieldWords): KeyField {
    const { where, prop, noun } = words;
    const one = `${/^[aeiou]/.test(noun) ? "an" : "a"} ${noun}`;
    const inner = optionOf(type) ?? type;
    const optional = optionOf(type) !== undefined;
    if (!isImmutableType(inner)) {
        throw new Error(`${where}: \`${prop}.field\` names a field holding ${one}'s key — of a type a Dict may be keyed by, a variant holding one per case, ` +
            `or an Option of either — and "${field}" holds ${typeText(type)}`);
    }
    // A slot's name: the field holds that slot's key.
    if (typeof of === "string" && of !== "") return { field, shape: "key", of, optional, key: inner };
    const cases = keyCases(inner);
    if (cases === undefined) {
        throw new Error(`${where}: \`${prop}.of\` names the ${noun} slot "${field}" holds keys of — ` +
            `${isTypeEqual(inner, StringType) ? "a String field" : `a field holding ${typeText(inner)}`} holds one kind's keys`);
    }
    if (typeof of !== "object" || of === null) {
        throw new Error(`${where}: "${field}" is a variant — \`${prop}.of\` names ${one} slot per case: { ${cases.map((c) => `${c}: "…"`).join(", ")} }`);
    }
    const slots = of as Readonly<Record<string, string>>;
    const named = Object.keys(slots);
    if (named.length !== cases.length || !named.every((c) => cases.includes(c))) {
        throw new Error(`${where}: \`${prop}.of\` names ${one} slot for each of "${field}"'s cases (${cases.join(", ")}) — and it names ${named.join(", ") || "none"}`);
    }
    const kinds = Object.values(slots);
    if (new Set(kinds).size !== kinds.length) {
        throw new Error(`${where}: \`${prop}.of\` names each ${noun} slot once — a case per kind of ${noun} — and it names ${kinds.join(", ")}`);
    }
    const held = (inner as { readonly cases: Readonly<Record<string, EastType>> }).cases;
    return { field, shape: "cases", of: slots, cases, optional, variant: inner, keys: Object.fromEntries(cases.map((c) => [c, held[c]!])) };
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
 * and its key's text, a String key as itself and any other as East prints it
 * (#1549) — `none` for an Option field holding none, or for a row of a
 * builder whose kind has no such field.
 *
 * @param field - The field, checked; `undefined`, the kind has none
 * @param rowType - The row type
 * @returns `(row)` → the reference, if any
 */
export function keyFieldRef(field: KeyField | undefined, rowType: EastType): ExprType<FunctionType<[EastType], OptionType<typeof ScheduleResourceRefType>>> {
    // A key's text: a String key's IR is today's, no print in it.
    const textOf = (key: ExprType<EastType>, keyType: EastType): ExprType<StringType> =>
        keyType.type === "String" ? key as unknown as ExprType<StringType> : East.print(key);
    return East.function([rowType], RefOption, (_$, row) => {
        if (field === undefined) return East.value(none, RefOption);
        const value = fieldOf(row, field.field);
        if (field.shape === "key") {
            const kind = field.of;
            const ref = (key: ExprType<EastType>) => East.value(some(East.value({ kind, key: textOf(key, field.key) }, ScheduleResourceRefType)), RefOption);
            return field.optional
                ? (value as unknown as ExprType<OptionType<EastType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, key) => ref(key) })
                : ref(value);
        }
        const of = field.of;
        const byCase = (v: ExprType<EastType>) => (v as unknown as { match: (arms: object) => ExprType<typeof RefOption> }).match(Object.fromEntries(field.cases.map((c) =>
            [c, (_$2: unknown, key: ExprType<EastType>) => East.value(some(East.value({ kind: of[c]!, key: textOf(key, field.keys[c]!) }, ScheduleResourceRefType)), RefOption)])));
        return field.optional
            ? (value as unknown as ExprType<OptionType<EastType>>).match({ none: (_$2) => East.value(none, RefOption), some: (_$2, v) => byCase(v) })
            : byCase(value);
    }) as unknown as ExprType<FunctionType<[EastType], OptionType<typeof ScheduleResourceRefType>>>;
}

/**
 * The value a key field takes for a reference: `none` where the field
 * refuses it — a reference to a kind it does not hold keys of, a key whose
 * text no key of the field's type prints as (#1549), or no reference for a
 * field that must hold one.
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
                    if (field.key.type === "String") {
                        // A String key's IR is today's: its text is the key.
                        const key = field.optional ? East.value(some(r.key) as never, valueType) : r.key;
                        $2.if(East.equal(r.kind, field.of), ($3) => { $3.assign(result, East.value(some(key) as never, OptionType(valueType))); });
                    } else {
                        // Any other key read back from its text at its type: a text no key prints as takes nothing.
                        const keyType = field.key;
                        $2.if(East.equal(r.kind, field.of), ($3) => {
                            $3.try(($4) => {
                                const key = $4.const(r.key.parse(keyType) as ExprType<EastType>);
                                const held = field.optional ? East.value(some(key) as never, valueType) : key;
                                $4.assign(result, East.value(some(held) as never, OptionType(valueType)));
                            }).catch((_$4) => {});
                        });
                    }
                } else {
                    const variantType = field.variant;
                    for (const c of field.cases) {
                        const keyType = field.keys[c]!;
                        if (keyType.type === "String") {
                            const caseValue = East.value(variant(c, r.key) as never, variantType);
                            const held = field.optional ? East.value(some(caseValue) as never, valueType) : caseValue;
                            $2.if(East.equal(r.kind, field.of[c]!), ($3) => { $3.assign(result, East.value(some(held) as never, OptionType(valueType))); });
                        } else {
                            // The case's key read back from its text at the case's type.
                            $2.if(East.equal(r.kind, field.of[c]!), ($3) => {
                                $3.try(($4) => {
                                    const key = $4.const(r.key.parse(keyType) as ExprType<EastType>);
                                    const caseValue = East.value(variant(c, key) as never, variantType);
                                    const held = field.optional ? East.value(some(caseValue) as never, valueType) : caseValue;
                                    $4.assign(result, East.value(some(held) as never, OptionType(valueType)));
                                }).catch((_$4) => {});
                            });
                        }
                    }
                }
            },
        });
        return result;
    }) as unknown as ExprType<FunctionType<[OptionType<typeof ScheduleResourceRefType>], OptionType<EastType>>>;
}
