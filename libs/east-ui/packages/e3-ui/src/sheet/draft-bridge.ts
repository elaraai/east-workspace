/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Typed draft decoding without domain defaults. @packageDocumentation */
import { ArrayType, East, FunctionType, OptionType, StringType, StructType, none, some, variant, type BlockBuilder, type EastType, type ExprType, type SubtypeExprOrValue, type VariantType } from "@elaraai/east";
import { SheetCellType, SheetRowType } from "./types.js";
import { SheetCellsType, type SheetColumnMeta } from "./bridge.js";
import { SheetDraftFieldType, SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftEntryTypeFor, SheetDraftGroupTypeFor } from "./drafts.js";
import { printLink, printLinkWith, SheetRegisterMembersType } from "./link.js";
import type { SheetRegisterValue } from "./registers.js";

type DraftRecord = StructType;
type DecodeRow = ExprType<FunctionType<[StringType, typeof SheetCellsType, OptionType<DraftRecord>], DraftRecord>>;

/** Compile a row's cells into field drafts, preserving every undeclared field. */
export function buildDraftRowDecoder(
    rowType: StructType,
    metas: readonly SheetColumnMeta[],
    registers: Record<string, SheetRegisterValue>,
    idField?: string,
): DecodeRow {
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const fields = Object.entries(rowType.fields as Record<string, EastType>);
    const decoders = new Map<string, ExprType<FunctionType>>();
    for (const [field, fieldType] of fields) {
        const meta = metas.find(m => m.field === field || m.otherField === field);
        if (!meta || !meta.editable || meta.derived !== undefined) continue;
        const draftField = SheetDraftFieldType(fieldType);
        const own = meta.field === field;
        const decoder = East.function([SheetCellType, draftField], draftField, ($, cell, base) => {
            const members = meta.register !== undefined && registers[meta.register] !== undefined
                ? $.const(registers[meta.register]!, SheetRegisterMembersType) : undefined;
            const missing = $.const(variant("missing", null), draftField);
            $.if(cell.hasTag("Null"), ($) => {
                // An existing explicit none remains a value, while a fresh
                // untouched optional field remains missing until normalization.
                if (meta.optional) {
                    $.if(base.hasTag("value"), ($) => {
                        const value = base.unwrap("value") as unknown as ExprType<OptionType<EastType>>;
                        $.if(value.hasTag("none"), ($) => { $.return(base); });
                    });
                }
                $.return(missing);
            });
            return cell.match({
                Invalid: ($: BlockBuilder<typeof draftField>, text: ExprType<StringType>) => $.const(variant("invalid", text), draftField),
                [meta.cellTag]: ($: BlockBuilder<typeof draftField>, payload: ExprType<EastType>) => {
                    let value = payload;
                    if (meta.form === "array") {
                        const link = payload as unknown as ExprType<import("./types.js").SheetLinkType>;
                        const half = own ? meta.ownHalf : meta.ownHalf === "from" ? "to" : "from";
                        value = half === "from" ? link.from : link.to;
                    } else if (meta.form === "string") {
                        const link = payload as unknown as ExprType<import("./types.js").SheetLinkType>;
                        value = meta.config.store === "canonical" && members !== undefined ? printLinkWith(link, members) : printLink(link);
                    }
                    return $.const(variant("value", meta.optional ? some(value) : value), draftField);
                },
            } as never, ($) => $.const(variant("invalid", cell.hasTag("String").ifElse(() => cell.unwrap("String"), () => East.print(cell))), draftField)) as ExprType<typeof draftField>;
        });
        decoders.set(field, decoder as ExprType<FunctionType>);
    }
    return East.function([StringType, SheetCellsType, OptionType(draftType)], draftType, ($, id, cells, base) => {
        const out: Record<string, unknown> = {};
        for (const [field, fieldType] of fields) {
            const draftField = SheetDraftFieldType(fieldType);
            if (field === idField) {
                out[field] = $.const(variant("value", id), draftField);
                continue;
            }
            const previous = $.const(base.match({
                none: ($) => $.const(variant("missing", null), draftField),
                some: (_$, record) => record[field] as ExprType<typeof draftField>,
            }));
            const fn = decoders.get(field);
            const meta = metas.find(m => m.field === field || m.otherField === field);
            if (!fn || !meta) { out[field] = previous; continue; }
            const decode = $.const(fn as ExprType<FunctionType<[SheetCellType, typeof draftField], typeof draftField>>);
            out[field] = cells.tryGet(meta.key).match({ none: () => previous, some: (_$, cell) => decode(cell, previous) });
        }
        return $.const(out as SubtypeExprOrValue<StructType>, draftType);
    });
}

/**
 * Decode a group against its previous draft and wire row. Child lookup uses
 * the previous wire keys to find draft array positions; keys never become
 * fields or identifiers in the author's child schema.
 */
export function buildDraftGroupDecoder(
    groupType: StructType,
    field: string,
    metas: readonly SheetColumnMeta[],
    rowDecoder: DecodeRow,
    registers: Record<string, SheetRegisterValue>,
    idField?: string,
): ExprType<FunctionType<[SheetRowType, OptionType<StructType>, OptionType<SheetRowType>], StructType>> {
    const childType = groupType.fields[field];
    if (childType?.type !== "Array" || childType.value.type !== "Struct") throw new Error("Sheet groups require Array child rows");
    const rowDraft = SheetDraftTypeFor(childType.value) as StructType;
    const draftType = SheetDraftGroupTypeFor(groupType, field) as StructType;
    const ownType = StructType(Object.fromEntries(Object.entries(groupType.fields).filter(([key]) => key !== field)));
    const ownDraft = SheetDraftTypeFor(ownType) as StructType;
    const ownDecoder = buildDraftRowDecoder(ownType, metas, registers, idField);
    return East.function([SheetRowType, OptionType(draftType), OptionType(SheetRowType)], draftType, ($, row, base, previous) => {
        const decodeOwn = $.const(ownDecoder);
        const decodeRow = $.const(rowDecoder);
        const ownBase = $.const(base.match({
            none: ($) => $.const(none, OptionType(ownDraft)),
            some: ($, group) => $.const(some($.const(Object.fromEntries(Object.keys(ownType.fields).map(key => [key, group[key]])) as SubtypeExprOrValue<StructType>, ownDraft)), OptionType(ownDraft)),
        }));
        const own = $.const(decodeOwn(row.id, row.cells, ownBase));
        const children = $.const(row.lines.map(($, line) => {
            const old = $.const(previous.match({
                none: ($) => $.const(none, OptionType(rowDraft)),
                some: (_$, previousRow) => previousRow.lines.firstMap(($, candidate, index) => {
                    return candidate.key.equal(line.key).ifElse((_$) => base.match({
                        none: ($) => $.const(none, OptionType(rowDraft)),
                        some: ($, group) => {
                            const rows = group[field] as ExprType<ArrayType<StructType>>;
                            return index.less(rows.size()).ifElse(($) => $.const(some(rows.get(index)), OptionType(rowDraft)), ($) => $.const(none, OptionType(rowDraft)));
                        },
                    }), ($) => $.const(none, OptionType(rowDraft)));
                }),
            }));
            return decodeRow("", line.cells, old);
        }), ArrayType(rowDraft));
        return $.const({ ...Object.fromEntries(Object.keys(ownType.fields).map(key => [key, own[key]])), [field]: children } as SubtypeExprOrValue<StructType>, draftType);
    });
}

/**
 * Decode one entry of a source with LOOSE rows between its groups (#846) —
 * `Sheet.Types.Entry(P, "lines")`: a wire row with a band is a group, decoded
 * against its entry's group arm; one without is a loose row, its cells over
 * its row arm, its id field written from the wire row's id.
 *
 * @param entryType - The entry variant
 * @param field - The group's lines field
 * @param groupDecoder - A group's cells and lines over its draft ({@link buildDraftGroupDecoder})
 * @param looseDecoder - A loose row's cells over its draft ({@link buildDraftRowDecoder} with the id field)
 * @returns The wire row, its previous draft entry and wire row → its draft entry
 */
export function buildDraftEntryDecoder(
    entryType: VariantType<{ group: StructType; row: StructType }>,
    field: string,
    groupDecoder: ReturnType<typeof buildDraftGroupDecoder>,
    looseDecoder: DecodeRow,
): ExprType<FunctionType<[SheetRowType, OptionType<EastType>, OptionType<SheetRowType>], EastType>> {
    const draftType = SheetDraftEntryTypeFor(entryType, field) as unknown as VariantType<{ group: StructType; row: StructType }>;
    const groupDraft = SheetDraftGroupTypeFor(entryType.cases.group, field) as StructType;
    const rowDraft = SheetDraftTypeFor(entryType.cases.row) as StructType;
    return East.function([SheetRowType, OptionType(draftType), OptionType(SheetRowType)], draftType, ($, row, base, previous) => {
        const decodeGroup = $.const(groupDecoder);
        const decodeLoose = $.const(looseDecoder);
        const prior = base as unknown as ExprType<OptionType<VariantType<{ group: StructType; row: StructType }>>>;
        return row.band.match({
            some: ($2) => {
                const own = $2.const(prior.match({ none: () => none, some: (_$3, entry) => entry.match({ group: (_$4, g) => some(g), row: () => none }) }), OptionType(groupDraft));
                return $2.const(variant("group", decodeGroup(row, own, previous)), draftType);
            },
            none: ($2) => {
                const own = $2.const(prior.match({ none: () => none, some: (_$3, entry) => entry.match({ row: (_$4, r) => some(r), group: () => none }) }), OptionType(rowDraft));
                return $2.const(variant("row", decodeLoose(row.id, row.cells, own)), draftType);
            },
        });
    }) as unknown as ExprType<FunctionType<[SheetRowType, OptionType<EastType>, OptionType<SheetRowType>], EastType>>;
}
