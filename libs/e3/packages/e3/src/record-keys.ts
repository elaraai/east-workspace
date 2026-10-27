/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reading a record's row by the names a declaration gives.
 *
 * East names a struct's fields where its code is written. A generated index
 * reads the fields its declaration names — its leading fields, an event's
 * start and end, a box's place — which exist only as the declaration runs. So
 * every generated program reads its row through a reader made here: an East
 * function giving a struct of the declared fields, under names of its own,
 * over which the rest of the program is ordinary East.
 *
 * The readers are the one place in the record code East's own rules cannot
 * check, and the region holding them is marked so: everything else is held to
 * the rules.
 *
 * @packageDocumentation
 */
import {
  DateTimeType, East, OptionType, SetType, StructType, isTypeEqual, printType, some,
  type EastType, type ExprType, type FunctionExpr,
} from '@elaraai/east';

/** A record's Struct row type, its fields named at run time. */
export type RowType = StructType<Record<string, EastType>>;

/** One leading field: its name, its type in the key (a Set field's element), and whether it fans a row out. */
export interface LeadingField {
  readonly field: string;
  readonly type: EastType;
  readonly set: boolean;
}

/** An index's leading fields, checked: each field, the key's `on` struct, and whether a Set among them fans a row out. */
export interface Leading {
  readonly fields: readonly LeadingField[];
  readonly onType: RowType;
  readonly multi: boolean;
}

/**
 * Checks an index's leading fields against the record's row.
 *
 * @param name - The index, for the refusals
 * @param rowType - The record's row type
 * @param on - The leading fields, in key order; none for an index led by none
 * @returns The fields, the key's `on`, and whether a row fans out
 * @throws {Error} When a field is named twice, or is not one of the row's
 */
export function checkLeading(name: string, rowType: RowType, on: readonly string[]): Leading {
  if (new Set(on).size !== on.length) throw new Error(`e3.recordIndex '${name}' on must not repeat a field`);
  const fields = on.map((field): LeadingField => {
    const type = rowType.fields[field];
    if (type === undefined) throw new Error(`e3.recordIndex '${name}' on names unknown row field '${field}'`);
    return type.type === 'Set' ? { field, type: type.key, set: true } : { field, type, set: false };
  });
  return {
    fields,
    onType: StructType(Object.fromEntries(fields.map((f) => [f.field, f.type]))),
    multi: fields.some((f) => f.set),
  };
}

/**
 * A field read as an Option: its name, whether the row holds an Option of it —
 * which a row may leave `none` — or the value itself, and the type inside.
 *
 * @typeParam T - The type inside the Option
 */
export interface OptionField<T extends EastType = EastType> {
  readonly field: string;
  readonly optional: boolean;
  readonly type: T;
}

/**
 * Checks a field read as an Option of a type: the type itself, or an Option of
 * it.
 *
 * @param rowType - The record's row type
 * @param field - The field
 * @param type - The type inside the Option
 * @returns The field, and whether it is an Option; `undefined` for a field of another type, or none
 */
export function optionField<T extends EastType>(rowType: RowType, field: string, type: T): OptionField<T> | undefined {
  const held = rowType.fields[field];
  if (held === undefined) return undefined;
  if (isTypeEqual(held, type)) return { field, optional: false, type };
  if (isTypeEqual(held, OptionType(type))) return { field, optional: true, type };
  return undefined;
}

/**
 * Checks a field an event starts or ends at: a DateTime, or an Option of one.
 *
 * @param constructor - The constructor, as a refusal names it
 * @param name - The index
 * @param rowType - The record's row type
 * @param option - The option naming the field, as a refusal names it
 * @param field - The field
 * @returns The field, and whether it is an Option
 * @throws {Error} When the row has no such field, or it is of another type, naming the option, the field and its type
 */
export function checkTimeField(constructor: string, name: string, rowType: RowType, option: string, field: string): OptionField<DateTimeType> {
  const type = rowType.fields[field];
  if (type === undefined) throw new Error(`${constructor} '${name}' ${option} names unknown row field '${field}'`);
  const time = optionField(rowType, field, DateTimeType);
  if (time === undefined) {
    throw new Error(`${constructor} '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a DateTime or an Option<DateTime> field`);
  }
  return time;
}

/**
 * What a reader reads into one field of its struct: a row field's value as it
 * is, at its type, or a field as an Option — a field holding the value itself
 * read as its `some`.
 */
export type Read =
  | { readonly field: string; readonly type: EastType }
  | { readonly option: OptionField };

/** The type a read gives. */
export type ReadType<R> = R extends { readonly option: OptionField<infer T> } ? OptionType<T>
  : R extends { readonly type: infer T extends EastType } ? T : never;

/** The struct a reader gives, each field at the type its read gives. */
export type ReadStruct<R extends Readonly<Record<string, Read>>> = StructType<{ [K in keyof R]: ReadType<R[K]> }>;

/** A reader: the function, and the struct it gives. */
export interface Reader<R extends Readonly<Record<string, Read>>> {
  readonly fn: FunctionExpr<[EastType, RowType], ReadStruct<R>>;
  readonly type: ReadStruct<R>;
}

/* eslint-disable east/east-rules -- the readers: they read a row by the names a declaration gives, which East code names only where it is written */

/** A row's fields by name: the one cast the readers make, of names every caller checked against the row's type. */
function byName(row: unknown): Readonly<Record<string, ExprType<EastType>>> {
  return row as Readonly<Record<string, ExprType<EastType>>>;
}

/**
 * A reader of a row's declared fields: `(K, V) -> { …reads }`, each field of
 * its struct the row's field a read names.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param reads - Each field of the struct, and what it reads
 * @returns The reader
 */
export function readerOf<const R extends Readonly<Record<string, Read>>>(keyType: EastType, rowType: RowType, reads: R): Reader<R> {
  const type = StructType(Object.fromEntries(Object.entries(reads).map(([out, read]) =>
    [out, 'option' in read ? OptionType(read.option.type) : read.type]))) as ReadStruct<R>;
  const fn = East.function([keyType, rowType], type, (_$, _key, row) => {
    const fields = byName(row);
    return Object.fromEntries(Object.entries(reads).map(([out, read]) => {
      if (!('option' in read)) return [out, fields[read.field]!];
      const value = fields[read.option.field]!;
      return [out, read.option.optional ? value : some(value)];
    })) as never;
  });
  return { fn, type };
}

/**
 * A row's leading values where no Set among them fans it out: `(K, V) -> On`,
 * its leading fields' values as the key's `on` — the empty struct where none
 * lead.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param leading - The checked leading fields, no Set among them
 * @returns The function
 * @throws {Error} When a Set field leads: its row has a combination per element ({@link leadingValues})
 */
export function leadingValue(keyType: EastType, rowType: RowType, leading: Leading): FunctionExpr<[EastType, RowType], RowType> {
  if (leading.multi) throw new Error('a Set field fans a row out: read its combinations with leadingValues');
  return readerOf(keyType, rowType, Object.fromEntries(leading.fields.map((f) => [f.field, { field: f.field, type: f.type }]))).fn;
}

/**
 * A row's leading values: `(K, V) -> Set<On>`, every combination of its
 * leading fields' values as the key's `on` — each Set field fanned out over
 * its elements — and the one combination where no Set leads, the empty struct
 * where none do.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param leading - The checked leading fields
 * @returns The function
 */
export function leadingValues(keyType: EastType, rowType: RowType, leading: Leading): FunctionExpr<[EastType, RowType], SetType<RowType>> {
  const sets = leading.fields.filter((f) => f.set);
  const fn = East.function([keyType, rowType], SetType(leading.onType), (_$, _key, row) => {
    const fields = byName(row);
    // One combination: each Set field's element chosen, each other field its value, in key order.
    const combination = (chosen: Readonly<Record<string, ExprType<EastType>>>) =>
      Object.fromEntries(leading.fields.map((f) => [f.field, chosen[f.field] ?? fields[f.field]!]));
    // The Set fields from the one at `at` on, each over its elements: the last by `toSet`, those before it by `flattenToSet`.
    const fan = (at: number, chosen: Readonly<Record<string, ExprType<EastType>>>): ExprType<SetType<RowType>> => {
      const field = sets[at]!;
      const elements = fields[field.field] as ExprType<SetType<EastType>>;
      return (at === sets.length - 1
        ? elements.toSet((_$element, element) => combination({ ...chosen, [field.field]: element }))
        : elements.flattenToSet((_$element, element) => fan(at + 1, { ...chosen, [field.field]: element }))) as never;
    };
    return (sets.length === 0 ? new Set([combination({})]) : fan(0, {})) as never;
  });
  return fn;
}

/**
 * A plain index's key, `on` its row fields: `(K, V) -> IK` — the one field's
 * value, or a struct of several — or `(K, V) -> Set<IK>` where a Set among
 * them fans a row out: the one field's elements, or the struct's combinations.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param leading - The checked fields
 * @returns The key function
 */
export function fieldKeyOf(keyType: EastType, rowType: RowType, leading: Leading): FunctionExpr<[EastType, RowType], EastType> {
  const only = leading.fields.length === 1 ? leading.fields[0] : undefined;
  if (only === undefined) return leading.multi ? leadingValues(keyType, rowType, leading) : leadingValue(keyType, rowType, leading);
  // The one field: its value, or a Set field's elements, as they are.
  return East.function([keyType, rowType], only.set ? SetType(only.type) : only.type, (_$, _key, row) => byName(row)[only.field]! as never);
}

/* eslint-enable east/east-rules */
