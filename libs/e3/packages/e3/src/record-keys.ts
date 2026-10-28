/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reading a record's row by the names a declaration gives.
 *
 * East names a struct's fields where its code is written; a generated index
 * reads the fields its declaration names — its leading fields, an event's
 * start and end, a box's place — which it holds as values. So every generated
 * program reads its row through East's own builders for names held as values
 * (`East.field`, `East.fields`, `East.struct`), which check each name against
 * the row's type as the program is built: a reader a field, the leading
 * values as the key's `on`, and their combinations where a Set field fans a
 * row out.
 *
 * @packageDocumentation
 */
import {
  ArrayType, DateTimeType, East, OptionType, SetType, StructType, isTypeEqual, printType, some,
  type EastType, type FunctionExpr,
} from '@elaraai/east';
import { functionAt } from './record-guards.js';

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
 * A reader of a row's field, as an index reads it: `(K, V) → T`, the field as
 * it is — East reads it by its name, checked against the row's type as the
 * program is built.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param read - The field and its type
 * @returns The reader
 */
export function fieldReader<T extends EastType>(
  keyType: EastType, rowType: RowType, read: { readonly field: string; readonly type: T },
): FunctionExpr<[EastType, RowType], T>;
/**
 * A reader of a row's field as an Option, as an index reads an event's times
 * and a box's place: `(K, V) → Option<T>`, a field holding an Option as it
 * is, and one holding the value itself as its `some`.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param read - The field, checked to be a `T` or an Option of one ({@link optionField})
 * @returns The reader
 */
export function fieldReader<T extends EastType>(
  keyType: EastType, rowType: RowType, read: { readonly option: OptionField<T> },
): FunctionExpr<[EastType, RowType], OptionType<T>>;
export function fieldReader(
  keyType: EastType, rowType: RowType, read: { readonly field: string; readonly type: EastType } | { readonly option: OptionField },
): FunctionExpr<[EastType, RowType], EastType> {
  if (!('option' in read)) {
    const type: EastType = read.type;
    return East.function([keyType, rowType], type, (_$, _key, row) => East.field(row, read.field, type));
  }
  const { field, optional, type } = read.option;
  const option: EastType = OptionType(type);
  if (optional) return East.function([keyType, rowType], option, (_$, _key, row) => East.field(row, field, option));
  return East.function([keyType, rowType], option, (_$, _key, row) => some(East.field(row, field, type)));
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
  const names = leading.fields.map((f) => f.field);
  return East.function([keyType, rowType], leading.onType, (_$, _key, row) => East.struct(leading.onType, East.fields(row, names)));
}

/**
 * A row's leading values partly fanned out: the function giving their
 * combinations so far, and a combination's type. An Array: a combination not
 * yet fanned out holds Sets, which no Set may.
 */
interface Fanning {
  readonly fn: FunctionExpr<[EastType, RowType], ArrayType<RowType>>;
  readonly type: RowType;
}

/**
 * A row's leading values: `(K, V) -> Set<On>`, every combination of its
 * leading fields' values as the key's `on` — each Set field fanned out over
 * its elements — and the one combination where no Set leads, the empty struct
 * where none do.
 *
 * @remarks
 * The leading fields are read as one struct, each Set field still a Set; then
 * each Set field in turn is fanned out over its elements, a step each, each
 * step calling the one before it — so the combinations are built by ordinary
 * East, whatever the fields.
 *
 * @param keyType - The record's key type
 * @param rowType - The record's row type
 * @param leading - The checked leading fields
 * @returns The function
 */
export function leadingValues(keyType: EastType, rowType: RowType, leading: Leading): FunctionExpr<[EastType, RowType], SetType<RowType>> {
  const names = leading.fields.map((f) => f.field);
  const read: RowType = StructType(Object.fromEntries(leading.fields.map((f) => [f.field, f.set ? SetType(f.type) : f.type])));
  const first: Fanning = {
    fn: East.function([keyType, rowType], ArrayType(read), (_$, _key, row) => [East.struct(read, East.fields(row, names))]),
    type: read,
  };
  const fanned = leading.fields.filter((f) => f.set).reduce<Fanning>((before, f) => {
    // This Set field's element in its place; the fields before and after it as they are.
    const type: RowType = StructType({ ...before.type.fields, [f.field]: f.type });
    const at = names.indexOf(f.field);
    const ahead = names.slice(0, at);
    const behind = names.slice(at + 1);
    const elements = SetType(f.type);
    return {
      fn: East.function([keyType, rowType], ArrayType(type), ($, key, row) => {
        const earlier = $.const(before.fn);
        return earlier(key, row).flatMap((_$, partial) => East.field(partial, f.field, elements).toArray((_$, element) =>
          East.struct(type, [...East.fields(partial, ahead), element, ...East.fields(partial, behind)])));
      }),
      type,
    };
  }, first);
  // Every Set fanned out: the combinations, each once.
  const combinations = East.function([keyType, rowType], SetType(fanned.type), ($, key, row) => {
    const all = $.const(fanned.fn);
    return all(key, row).toSet((_$, combination) => combination);
  });
  return functionAt<[EastType, RowType], SetType<RowType>>(combinations, [keyType, rowType], SetType(leading.onType));
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
  const type: EastType = only.set ? SetType(only.type) : only.type;
  return East.function([keyType, rowType], type, (_$, _key, row) => East.field(row, only.field, type));
}
