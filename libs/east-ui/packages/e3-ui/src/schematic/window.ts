/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A Schematic kind's reads (#1386, `Schematic Builder Spec.md` §10.4): its
 * record read whole, or its narrowing read complete through its source of the
 * Schematic's `Slice.bindRecords` — the record slice's `PagedScan`, over
 * `recordSliceReadPlatform` — each answering `none` while a read is in flight.
 * Reading by area — a viewport's window from an area index alone, and the
 * density at overview — is #1393's, over the same source.
 *
 * Through its source a kind reads what its narrowing holds and nothing else:
 * the source's choices, each as the rail holds it. An entry's row is its
 * `row` — the source joins it — or its `value`, for an index that carries the
 * whole row (D29).
 *
 * @packageDocumentation
 */

import {
    DictType, East, Expr, IntegerType, OptionType, StringType, isSubtype, isTypeEqual, none, some,
    type ArrayType, type EastType, type ExprType, type FunctionType, type StructType,
} from "@elaraai/east";
import {
    RecordSliceBindType, RecordSliceConfigType, RecordSliceStateType, RecordSliceWhereType, recordSliceReadPlatform,
} from "@elaraai/east-ui/internal";
import { optionOf } from "../schedule/window.js";

/**
 * A kind's source of the Schematic's slice, as the payload hands it to the
 * kind: the source's typed record Slice handle, `Slice.bindRecords`' part
 * named after the kind's slot, bound once in the payload's block
 * (`recordSources(…).bind($)`, #1356). A kind's read reads its members inside
 * its function, so it holds this one source, never the whole slice.
 */
export type SchematicKindPart = ExprType<StructType>;

/** A kind's rows, by key: what a read of it gives; `none` while it is in flight. */
type RowsRead = ExprType<FunctionType<[], OptionType<DictType<StringType, EastType>>>>;

/**
 * A kind's record read whole: its binding's `read()` — `Record.bind`'s or
 * `Data.bind`'s — by key.
 *
 * @param handle - The record's binding
 * @param rowType - Its row type
 * @returns `()` → the record's rows, by key
 */
export function schematicWholeRows(handle: ExprType<EastType>, rowType: StructType): RowsRead {
    const Held = DictType(StringType, rowType);
    const read = (handle as unknown as { read: () => ExprType<DictType<StringType, StructType>> }).read;
    return East.function([], OptionType(Held), (_$) => East.value(some(read()), OptionType(Held))) as unknown as RowsRead;
}

/**
 * A kind's narrowing read complete through its source of the slice (see the
 * module docs).
 *
 * @param part - The kind's source of the slice, bound in the payload
 * @param slot - The kind's slot, which names the source
 * @param rowType - The kind's record's row type
 * @param where - The kind, as a refusal names it
 * @returns `()` → the rows the narrowing holds, by key; `none` while a search or a page is in flight
 * @throws {Error} When the source narrows another record, or reads neither its rows nor an index carrying them
 */
export function schematicSourceRows(part: SchematicKindPart, slot: string, rowType: StructType, where: string): RowsRead {
    const type = Expr.type(part as unknown as Expr) as EastType;
    const fields = type.type === "Struct" ? type.fields as Record<string, EastType> : {};
    const data = fields["data"];
    const page = fields["pageWhere"];
    const output = page?.type === "Function" ? page.output : undefined;
    const collection = output === undefined ? undefined : optionOf(output);
    const entry = collection?.type === "Array" ? collection.value as EastType : undefined;
    const entryFields = entry?.type === "Struct" ? entry.fields as Record<string, EastType> : undefined;
    const keyed = entryFields?.["key"] !== undefined && isTypeEqual(entryFields["key"], StringType);
    // An entry's row: its `row`, which a joined read fills, or its `value`, when the index carries the whole row (D29).
    const joined = entryFields?.["row"] !== undefined && isTypeEqual(entryFields["row"], OptionType(rowType));
    const carried = entryFields?.["value"] !== undefined && isTypeEqual(entryFields["value"], rowType);
    const pages = page?.type === "Function" && page.inputs.length === 3 && isTypeEqual(page.inputs[0]!, RecordSliceWhereType)
        && isTypeEqual(page.inputs[1]!, IntegerType) && isTypeEqual(page.inputs[2]!, IntegerType);
    const identified = data?.type === "Struct" && data.fields["id"] !== undefined && isTypeEqual(data.fields["id"], StringType)
        && data.fields["revision"] !== undefined && data.fields["revision"].type === "Function";
    const sliced = Object.entries(RecordSliceBindType.fields).every(([name, expected]) => fields[name] !== undefined && isSubtype(fields[name]!, expected));
    if (!pages || !keyed || !(joined || carried) || !identified || !sliced) {
        throw new Error(`${where}: the slice's source "${slot}" narrows another record — name it after this kind's slot, over the kind's own record: ` +
            `Data.bindPaged(record, { indexes }), its rows joined or carried by its indexes`);
    }
    const Held = DictType(StringType, rowType);
    const Entries = collection as ArrayType<StructType<{ key: StringType; row: OptionType<EastType>; value: EastType }>>;
    const noRows = `${where}: the slice's source "${slot}" reads no rows — bind it with Data.bindPaged(record, { indexes, join: true })`;
    return East.function([], OptionType(Held), ($) => {
        // The source as the payload bound it, its members read here: the read captures the source alone.
        const source = $.const(part as unknown as ExprType<StructType<{
            config: RecordSliceConfigType;
            read: FunctionType<[], RecordSliceStateType>;
            countWhere: FunctionType<[RecordSliceWhereType], OptionType<IntegerType>>;
            pageWhere: FunctionType<[RecordSliceWhereType, IntegerType, IntegerType], OptionType<typeof Entries>>;
            data: StructType<{ id: StringType; revision: FunctionType<[], OptionType<StringType>> }>;
        }>>);
        const read = $.const(source.read);
        const countWhere = $.const(source.countWhere);
        const pageWhere = $.const(source.pageWhere);
        const id = $.const(source.data.id);
        const revision = $.const(source.data.revision);
        // The narrowing as the rail holds it: each source's choices.
        const state = $.const(read());
        const result = $.let(none, OptionType(Held));
        $.match(recordSliceReadPlatform([Entries], id, revision, countWhere, pageWhere, state.where), {
            some: ($2, entries) => {
                const held = $2.let(new Map(), Held);
                $2.for(entries, ($3, e) => {
                    if (joined) {
                        $3.match(e.row, {
                            some: ($4, row) => { $4(held.insert(e.key, row as never)); },
                            none: ($4) => {
                                if (carried) $4(held.insert(e.key, e.value as never));
                                else $4.error(noRows);
                            },
                        });
                    } else {
                        $3(held.insert(e.key, e.value as never));
                    }
                });
                $2.assign(result, some(held));
            },
        });
        return result;
    }) as unknown as RowsRead;
}
