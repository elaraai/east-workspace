/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pass 1 of the root (`Sheet Spec.md` §4.8, §3.12) — each declared column, and
 * each band cell, described against the type it is declared over: the field
 * it sits on and what that field may hold, its kind's payload and the cell arm
 * it lands in, a register's key type (east-workspace#1747), its rule cells,
 * and a column from data's functions — the author's, or the defaults its
 * field's shape makes obvious. Every refusal names the column and the remedy.
 * What it learns is a {@link SheetColumnMeta} (`column-meta.ts`).
 *
 * @packageDocumentation
 */

import {
    BooleanType,
    DateTimeType,
    DictType,
    East,
    Expr,
    FloatType,
    IntegerType,
    OptionType,
    StringType,
    isTypeEqual,
    none,
    some,
    variant,
    type EastType,
    type ExprType,
    type FunctionType,
    type StructType,
    type SubtypeExprOrValue,
} from "@elaraai/east";

import { StatusValueType } from "@elaraai/east-ui";
import { resolveTag } from "@elaraai/east-ui/internal";
import {
    RecordChangeType,
    RecordMarkType,
    SheetDateLevelType,
    SheetLinkType,
    sheetRuleCell,
    type SheetColumnKindLiteral,
} from "./types.js";
import { SheetMembersType, SheetRegisterMembersType } from "./link.js";
import type { SheetAnyColumnConfig, SheetColumn } from "./columns.js";
import type { SheetGroupCell } from "./group.js";
import { actionRuleCells, buildActionCodec, describeAction } from "./actions.js";
import { keyOfTextOrNone, keyTextOf } from "../schedule/window.js";
import {
    cellTagOf,
    describeType,
    optionPayload,
    typeOf,
    type SheetColumnMeta,
    type SheetFromDataMeta,
    type SheetKeyCodec,
    type SheetLinkForm,
    type SheetRuleCellMeta,
    type SheetStepsCodec,
    type SheetStructMember,
} from "./column-meta.js";

/**
 * A register's keys of another type than String as their text, and back
 * (east-workspace#1747): a key as East prints it, and a text read at the key's
 * type, `none` for one no key of it prints as.
 *
 * @param keyType - The register's key type
 * @returns The codec
 */
function keyCodecOf(keyType: EastType): SheetKeyCodec {
    return { type: keyType, encode: keyTextOf(keyType), decode: keyOfTextOrNone(keyType) };
}

const SCALAR_PAYLOAD: Partial<Record<SheetColumnKindLiteral, EastType>> = {
    text: StringType, lookup: StringType, reference: StringType, enum: StringType, stamped: StringType,
    date: DateTimeType, quantity: FloatType, integer: IntegerType,
    title: StringType, person: StringType, cycle: StringType, boolean: BooleanType, toggle: BooleanType,
};

/** The kinds that hold one member's key of their register: in a field of the register's key type, or its Option (east-workspace#1747). */
const KEYED_KINDS: ReadonlySet<SheetColumnKindLiteral> = new Set<SheetColumnKindLiteral>(["reference", "enum", "person", "cycle"]);

/**
 * What a column of a kind that holds one member's key holds of its register
 * (east-workspace#1747): the register's key type, and how a key crosses where it
 * is no String. A column of any other kind, or over a register not declared —
 * which the root refuses, naming it — holds none.
 *
 * @param col - The built column
 * @param registerKeys - Each declared register's key type, by name
 * @returns The key type and its codec; `undefined` for a column holding no member's key
 */
function heldKey(col: SheetColumn<StructType, EastType>, registerKeys: ReadonlyMap<string, EastType>): { type: EastType; codec: SheetKeyCodec | undefined } | undefined {
    if (!KEYED_KINDS.has(col.kind) || col.register === undefined) return undefined;
    const type = registerKeys.get(col.register);
    if (type === undefined) return undefined;
    return { type, codec: type.type === "String" ? undefined : keyCodecOf(type) };
}

/** A column holding a member's key in a value of another type, refused: the column, its register's key type, and what holds the value. */
function keyRefusal(key: string, col: SheetColumn<StructType, EastType>, keyType: EastType, held: string): Error {
    return new Error(`Sheet: ${col.kind} column "${key}" holds a key of the register "${col.register}", keyed by ${describeType(keyType)} — ${held}`);
}

/** Compile one rule accessor and check its payload — `String` or `DateTime`, or its Option. */
function ruleCell(
    key: string,
    rule: "actual" | "detail",
    rowType: StructType,
    accessor: (row: ExprType<StructType>) => unknown,
    tag: SheetRuleCellMeta["tag"],
): SheetRuleCellMeta {
    const fn = East.function([rowType], undefined, (_$, r) => accessor(r) as SubtypeExprOrValue<EastType>) as unknown as SheetRuleCellMeta["fn"];
    const out = (Expr.type(fn) as FunctionType).output as EastType;
    const payload = optionPayload(out);
    const unwrapped = payload ?? out;
    if (cellTagOf(unwrapped) !== tag) {
        throw new Error(`Sheet: column "${key}" has a \`${rule}\` rule returning ${describeType(out)} — it must return ${tag} or Option<${tag}>`);
    }
    return { key: sheetRuleCell(rule, key), fn, tag, optional: payload !== undefined };
}

/**
 * The unrendered cells a column's rules project (#844) — `detail` on any
 * column, `level` and `actual` on a date column.
 */
function ruleCellsOf(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetRuleCellMeta[] {
    const kind = col.kind;
    const cfg = col.config;
    const out: SheetRuleCellMeta[] = [];
    if (cfg.detail !== undefined) out.push(ruleCell(key, "detail", rowType, cfg.detail, "String"));
    // An action column's summary, name and title (#1474).
    if (kind === "action") out.push(...actionRuleCells(key, col, rowType));
    // An audit column's who and what, beside the moment its cell holds — a column from data's are each member's.
    if (kind === "audit" && cfg.each === undefined) {
        const optional = optionPayload((rowType.fields as Record<string, EastType>)[key]!) !== undefined;
        for (const rule of ["by", "verb"] as const) {
            const fn = East.function([rowType], OptionType(StringType), ($, r) => {
                const change = $.const((r as unknown as Record<string, ExprType<EastType>>)[key]!);
                return optional
                    ? (change as unknown as ExprType<OptionType<RecordChangeType>>).match({
                        some: (_$2, c) => East.value(some(c[rule]), OptionType(StringType)),
                        none: (_$2) => East.value(none, OptionType(StringType)),
                    })
                    : East.value(some((change as unknown as ExprType<RecordChangeType>)[rule]), OptionType(StringType));
            }) as unknown as SheetRuleCellMeta["fn"];
            out.push({ key: sheetRuleCell(rule, key), fn, tag: "String", optional: true });
        }
    }
    if (kind !== "date") {
        if (cfg.level !== undefined || cfg.actual !== undefined) {
            throw new Error(`Sheet: column "${key}" is a ${kind} column — \`level\` and \`actual\` are date-column rules`);
        }
        return out;
    }
    if (cfg.level !== undefined) {
        const level = cfg.level;
        const fn = East.function([rowType], StringType, (_$, r) => resolveTag(level(r), SheetDateLevelType).match({
            week:  (_$2) => "week",
            day:   (_$2) => "day",
            range: (_$2) => "range",
            time:  (_$2) => "time",
        })) as unknown as SheetRuleCellMeta["fn"];
        out.push({ key: sheetRuleCell("level", key), fn, tag: "String", optional: false });
    }
    if (cfg.actual !== undefined) out.push(ruleCell(key, "actual", rowType, cfg.actual, "DateTime"));
    return out;
}

/**
 * Describe one column against the row type — the build-time refusals of
 * §3.12 live here, every one naming the column and the remedy.
 *
 * @param key - The column key
 * @param col - The built column
 * @param rowType - The host's row type
 * @param registerKeys - Each declared register's key type, by name: what a column over it holds one member's key as (east-workspace#1747)
 * @returns The column's metadata
 * @throws Error naming the column when the kind cannot sit on the field
 */
export function describeColumn(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType, registerKeys: ReadonlyMap<string, EastType>): SheetColumnMeta {
    const cfg = col.config;
    if (cfg.each === undefined) {
        for (const option of ["groups", "field", "read", "write"] as const) {
            if (cfg[option] !== undefined) {
                throw new Error(`Sheet: column "${key}" has \`${option}\`, which a column from data takes — give it \`each\`: the register whose members it makes a column for, or the struct's fields`);
            }
        }
    }
    const meta = cfg.each !== undefined ? describeFromData(key, col, rowType, registerKeys) : describeKind(key, col, rowType, registerKeys);
    const ruleCells = ruleCellsOf(key, col, rowType);
    if (cfg.options !== undefined && col.kind !== "enum" && col.kind !== "lookup" && col.kind !== "link") {
        throw new Error(`Sheet: column "${key}" is a ${col.kind} column — an \`options\` rule narrows an enum, lookup or link column's members`);
    }
    // A column from data's mark is its members' (`SheetFromDataMeta`); any other's reads the row.
    const mark = cfg.each === undefined && cfg.mark !== undefined ? rowMark(key, cfg.mark, rowType) : undefined;
    return { ...meta, ...(ruleCells.length > 0 ? { ruleCells } : {}), ...(mark !== undefined ? { mark } : {}) };
}

/** An author's East function value pinned, with its inputs and its output — or a refusal naming the column and the option. */
function pinDataFunction(key: string, option: "read" | "write" | "mark", fn: unknown): { fn: ExprType<FunctionType>; inputs: EastType[]; output: EastType } {
    let expr: ExprType<EastType>;
    try {
        expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    } catch {
        throw new Error(`Sheet: column "${key}" has a \`${option}\` that is no East function — give it an East.function`);
    }
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function") {
        throw new Error(`Sheet: column "${key}" has a \`${option}\` that is ${t.type === "AsyncFunction" ? "an East.asyncFunction, and a cell is read and written as it is drawn and edited" : `${/^[AEIOU]/.test(t.type) ? "an" : "a"} ${t.type}`} — give it an East.function`);
    }
    return { fn: expr as unknown as ExprType<FunctionType>, inputs: t.inputs ?? [], output: t.output as EastType };
}

/** East types as a refusal lists a function's inputs. */
function spell(types: readonly EastType[]): string {
    return types.map(describeType).join(", ");
}

/** A column's `mark` over the row and the day, checked: an East function from the row and a DateTime to an optional `Record.Types.Mark`. */
function rowMark(key: string, fn: unknown, rowType: StructType): NonNullable<SheetColumnMeta["mark"]> {
    const mark = pinDataFunction(key, "mark", fn);
    if (mark.inputs.length !== 2 || !isTypeEqual(mark.inputs[0]!, rowType) || !isTypeEqual(mark.inputs[1]!, DateTimeType)
        || !isTypeEqual(mark.output, OptionType(RecordMarkType))) {
        throw new Error(`Sheet: column "${key}" has a \`mark\` over (${spell(mark.inputs)}) returning ${describeType(mark.output)} — it marks a cell over the row and the day: an East function from (RowType, DateTime) to Option<Record.Types.Mark>`);
    }
    return mark.fn as unknown as NonNullable<SheetColumnMeta["mark"]>;
}

/** A custom column's payload — what its `parse` gives some of — and the cell arm it lands in. */
function customPayload(key: string, cfg: SheetAnyColumnConfig): { payload: EastType; tag: SheetColumnMeta["cellTag"] } {
    const parseType = typeOf(East.value(cfg.parse as never) as ExprType<EastType>) as FunctionType;
    const payload = optionPayload(parseType.output as EastType);
    if (payload === undefined) {
        throw new Error(`Sheet: custom column "${key}" has a \`parse\` whose output is not an Option — it must return Option<payload>, \`none\` meaning unrecognised`);
    }
    const tag = cellTagOf(payload);
    if (tag === undefined) {
        throw new Error(`Sheet: custom column "${key}" has payload ${(payload as { type: string }).type}, which no cell holds — use String, Integer, Float, DateTime, Boolean or Sheet.Types.Link`);
    }
    return { payload, tag };
}

/**
 * A column from data, described against the row type: the field it reads and
 * writes — its key, or the one `field` names — the value one cell holds,
 * which its kind decides, and the functions its cells are read and written
 * through, each checked against the field, the members' key, that value and
 * the day, or the defaults the field's shape makes obvious: a `Dict` keyed by
 * the member, and the struct `each` names. A member's key is at its register's
 * key type (east-workspace#1747), as is a cell's value of a kind holding a key
 * of its own register. Every refusal names the column and the remedy.
 */
function describeFromData(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType, registerKeys: ReadonlyMap<string, EastType>): SheetColumnMeta {
    const cfg = col.config;
    const kind = col.kind;
    const where = `Sheet: column "${key}"`;
    const aKind = `${/^[aeiou]/.test(kind) ? "an" : "a"} ${kind} column`;
    const fields = rowType.fields as Record<string, EastType>;
    if (kind === "action") {
        throw new Error(`${where} is an action column, whose buttons, forms and side-panel entry follow one field — it makes no columns from data, so give it no \`each\``);
    }
    if (kind === "lookup") {
        throw new Error(`${where} is a lookup column, the sheet's driver and one column of its own — it makes no columns from data, so give it no \`each\``);
    }
    for (const option of ["fill", "options", "value"] as const) {
        if (cfg[option] !== undefined) {
            throw new Error(`${where} makes its columns from data, which take no \`${option}\` — ${option === "value" ? "each cell reads its member's value through `read`" : "the first version takes none"}`);
        }
    }
    if (kind === "age" && cfg.since !== undefined) {
        throw new Error(`${where} is an age column from data, which counts from each member's value — it takes no \`since\``);
    }

    // The field: the column's key, or one `field` names under a key of its own — and an age's always so, as it shows no field.
    const named = cfg.field;
    if (named !== undefined && fields[key] !== undefined) {
        throw new Error(`${where} is keyed by the row's "${key}" field, and reads and writes it — key it by a name of its own to read "${named}" with \`field\``);
    }
    if (kind === "age" && named === undefined) {
        throw new Error(`${where} is an age column, which shows no field — keyed by a name of its own, it names the field its columns read with \`field\``);
    }
    const field = named ?? key;
    const fieldType = fields[field];
    if (fieldType === undefined) {
        throw new Error(named !== undefined
            ? `${where} reads "${named}", which \`field\` names and the row type lacks (${Object.keys(fields).join(", ")})`
            : `${where} is not a field of the row type — key a column from data by the field it reads, or by a name of its own with \`field\` naming it (${Object.keys(fields).join(", ")})`);
    }
    const fieldSpelt = `its field "${field}" (${describeType(fieldType)})`;

    // What one cell holds, as the kind takes it: the kind's value, or an Option of it.
    let accepted: EastType[];
    let payloadType: EastType;
    let cellTag: SheetColumnMeta["cellTag"];
    let valueName: string;
    let steps: SheetStepsCodec | undefined;
    // A kind holding a key of its own register holds it at the register's key type (east-workspace#1747).
    const held = heldKey(col, registerKeys);
    if (kind === "cycle" && col.variantType !== undefined) {
        steps = stepsOf(key, col);
        accepted = [col.variantType];
        payloadType = StringType;
        cellTag = "String";
        valueName = `its variant (${Object.keys(col.variantType.cases as Record<string, EastType>).join(", ")})`;
    } else if (kind === "set" || kind === "link") {
        accepted = [SheetLinkType];
        payloadType = SheetLinkType;
        cellTag = "Link";
        valueName = "a Sheet.Types.Link";
    } else if (kind === "custom") {
        const { payload, tag } = customPayload(key, cfg);
        accepted = [payload];
        payloadType = payload;
        cellTag = tag;
        valueName = describeType(payload);
    } else if (kind === "age" || kind === "audit") {
        accepted = kind === "age" ? [DateTimeType, RecordChangeType] : [RecordChangeType];
        payloadType = DateTimeType;
        cellTag = "DateTime";
        valueName = kind === "age" ? "a DateTime or a Record.Types.Change" : "a Record.Types.Change";
    } else {
        payloadType = SCALAR_PAYLOAD[kind] as EastType;
        accepted = [held?.type ?? payloadType];
        cellTag = cellTagOf(payloadType)!;
        valueName = describeType(held?.type ?? payloadType);
    }
    const holds = (t: EastType): boolean => {
        const own = optionPayload(t) ?? t;
        return accepted.some((a) => isTypeEqual(a, own));
    };
    // A stamped code, an age and a change are never written; any other is, unless the author says not.
    const readOnly = kind === "stamped" || kind === "age" || kind === "audit";
    if (readOnly && cfg.write !== undefined) {
        throw new Error(`${where} is ${aKind}, which is read only — it takes no \`write\``);
    }
    const writes = !readOnly && cfg.editable !== false;
    if (cfg.read === undefined && cfg.write !== undefined) {
        throw new Error(`${where} has a \`write\` and no \`read\` — a write sets what its read reads, so give the column a \`read\` too`);
    }
    const markOf = (inputs: EastType[], spelt: string): ExprType<FunctionType> | undefined => {
        if (cfg.mark === undefined) return undefined;
        const mark = pinDataFunction(key, "mark", cfg.mark);
        if (mark.inputs.length !== inputs.length || mark.inputs.some((t, i) => !isTypeEqual(t, inputs[i]!)) || !isTypeEqual(mark.output, OptionType(RecordMarkType))) {
            throw new Error(`${where} has a \`mark\` over (${spell(mark.inputs)}) returning ${describeType(mark.output)} — it marks a cell over ${spelt}, returning Option<Record.Types.Mark>`);
        }
        return mark.fn;
    };

    let data: SheetFromDataMeta;
    let optional = false;
    const each = cfg.each!;
    if (typeof each === "string") {
        // One column per member of a register: the functions take the member's key, at the register's key type.
        const memberKey = registerKeys.get(each) ?? StringType;
        const memberSpelt = `the member's key (${describeType(memberKey)})`;
        const entry = fieldType.type === "Dict" && isTypeEqual(fieldType.key as EastType, memberKey) && holds(fieldType.value as EastType) && optionPayload(fieldType.value as EastType) === undefined
            ? fieldType.value as EastType : undefined;
        let valueType: EastType;
        let read: ExprType<FunctionType>;
        let write: ExprType<FunctionType> | undefined;
        let clears = false;
        if (cfg.read === undefined) {
            if (entry === undefined) {
                throw new Error(`${where} makes a column for each member of "${each}" from ${fieldSpelt} — a field that is no Dict keyed by the member, of ${valueName}, takes a \`read\` and a \`write\``);
            }
            // The member's entry, or none; an edit sets it, and a clear removes it.
            valueType = OptionType(entry);
            read = East.function([fieldType, memberKey, DateTimeType], valueType, (_$, value, member, _day) =>
                (value as unknown as ExprType<DictType<EastType, EastType>>).tryGet(member)) as unknown as ExprType<FunctionType>;
            if (writes) {
                write = East.function([fieldType, memberKey, valueType, DateTimeType], fieldType, ($, value, member, given, _day) => {
                    const next = $.let((value as unknown as ExprType<DictType<EastType, EastType>>).copy());
                    $.match(given as unknown as ExprType<OptionType<EastType>>, {
                        some: ($2, set) => { $2(next.insertOrUpdate(member, set)); },
                        none: ($2) => { $2(next.tryDelete(member)); },
                    });
                    return next;
                }) as unknown as ExprType<FunctionType>;
                clears = true;
            }
        } else {
            const pinned = pinDataFunction(key, "read", cfg.read);
            if (pinned.inputs.length !== 3 || !isTypeEqual(pinned.inputs[0]!, fieldType) || !isTypeEqual(pinned.inputs[1]!, memberKey) || !isTypeEqual(pinned.inputs[2]!, DateTimeType)) {
                throw new Error(`${where} has a \`read\` over (${spell(pinned.inputs)}) — it reads ${fieldSpelt}, ${memberSpelt} and the day (DateTime)`);
            }
            if (!holds(pinned.output)) {
                throw new Error(`${where} has a \`read\` returning ${describeType(pinned.output)} — it returns ${valueName}, or an Option of it, for each member`);
            }
            valueType = pinned.output;
            read = pinned.fn;
            if (cfg.write !== undefined) {
                const own = optionPayload(valueType) ?? valueType;
                const pinnedWrite = pinDataFunction(key, "write", cfg.write);
                const [writeField, writeMember, writeValue, writeDay] = pinnedWrite.inputs;
                if (pinnedWrite.inputs.length !== 4 || !isTypeEqual(writeField!, fieldType) || !isTypeEqual(writeMember!, memberKey)
                    || !(isTypeEqual(writeValue!, own) || isTypeEqual(writeValue!, OptionType(own))) || !isTypeEqual(writeDay!, DateTimeType)) {
                    throw new Error(`${where} has a \`write\` over (${spell(pinnedWrite.inputs)}) — it writes ${fieldSpelt} given ${memberSpelt}, the value its \`read\` gives (${describeType(own)}, or an Option of it) and the day (DateTime)`);
                }
                if (!isTypeEqual(pinnedWrite.output, fieldType)) {
                    throw new Error(`${where} has a \`write\` returning ${describeType(pinnedWrite.output)} — it returns the field's new value, ${describeType(fieldType)}`);
                }
                write = pinnedWrite.fn;
                clears = optionPayload(writeValue!) !== undefined;
            } else if (writes) {
                throw new Error(`${where} reads ${fieldSpelt} through its \`read\` — give it a \`write\` too, or \`editable: false\` to show it read only`);
            }
        }
        optional = optionPayload(valueType) !== undefined;
        data = {
            from: "register", register: each, memberKey, groups: cfg.groups, valueType, clears, read, write,
            mark: markOf([fieldType, memberKey, DateTimeType], `${fieldSpelt}, ${memberSpelt} and the day (DateTime)`),
        };
    } else {
        // One column per field of a struct: the functions take the struct.
        if (cfg.groups !== undefined) {
            throw new Error(`${where} makes a column for each field of a struct, and \`groups\` heads a register's members — group a struct's columns with \`columnGroups\`, by the column's key`);
        }
        const given = Object.entries(each);
        if (given.length === 0) {
            throw new Error(`${where} has an \`each\` naming no field — name each field of the struct it makes a column for, with its header`);
        }
        let structType: StructType;
        let read: ExprType<FunctionType>;
        let write: ExprType<FunctionType> | undefined;
        if (cfg.read === undefined) {
            if (fieldType.type !== "Struct") {
                throw new Error(`${where} makes a column for each field of a struct from ${fieldSpelt} — a field that is no struct takes a \`read\` giving one, and a \`write\``);
            }
            // The struct itself; an edit writes the new one.
            structType = fieldType as StructType;
            read = East.function([fieldType, DateTimeType], fieldType, (_$, value, _day) => value) as unknown as ExprType<FunctionType>;
            if (writes) write = East.function([fieldType, fieldType, DateTimeType], fieldType, (_$, _value, next, _day) => next) as unknown as ExprType<FunctionType>;
        } else {
            const pinned = pinDataFunction(key, "read", cfg.read);
            if (pinned.inputs.length !== 2 || !isTypeEqual(pinned.inputs[0]!, fieldType) || !isTypeEqual(pinned.inputs[1]!, DateTimeType)) {
                throw new Error(`${where} has a \`read\` over (${spell(pinned.inputs)}) — over a struct's fields it reads ${fieldSpelt} and the day (DateTime), giving the struct`);
            }
            if (pinned.output.type !== "Struct") {
                throw new Error(`${where} has a \`read\` returning ${describeType(pinned.output)} — over a struct's fields it gives the struct whose fields \`each\` names`);
            }
            structType = pinned.output as StructType;
            read = pinned.fn;
            if (cfg.write !== undefined) {
                const pinnedWrite = pinDataFunction(key, "write", cfg.write);
                if (pinnedWrite.inputs.length !== 3 || !isTypeEqual(pinnedWrite.inputs[0]!, fieldType) || !isTypeEqual(pinnedWrite.inputs[1]!, structType)
                    || !isTypeEqual(pinnedWrite.inputs[2]!, DateTimeType)) {
                    throw new Error(`${where} has a \`write\` over (${spell(pinnedWrite.inputs)}) — over a struct's fields it writes ${fieldSpelt} given the struct its \`read\` gives (${describeType(structType)}) and the day (DateTime)`);
                }
                if (!isTypeEqual(pinnedWrite.output, fieldType)) {
                    throw new Error(`${where} has a \`write\` returning ${describeType(pinnedWrite.output)} — it returns the field's new value, ${describeType(fieldType)}`);
                }
                write = pinnedWrite.fn;
            } else if (writes) {
                throw new Error(`${where} reads ${fieldSpelt} through its \`read\` — give it a \`write\` too, or \`editable: false\` to show it read only`);
            }
        }
        const struct = structType.fields as Record<string, EastType>;
        const members = given.map(([name, header]): SheetStructMember => {
            const valueType = struct[name];
            if (valueType === undefined) {
                throw new Error(`${where} names "${name}" in \`each\`, which is not a field of its struct (${Object.keys(struct).join(", ")})`);
            }
            if (!holds(valueType)) {
                throw new Error(`${where} makes a column of its struct's "${name}", which holds ${describeType(valueType)} — ${aKind}'s value is ${valueName}, or an Option of it`);
            }
            return { name, header, valueType, clears: optionPayload(valueType) !== undefined };
        });
        data = {
            from: "fields", structType, members, read, write,
            mark: markOf([fieldType, DateTimeType], `${fieldSpelt} and the day (DateTime)`),
        };
    }
    return {
        key, field, kind, config: cfg, fieldType, optional, payloadType, cellTag,
        editable: writes && data.write !== undefined,
        ...(col.register !== undefined ? { register: col.register } : {}),
        ...(held?.codec !== undefined ? { keys: held.codec } : {}),
        ...(steps !== undefined ? { register: `$steps:${key}`, steps, keys: steps } : {}),
        ...(kind === "set" || kind === "link" ? { form: "link" as const } : {}),
        ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
        data,
    };
}

/**
 * An age column, described against the row type: no field of its own, its
 * cell the moment `since` reads — a DateTime, or a Change's `at` — or none.
 */
function describeAge(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
    const fields = rowType.fields as Record<string, EastType>;
    if (fields[key] !== undefined) {
        throw new Error(`Sheet: column "${key}" is an age column, which shows no field — key it by a name of its own ("days_since"), not the row's "${key}" field`);
    }
    const since = col.config.since;
    if (since === undefined) throw new Error(`Sheet: age column "${key}" needs \`since\` — when its clock started, over the row`);
    const sinceFn = East.function([rowType], undefined, (_$, r) => since(r) as SubtypeExprOrValue<EastType>);
    const out = (Expr.type(sinceFn as Expr<EastType>) as FunctionType).output as EastType;
    const payload = optionPayload(out);
    const moment = payload ?? out;
    const change = isTypeEqual(moment, RecordChangeType);
    if (!change && moment.type !== "DateTime") {
        throw new Error(`Sheet: age column "${key}" has a \`since\` returning ${describeType(out)} — it must return a DateTime, a Record.Types.Change, or an Option of either`);
    }
    const derived = East.function([rowType], OptionType(DateTimeType), ($, r) => {
        const read = $.const(sinceFn as unknown as ExprType<FunctionType<[StructType], EastType>>);
        const value = $.const(read(r));
        const at = (v: ExprType<EastType>): ExprType<DateTimeType> => (change ? (v as unknown as ExprType<RecordChangeType>).at : v as ExprType<DateTimeType>);
        if (payload === undefined) return East.value(some(at(value)), OptionType(DateTimeType));
        return (value as unknown as ExprType<OptionType<EastType>>).match({
            some: (_$2, v) => East.value(some(at(v as ExprType<EastType>)), OptionType(DateTimeType)),
            none: (_$2) => East.value(none, OptionType(DateTimeType)),
        });
    }) as unknown as ExprType<FunctionType<[StructType], EastType>>;
    return {
        key, field: key, kind: "age", config: col.config, fieldType: OptionType(DateTimeType), optional: true,
        payloadType: DateTimeType, cellTag: "DateTime", editable: false, derived, derivedOptional: true,
    };
}

/**
 * A cycle over a variant, described against its field: the field holds the
 * variant, and its steps are checked ({@link stepsOf}). They become a register
 * keyed by the cases' names, under a `$` name no register of the author's
 * takes.
 */
function describeSteps(key: string, col: SheetColumn<StructType, EastType>, fieldType: EastType): SheetColumnMeta {
    if (!isTypeEqual(fieldType, col.variantType!)) {
        throw new Error(`Sheet: cycle column "${key}" steps through a variant's cases, but sits on ${fieldType.type === "Variant" ? "a field holding another variant" : `a ${describeType(fieldType)} field`} — it sits on a field holding the variant it steps through`);
    }
    const steps = stepsOf(key, col);
    return {
        key, field: key, kind: "cycle", config: col.config, fieldType, optional: false,
        payloadType: StringType, cellTag: "String", editable: col.config.editable !== false,
        register: `$steps:${key}`,
        steps, keys: steps,
    };
}

/**
 * A cycle over a variant's steps, checked — no case of its variant holds
 * data, and `steps` names every case once, in the order a click steps
 * through them — as a register keyed by the cases' names, and how a case and
 * its key cross.
 */
function stepsOf(key: string, col: SheetColumn<StructType, EastType>): SheetStepsCodec {
    const variantType = col.variantType!;
    const cases = variantType.cases as Record<string, EastType>;
    const names = Object.keys(cases);
    for (const [name, type] of Object.entries(cases)) {
        if (type.type !== "Null") {
            throw new Error(`Sheet: cycle column "${key}" steps through a variant whose "${name}" case holds ${describeType(type)} — a step has no value to give a case, so no case of a cycle's variant holds data`);
        }
    }
    const steps = col.config.steps ?? [];
    const named = new Set<string>();
    for (const step of steps) {
        if (cases[step.case] === undefined) {
            throw new Error(`Sheet: cycle column "${key}" has a step "${step.case}", which is not a case of its variant (${names.join(", ")})`);
        }
        if (named.has(step.case)) throw new Error(`Sheet: cycle column "${key}" names the case "${step.case}" twice in its steps — name each case once`);
        named.add(step.case);
    }
    const left = names.filter((name) => !named.has(name));
    if (left.length > 0) {
        throw new Error(`Sheet: cycle column "${key}" leaves ${left.map((name) => `"${name}"`).join(", ")} out of its steps — name every case of its variant, in the order a click steps through them`);
    }
    const members = East.value(steps.map((step) => ({
        key:     step.case,
        label:   step.label,
        kind:    key,
        aliases: step.aliases ?? [],
        meta:    step.meta !== undefined ? some(step.meta) : none,
        parent:  none,
        tone:    step.tone !== undefined ? some(resolveTag(step.tone, StatusValueType)) : none,
    })), SheetRegisterMembersType);
    const encode = East.function([variantType], StringType, (_$, v) => v.getTag()) as unknown as SheetStepsCodec["encode"];
    const decode = East.function([StringType], OptionType(variantType), ($, text) => {
        const byKey = $.const(new Map(names.map((name) => [name, variant(name, null)])), DictType(StringType, variantType));
        return byKey.tryGet(text);
    }) as unknown as SheetStepsCodec["decode"];
    return { type: variantType, members, encode, decode };
}

/** {@link describeColumn}'s kind-by-kind half. */
function describeKind(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType, registerKeys: ReadonlyMap<string, EastType>): SheetColumnMeta {
    if (col.kind === "age") return describeAge(key, col, rowType);
    const fields = rowType.fields as Record<string, EastType>;
    const fieldType = fields[key];
    if (fieldType === undefined) {
        throw new Error(`Sheet: column "${key}" is not a field of the row type — the columns map is keyed by the row's fields (${Object.keys(fields).join(", ")})`);
    }
    const cfg = col.config;
    const kind = col.kind;
    if (kind === "cycle" && col.variantType !== undefined) return describeSteps(key, col, fieldType);
    const payloadOf = optionPayload(fieldType);
    const optional = payloadOf !== undefined;
    const unwrapped = payloadOf ?? fieldType;

    // An action column (#1474): the field is its variant, or an Option of it.
    if (kind === "action") {
        const isOption = payloadOf !== undefined && col.variantType !== undefined && !isTypeEqual(fieldType, col.variantType);
        describeAction(key, col, fieldType, isOption);
        return {
            key, field: key, kind, config: cfg, fieldType, optional: isOption, payloadType: col.variantType!,
            cellTag: "Action", editable: cfg.editable !== false, action: buildActionCodec(col.variantType!),
        };
    }

    // An audit column: the change the app kept, read only — its cell the moment, its who and what rule cells.
    if (kind === "audit") {
        if (!isTypeEqual(unwrapped, RecordChangeType)) {
            throw new Error(`Sheet: audit column "${key}" must sit on a Record.Types.Change or Option<Record.Types.Change> field — got ${describeType(fieldType)}`);
        }
        const derived = East.function([rowType], OptionType(DateTimeType), ($, r) => {
            const change = $.const((r as unknown as Record<string, ExprType<EastType>>)[key]!);
            return optional
                ? (change as unknown as ExprType<OptionType<RecordChangeType>>).match({
                    some: (_$2, c) => East.value(some(c.at), OptionType(DateTimeType)),
                    none: (_$2) => East.value(none, OptionType(DateTimeType)),
                })
                : East.value(some((change as unknown as ExprType<RecordChangeType>).at), OptionType(DateTimeType));
        }) as unknown as ExprType<FunctionType<[StructType], EastType>>;
        return {
            key, field: key, kind, config: cfg, fieldType, optional, payloadType: DateTimeType,
            cellTag: "DateTime", editable: false, derived, derivedOptional: true,
        };
    }

    // A kind holding a member's key holds it at its register's key type (east-workspace#1747).
    const held = heldKey(col, registerKeys);

    // A derived read — the projection decides the payload; the field is free.
    if (cfg.value !== undefined && kind !== "set" && kind !== "link" && kind !== "stamped" && kind !== "custom") {
        const payloadType = SCALAR_PAYLOAD[kind] as EastType;
        const derived = East.function([rowType], undefined, (_$, r) => cfg.value!(r)) as unknown as ExprType<FunctionType<[StructType], EastType>>;
        const out = (Expr.type(derived) as FunctionType).output as EastType;
        const outPayload = optionPayload(out);
        const outUnwrapped = outPayload ?? out;
        if (held !== undefined && !isTypeEqual(outUnwrapped, held.type)) {
            throw keyRefusal(key, col, held.type, `its \`value\` projection returns one of that type, or its Option, and it returns ${describeType(out)}`);
        }
        if (held === undefined && !isTypeEqual(outUnwrapped, payloadType)) {
            throw new Error(`Sheet: column "${key}" is a ${kind} column whose \`value\` projection returns ${(outUnwrapped as { type: string }).type} — a ${kind} column's projection must return ${(payloadType as { type: string }).type} or its Option`);
        }
        return {
            key, field: key, kind, config: cfg, fieldType, optional, payloadType,
            cellTag: cellTagOf(payloadType)!, editable: false,
            derived, derivedOptional: outPayload !== undefined,
            ...(col.register !== undefined ? { register: col.register } : {}),
            ...(held?.codec !== undefined ? { keys: held.codec } : {}),
            ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
        };
    }

    if (kind === "set" || kind === "link") {
        let form: SheetLinkForm;
        let ownHalf: "from" | "to" | undefined;
        let otherField: string | undefined;
        if (isTypeEqual(fieldType, SheetLinkType) || isTypeEqual(unwrapped, SheetLinkType)) {
            form = "link";
        } else if (isTypeEqual(fieldType, SheetMembersType)) {
            form = "array";
            if (kind === "set") {
                ownHalf = "to";
            } else if (cfg.to !== undefined && cfg.from === undefined) {
                ownHalf = "from"; otherField = cfg.to as string;
            } else if (cfg.from !== undefined && cfg.to === undefined) {
                ownHalf = "to"; otherField = cfg.from as string;
            } else {
                throw new Error(`Sheet: link column "${key}" sits on an Array<Member> field, so it must name the OTHER half's field — \`to: "…"\` when this field holds the from members, \`from: "…"\` when it holds the to members`);
            }
            const otherType = otherField !== undefined ? fields[otherField] : undefined;
            if (otherField !== undefined && (otherType === undefined || !isTypeEqual(otherType, SheetMembersType))) {
                throw new Error(`Sheet: link column "${key}" names "${otherField}" as its other half, but that is not an Array<Sheet.Types.Member> field of the row`);
            }
        } else if ((unwrapped as { type: string }).type === "String") {
            form = "string";
        } else {
            throw new Error(`Sheet: ${kind} column "${key}" must sit on a Sheet.Types.Link, Array<Sheet.Types.Member> or String field — got ${(fieldType as { type: string }).type}`);
        }
        return {
            key, field: key, kind, config: cfg, fieldType, optional: form === "link" ? isTypeEqual(unwrapped, SheetLinkType) && optional : optional,
            payloadType: SheetLinkType, cellTag: "Link", editable: cfg.editable !== false,
            form,
            ...(ownHalf !== undefined ? { ownHalf } : {}),
            ...(otherField !== undefined ? { otherField } : {}),
            ...(col.register !== undefined ? { register: col.register } : {}),
            ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
        };
    }

    if (kind === "custom") {
        const { payload: parsed, tag } = customPayload(key, cfg);
        if (!isTypeEqual(parsed, unwrapped)) {
            throw new Error(`Sheet: custom column "${key}" parses to ${(parsed as { type: string }).type} but sits on a ${(unwrapped as { type: string }).type} field — the payload must be the field's type (or its Option's)`);
        }
        return { key, field: key, kind, config: cfg, fieldType, optional, payloadType: parsed, cellTag: tag, editable: cfg.editable !== false };
    }

    const payloadType = SCALAR_PAYLOAD[kind] as EastType;
    if (held !== undefined && !isTypeEqual(unwrapped, held.type)) {
        throw keyRefusal(key, col, held.type, `it sits on a field of that type, or its Option, and "${key}" holds ${describeType(fieldType)}`);
    }
    if (held === undefined && !isTypeEqual(unwrapped, payloadType)) {
        throw new Error(`Sheet: ${kind} column "${key}" must sit on a ${(payloadType as { type: string }).type} or Option<${(payloadType as { type: string }).type}> field — got ${(fieldType as { type: string }).type}`);
    }
    return {
        key, field: key, kind, config: cfg, fieldType, optional, payloadType,
        cellTag: cellTagOf(payloadType)!,
        editable: kind !== "stamped" && cfg.editable !== false,
        ...(col.register !== undefined ? { register: col.register } : {}),
        ...(held?.codec !== undefined ? { keys: held.codec } : {}),
        ...(col.driverType !== undefined ? { driverType: col.driverType } : {}),
    };
}

/**
 * Describe one band cell against the GROUP's row type (#740) — a column
 * declared over the group's field, keyed by the line column it sits under.
 *
 * @param cellKey - The line column the cell sits under, or `$title`
 * @param cell - The built band cell
 * @param groupType - The group's row type
 * @param registerKeys - Each declared register's key type, by name: what a cell over it holds one member's key as (east-workspace#1747)
 * @returns The cell's metadata
 * @throws Error naming the band cell when the kind cannot sit on the field, or is not a band kind
 */
export function describeGroupCell(cellKey: string, cell: SheetGroupCell<StructType>, groupType: StructType, registerKeys: ReadonlyMap<string, EastType>): SheetColumnMeta {
    if (cell.kind === "lookup" || cell.kind === "set" || cell.kind === "link" || cell.kind === "custom" || cell.kind === "action") {
        throw new Error(`Sheet: band cell "${cellKey}" is a ${cell.kind} cell — a band draws text, date, quantity, integer, reference, enum and stamped cells only`);
    }
    let meta: SheetColumnMeta;
    try {
        meta = describeColumn(cell.field, { kind: cell.kind, config: cell.config, ...(cell.register !== undefined ? { register: cell.register } : {}) }, groupType, registerKeys);
    } catch (e) {
        throw new Error(`Sheet: band cell "${cellKey}" — ${(e as Error).message.replace(/^Sheet: /, "")}`);
    }
    return { ...meta, key: cellKey, field: cell.field };
}
