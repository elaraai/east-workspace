/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Columns from data on the bridge (#1559) — each one's cells read at the
 * Record's day, over a row's draft or its entry before it has one, and a
 * gesture's edits to them written over the draft — and every column's marks
 * beside its cells. A column from data is described in pass 1 (`describe.ts`);
 * the bridge (`bridge.ts`) holds the two functions built here.
 *
 * @packageDocumentation
 */

import {
    DateTimeType,
    East,
    OptionType,
    StringType,
    defaultValue,
    isTypeEqual,
    none,
    some,
    variant,
    type ArrayType,
    type BlockBuilder,
    type EastType,
    type ExprType,
    type FunctionType,
    type NullType,
    type StructType,
    type SubtypeExprOrValue,
    type VariantType,
} from "@elaraai/east";

import { RecordChangeType, SheetCellType, SheetReadFromType, type RecordMarkType, SHEET_UNREAD_CELL, sheetRuleCell } from "./types.js";
import type { SheetRegisterMembersType } from "./link.js";
import { buildDraftLift } from "./context-bridge.js";
import { buildComplete } from "./actions.js";
import { SheetDraftFieldType, SheetDraftTypeFor } from "./transactions.js";
import { NULL_CELL, SheetCellsType, cellOfPayload, optionPayload, type SheetColumnMeta } from "./column-meta.js";
import type { SheetBridge } from "./bridge.js";

/** The registers columns from data are made from, by name: each one's members, held once in the sheet's block. @internal */
export type SheetDataMembers = ReadonlyMap<string, ExprType<typeof SheetRegisterMembersType>>;

/**
 * Those of them keyed by another type than String, by name: each member's key at
 * the register's type, in its members' order, held once — what a column's
 * functions take a member's key as (east-workspace#1747).
 *
 * @internal
 */
export type SheetDataMemberKeys = ReadonlyMap<string, ExprType<ArrayType<EastType>>>;

/** A block a member's cells are written in, whatever the function it sits in returns. */
type SheetAnyBlock = BlockBuilder<EastType>;

/** A draft's field: its value, missing, or text no column could read. */
type SheetDraftField = VariantType<{ value: EastType; missing: NullType; invalid: StringType }>;

/**
 * A member's value as its column's cell draws it: a key by its text — a
 * register's of another type than String as East prints it (east-workspace#1747),
 * a variant's case by its step's key — a change by its moment, any other value
 * as its kind's payload — an `Option`'s none the blank cell.
 */
function memberCell(meta: SheetColumnMeta, valueType: EastType, value: ExprType<EastType>): ExprType<SheetCellType> {
    const own = optionPayload(valueType);
    const change = isTypeEqual(own ?? valueType, RecordChangeType);
    const cellOf = (v: ExprType<EastType>): ExprType<SheetCellType> => meta.keys !== undefined
        ? cellOfPayload("String", meta.keys.encode(v) as ExprType<EastType>)
        : cellOfPayload(meta.cellTag, change ? (v as unknown as ExprType<RecordChangeType>).at as ExprType<EastType> : v);
    if (own === undefined) return cellOf(value);
    return (value as unknown as ExprType<OptionType<EastType>>).match({
        some: (_$, v) => cellOf(v as ExprType<EastType>),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

/** A member's cells under its wire column's key: its value's, and an audit's who and what beside it while it holds a change. */
function insertMember($: SheetAnyBlock, cells: ExprType<typeof SheetCellsType>, meta: SheetColumnMeta, valueType: EastType, key: ExprType<StringType>, value: ExprType<EastType>): void {
    const held = $.const(value, valueType);
    $(cells.insert(key, memberCell(meta, valueType, held)));
    if (meta.kind !== "audit") return;
    const says = ($2: SheetAnyBlock, change: ExprType<RecordChangeType>): void => {
        $2(cells.insert(East.str`$by:${key}`, cellOfPayload("String", change.by as ExprType<EastType>)));
        $2(cells.insert(East.str`$verb:${key}`, cellOfPayload("String", change.verb as ExprType<EastType>)));
    };
    if (optionPayload(valueType) === undefined) says($, held as unknown as ExprType<RecordChangeType>);
    else $.match(held as unknown as ExprType<OptionType<RecordChangeType>>, { some: ($2, change) => says($2 as unknown as SheetAnyBlock, change) });
}

/** A cell's mark, as the two cells beside it (`sheetRuleCell`'s): its words, and whether it locks the cell. */
function insertMark($: SheetAnyBlock, cells: ExprType<typeof SheetCellsType>, key: ExprType<StringType>, mark: ExprType<OptionType<typeof RecordMarkType>>): void {
    $.match(mark, {
        some: ($2, given) => {
            $2(cells.insert(East.str`$mark:${key}`, cellOfPayload("String", given.match({ note: (_$3, words) => words, lock: (_$3, words) => words }) as ExprType<EastType>)));
            $2(cells.insert(East.str`$lock:${key}`, cellOfPayload("Boolean", given.hasTag("lock") as ExprType<EastType>)));
        },
    });
}

/**
 * A member's cell as the value its column's `write` takes — `some` of it, or
 * `none` where the cell writes nothing: text no column could read — a key's
 * text no key of its type prints as among it — a cell of another kind, or a
 * blank where the value is no `Option`, which has nowhere to hold one. A blank
 * where it is one writes `none`.
 */
function writtenValue(meta: SheetColumnMeta, own: EastType, clears: boolean, cell: ExprType<SheetCellType>): ExprType<OptionType<EastType>> {
    const out = OptionType(clears ? OptionType(own) : own);
    const nothing = East.value(none, out);
    const given = (v: ExprType<EastType>): ExprType<OptionType<EastType>> => East.value(some(clears ? some(v) : v) as never, out);
    return cell.match({
        Null: (_$: unknown) => (clears ? East.value(some(none) as never, out) : nothing),
        [meta.cellTag]: (_$: unknown, payload: ExprType<EastType>) => (meta.keys === undefined ? given(payload)
            : meta.keys.decode(payload as ExprType<StringType>).match({
                some: (_$2, v) => given(v as ExprType<EastType>),
                none: (_$2) => nothing,
            })),
    } as never, (_$: unknown) => nothing) as ExprType<OptionType<EastType>>;
}

/**
 * Compile a row's cells at a day (#1559): each column from data's — every
 * member's value through its column's `read` — every column's marks, and
 * each meter's max and tone (east-workspace#1730), read over the row's draft,
 * or over its entry before it has one. A field not yet set shows nothing, nor
 * one holding text no column could read; a mark, a max and a tone over the
 * row read it once its draft is whole. Each meter is read apart: one whose
 * max or tone throws over the row holds the error's message under its max, a
 * String, and the row's marks and its other meters are read all the same. A
 * mark, or a column from data, that throws over the row leaves the error's
 * message under {@link SHEET_UNREAD_CELL}, and the row's meters are read all
 * the same (east-workspace#1734's review).
 *
 * @param rowType - The row type
 * @param metas - The declared columns, for their marks and meters
 * @param dataMetas - The columns from data
 * @param members - Each register they are made from, its members held once
 * @param memberKeys - Each of those keyed by another type than String, its members' keys at it
 * @returns What a row is read over, and the day → its cells
 */
export function buildCellsAt(
    rowType: StructType, metas: readonly SheetColumnMeta[], dataMetas: readonly SheetColumnMeta[], members: SheetDataMembers, memberKeys: SheetDataMemberKeys,
): NonNullable<SheetBridge["cellsAt"]> {
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const lift = buildDraftLift(rowType) as unknown as ExprType<FunctionType<[StructType], StructType>>;
    const marked = metas.filter((m) => m.mark !== undefined);
    const metered = metas.filter((m) => m.meter !== undefined);
    const complete = marked.length > 0 || metered.length > 0 ? buildComplete(rowType) : undefined;
    return East.function([SheetReadFromType, DateTimeType], SheetCellsType, ($, from, day) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const toDraft = $.const(lift);
        const draft = $.const(from.match({
            entry: (_$2, bytes) => toDraft(bytes.decodeBeast(rowType, "v2")),
            draft: (_$2, bytes) => bytes.decodeBeast(draftType, "v2"),
        }), draftType);
        // A mark or a column from data that throws over the row says why under the row's unread cell, which locks every
        // marked cell, and the meters are read all the same: a throw that left the function lost them too.
        const unread = (message: ExprType<StringType>) => cells.insertOrUpdate(SHEET_UNREAD_CELL, cellOfPayload("String", message as ExprType<EastType>));
        if (complete !== undefined) {
            const whole = $.const(complete);
            $.match(whole(draft), {
                some: ($2, row) => {
                    if (marked.length > 0) {
                        $2.try(($3) => {
                            for (const m of marked) {
                                const mark = $3.const(m.mark!);
                                insertMark($3 as unknown as SheetAnyBlock, cells, East.value(m.key, StringType), mark(row, day));
                            }
                        }).catch(($3, message) => {
                            $3(unread(message));
                        });
                    }
                    // A meter's max and its tone's name, beside its value's cell — each meter read apart: one whose max or
                    // tone throws over the row holds the error's message under its max instead.
                    for (const m of metered) {
                        const meter = m.meter!;
                        const max = $2.const(meter.max);
                        const tone = meter.tone !== undefined ? $2.const(meter.tone) : undefined;
                        const maxKey = sheetRuleCell("max", m.key);
                        $2.try(($3) => {
                            // Both read before either is written: a tone that throws leaves no max behind it.
                            const read = $3.const(max(row));
                            const named = tone !== undefined ? $3.const(tone(row)) : undefined;
                            $3(cells.insert(maxKey, cellOfPayload("Float", read as ExprType<EastType>)));
                            if (named !== undefined) $3(cells.insert(sheetRuleCell("tone", m.key), cellOfPayload("String", named as ExprType<EastType>)));
                        }).catch(($3, message) => {
                            $3(cells.insertOrUpdate(maxKey, cellOfPayload("String", message as ExprType<EastType>)));
                        });
                    }
                },
            });
        }
        const drafted = draft as unknown as Record<string, ExprType<SheetDraftField>>;
        // Each column from data read over the row; one whose `read` or `mark` throws says why under the unread cell.
        if (dataMetas.length > 0) {
            $.try(($read) => {
                for (const m of dataMetas) {
                    const data = m.data!;
                    $read.match(drafted[m.field]!, {
                        value: ($2, value) => {
                            if (data.from === "register") {
                                const read = $2.const(data.read as unknown as ExprType<FunctionType<[EastType, EastType, DateTimeType], EastType>>);
                                const mark = data.mark !== undefined
                                    ? $2.const(data.mark as unknown as ExprType<FunctionType<[EastType, EastType, DateTimeType], OptionType<typeof RecordMarkType>>>)
                                    : undefined;
                                const typed = memberKeys.get(data.register);
                                $2.for(members.get(data.register)!, ($3, member, at) => {
                                    const key = $3.const(East.str`${m.key}:${member.key}`);
                                    // The member's key as the column's functions take it: at its register's type.
                                    const memberKey = typed === undefined ? member.key as ExprType<EastType> : $3.const(typed.get(at));
                                    insertMember($3 as unknown as SheetAnyBlock, cells, m, data.valueType, key, read(value, memberKey, day));
                                    if (mark !== undefined) insertMark($3 as unknown as SheetAnyBlock, cells, key, mark(value, memberKey, day));
                                });
                                return;
                            }
                            const read = $2.const(data.read as unknown as ExprType<FunctionType<[EastType, DateTimeType], StructType>>);
                            const struct = $2.const(read(value, day), data.structType) as unknown as Record<string, ExprType<EastType>>;
                            const marker = data.mark !== undefined
                                ? $2.const(data.mark as unknown as ExprType<FunctionType<[EastType, DateTimeType], OptionType<typeof RecordMarkType>>>)
                                : undefined;
                            // One mark over the whole field, on each of its columns.
                            const mark = marker !== undefined ? $2.const(marker(value, day)) : undefined;
                            for (const member of data.members) {
                                const key = $2.const(`${m.key}:${member.name}`, StringType);
                                insertMember($2 as unknown as SheetAnyBlock, cells, m, member.valueType, key, struct[member.name]!);
                                if (mark !== undefined) insertMark($2 as unknown as SheetAnyBlock, cells, key, mark);
                            }
                        },
                    });
                }
            }).catch(($read, message) => {
                $read(unread(message));
            });
        }
        return cells;
    }) as unknown as NonNullable<SheetBridge["cellsAt"]>;
}

/**
 * Compile a gesture's writes through the columns from data (#1559): each cell
 * the gesture changed — one its wire row holds that differs from what the
 * column's `read` gave over the field before the gesture — written through
 * its column's `write`, in the columns' order, each over the field as the
 * writes before it left it, whichever column made them. A field not yet set —
 * a new row's — starts from its type's default, written or not: no person can
 * set it but through its members, and a row is complete before any is typed
 * in. One holding text no column could read takes none.
 *
 * @param rowType - The row type
 * @param dataMetas - The columns from data
 * @param members - Each register they are made from, its members held once
 * @param memberKeys - Each of those keyed by another type than String, its members' keys at it
 * @returns The gesture's cells, the draft before it, the draft its cells decode to and the day → the draft; `undefined` where no column from data writes
 * @internal
 */
export function buildWriteData(
    rowType: StructType, dataMetas: readonly SheetColumnMeta[], members: SheetDataMembers, memberKeys: SheetDataMemberKeys,
): NonNullable<SheetBridge["writeData"]> | undefined {
    const byField = new Map<string, SheetColumnMeta[]>();
    for (const m of dataMetas) if (m.data!.write !== undefined) byField.set(m.field, [...(byField.get(m.field) ?? []), m]);
    if (byField.size === 0) return undefined;
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const fields = rowType.fields as Record<string, EastType>;
    return East.function([SheetCellsType, OptionType(draftType), draftType, DateTimeType], draftType, ($, cells, base, decoded, day) => {
        const drafted = decoded as unknown as Record<string, ExprType<EastType>>;
        const out: Record<string, unknown> = Object.fromEntries(Object.keys(fields).map((name) => [name, drafted[name]]));
        for (const [name, family] of byField) {
            const fieldType = fields[name]!;
            const draftField = SheetDraftFieldType(fieldType);
            // A field not yet set starts from its type's default; one of a type with none — a function — is never written.
            let blank: { value: unknown } | undefined;
            try {
                blank = { value: defaultValue(fieldType) };
            } catch {
                blank = undefined;
            }
            const seed = East.value((blank === undefined ? none : some(blank.value)) as never, OptionType(fieldType)) as ExprType<OptionType<EastType>>;
            const start = $.const(drafted[name]! as never, draftField) as unknown as ExprType<SheetDraftField>;
            // The field before the gesture, which the cells it showed were read over.
            const before = $.const(base.match({
                some: (_$2, draft) => (draft as unknown as Record<string, ExprType<EastType>>)[name]!,
                none: (_$2) => East.value(variant("missing", null), draftField),
            }) as never, draftField) as unknown as ExprType<SheetDraftField>;
            // The field as each write leaves it.
            const now = $.let(start.match({
                value: (_$2, v) => East.value(some(v) as never, OptionType(fieldType)),
                missing: (_$2) => seed,
                invalid: (_$2) => East.value(none, OptionType(fieldType)),
            }), OptionType(fieldType));
            const wrote = $.let(false);
            for (const m of family) {
                const data = m.data!;
                if (data.from === "register") {
                    const own = optionPayload(data.valueType) ?? data.valueType;
                    const read = $.const(data.read as unknown as ExprType<FunctionType<[EastType, EastType, DateTimeType], EastType>>);
                    const write = $.const(data.write as unknown as ExprType<FunctionType<[EastType, EastType, EastType, DateTimeType], EastType>>);
                    const typed = memberKeys.get(data.register);
                    $.for(members.get(data.register)!, ($2, member, at) => {
                        const key = $2.const(East.str`${m.key}:${member.key}`);
                        // The member's key as the column's functions take it: at its register's type.
                        const memberKey = typed === undefined ? member.key as ExprType<EastType> : $2.const(typed.get(at));
                        $2.match(cells.tryGet(key), {
                            some: ($3, cell) => {
                                const shown = $3.const(before.match({ value: (_$4, v) => memberCell(m, data.valueType, read(v, memberKey, day)) }, (_$4) => NULL_CELL), SheetCellType);
                                $3.if(East.notEqual(cell, shown), ($4) => {
                                    $4.match(writtenValue(m, own, data.clears, cell), {
                                        some: ($5, given) => {
                                            $5.match(now, {
                                                some: ($6, field) => {
                                                    $6.assign(now, some(write(field, memberKey, given, day)) as never);
                                                    $6.assign(wrote, true);
                                                },
                                            });
                                        },
                                    });
                                });
                            },
                        });
                    });
                    continue;
                }
                // A struct's fields: each changed one set on the struct as drafted so far, then the struct written once.
                const read = $.const(data.read as unknown as ExprType<FunctionType<[EastType, DateTimeType], StructType>>);
                const write = $.const(data.write as unknown as ExprType<FunctionType<[EastType, StructType, DateTimeType], EastType>>);
                const names = Object.keys(data.structType.fields);
                const structType = data.structType;
                const shownStruct = $.const(before.match({
                    value: (_$2, v) => East.value(some(read(v, day)) as never, OptionType(structType)),
                }, (_$2) => East.value(none, OptionType(structType))), OptionType(structType));
                $.match(now, {
                    some: ($2, field) => {
                        const next = $2.let(read(field, day), structType);
                        const touched = $2.let(false);
                        for (const member of data.members) {
                            const own = optionPayload(member.valueType) ?? member.valueType;
                            $2.match(cells.tryGet(`${m.key}:${member.name}`), {
                                some: ($3, cell) => {
                                    const shown = $3.const(shownStruct.match({
                                        some: (_$4, s) => memberCell(m, member.valueType, (s as unknown as Record<string, ExprType<EastType>>)[member.name]!),
                                        none: (_$4) => NULL_CELL,
                                    }), SheetCellType);
                                    $3.if(East.notEqual(cell, shown), ($4) => {
                                        $4.match(writtenValue(m, own, member.clears, cell), {
                                            some: ($5, given) => {
                                                const held = next as unknown as Record<string, ExprType<EastType>>;
                                                $5.assign(next, East.value(Object.fromEntries(names.map((n) => [n, n === member.name ? given : held[n]])) as never, structType));
                                                $5.assign(touched, true);
                                            },
                                        });
                                    });
                                },
                            });
                        }
                        $2.if(touched, ($3) => {
                            $3.assign(now, some(write(field, next, day)) as never);
                            $3.assign(wrote, true);
                        });
                    },
                });
            }
            // Unwritten, a field not yet set is its type's default all the same.
            const unwritten = blank === undefined ? start : start.match({
                missing: (_$2) => East.value(variant("value", blank.value) as never, draftField) as unknown as ExprType<SheetDraftField>,
            }, (_$2) => start);
            out[name] = wrote.ifElse(
                (_$2) => East.value(variant("value", now.unwrap("some")) as never, draftField),
                (_$2) => unwritten,
            );
        }
        return East.value(out as SubtypeExprOrValue<StructType>, draftType);
    }) as unknown as NonNullable<SheetBridge["writeData"]>;
}
