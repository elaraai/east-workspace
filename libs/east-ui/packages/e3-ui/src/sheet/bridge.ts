/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The typed bridge (`Sheet Spec.md` §4.8) — factory internals, both arms.
 *
 * Everything the author writes is typed over the host's row `R` and the
 * driver's row `D`; everything on the wire is closed. This module joins the
 * two with compiled East functions that capture only data, bind handles and
 * the author's functions:
 *
 * - `projectRow` — `R` → the wire cells (the same projection the row source
 *   uses, so `encode` and `make` cannot disagree);
 * - `rowById` — the REAL source row by id: the captured collection or bind
 *   handle on the inline arm, the source's `page` at the row's offset on the
 *   paged arm. Built ONCE per sheet and shared by every wrapper;
 * - `draftDecode` — current cells over the existing field draft, preserving
 *   hidden values and retaining missing/invalid input without domain defaults;
 * - `bridgeCtx` — the wire context to `Sheet.Types.DraftContext(R, D)`;
 * - `bridgeReady` — a readiness batch to one `DraftContext` per check, its
 *   rows built once (#882);
 * - the wrappers — a fill provider, a proposer, an arity rule, a member
 *   check, an options rule, a custom kind's parse / print — each the
 *   author's typed function inside its closed wire twin;
 * - the rule cells and sub rows (#844) — a column's `level` / `actual` /
 *   `detail` accessors and the `subRows` mappers, each compiled once and
 *   called inside the row projection.
 *
 * On a GROUPED sheet (#740) the source row is the group `P` and the columns
 * are declared over the line `L` its lines field holds: `projectRow` /
 * `draftRow` / the patch run over `L`, `rowById` returns the group, and the
 * group half of the bridge ({@link SheetGroupBridge}) projects the group's
 * summary cells and ordered children. Internal child keys preserve identity
 * during local editing; the author's child arrays remain positional. A
 * source with LOOSE rows between its groups (#846) holds entries
 * `Sheet.Types.Entry(P, "lines")`: `rowById` returns the entry, a draft is
 * the entry's draft, and a loose row decodes as a row of `L` whose id is its
 * own.
 *
 * The bridge is the one place a string ever names a field: inside the
 * factory, against the column list it has already validated.
 *
 * @packageDocumentation
 */

import {
    type BlockBuilder,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
    type VariantType,
    East,
    Expr,
    ArrayType,
    AsyncFunctionType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    defaultValue,
    isTypeEqual,
    variant,
    some,
    none,
} from "@elaraai/east";

import {
    SheetCellType,
    SheetReadFromType,
    SheetLinkType,
    SheetRowType,
    SheetLineType,
    SheetContextType,
    SheetReadyBatchType,
    SheetFillType,
    SheetProposalType,
    SheetProviderType,
    SheetProposerType,
    SheetCheckContextType,
    SheetCheckType,
    SheetCountedType,
    SheetHalfType,
    SheetContextTypeFor,
    SheetCheckContextTypeFor,
    SheetPatchTypeFor,
    SheetProposalTypeFor,
    SheetGroupContextTypeFor,
    SheetGroupCheckContextTypeFor,
    SheetDateLevelType,
    SheetSubRowType,
    SheetOptionsRuleType,
    RecordChangeType,
    RecordMarkType,
    sheetLinesOf,
    sheetRuleCell,
    type SheetColumnKindLiteral,
} from "./types.js";
import { StatusValueType } from "@elaraai/east-ui";
import { resolveTag } from "@elaraai/east-ui/internal";
import type { SheetSubRowsValue } from "./sub-rows.js";
import { SheetMembersType, SheetRegisterMembersType, parseLink, EMPTY_LINK } from "./link.js";
import { buildDraftRowDecoder, buildDraftGroupDecoder, buildDraftEntryDecoder } from "./draft-bridge.js";
import { buildDraftContextBridge, buildDraftBase, buildDraftLift, buildReadyContexts } from "./context-bridge.js";
import { SheetDraftEntryTypeFor, SheetDraftGroupTypeFor } from "./drafts.js";
import { SheetDraftFieldType, SheetDraftTypeFor } from "./transactions.js";
import type { SheetAnyColumnConfig, SheetColumn } from "./columns.js";
import type { SheetGroupCell } from "./group.js";
import { dedupeMembers, type SheetDriverValue, type SheetRegisterValue } from "./registers.js";
import { actionRuleCells, buildActionCodec, buildComplete, describeAction, type SheetActionCodec } from "./actions.js";

/** The wire cells dictionary type. */
export const SheetCellsType = DictType(StringType, SheetCellType);

/** The East type of an erased expression (`Expr.type` cannot infer through `ExprType<EastType>`). */
function typeOf(e: unknown): EastType {
    return Expr.type(e as Expr<EastType>) as EastType;
}

// ============================================================================
// Column metadata — pass 1 of the root
// ============================================================================

/** How a `set` / `link` column's halves live on the row (§3.4). */
export type SheetLinkForm = "link" | "array" | "string";

/**
 * One UNRENDERED cell a column's rule projects (#844) — a date's `level` /
 * `actual`, a column's `detail` — compiled once over the row type.
 *
 * @internal
 */
export interface SheetRuleCellMeta {
    /** The cell key ({@link sheetRuleCell}). */
    key: string;
    /** The reified accessor over the row. */
    fn: ExprType<FunctionType<[StructType], EastType>>;
    /** The cell arm the accessor's payload lands in. */
    tag: "String" | "DateTime";
    /** Whether the accessor returns an `Option` of the payload. */
    optional: boolean;
}

/**
 * One declared column, described against the row type — the static facts
 * every East function below is built from.
 *
 * @internal
 */
export interface SheetColumnMeta {
    /** The column key — the row field it sits on (a band cell: the line column it sits under, or `$title`). */
    key: string;
    /** The row field the cell reads and writes — the key for a column, a band cell's `field`. */
    field: string;
    /** The column kind. */
    kind: SheetColumnKindLiteral;
    /** The author's config. */
    config: SheetAnyColumnConfig;
    /** The row field's static type. */
    fieldType: EastType;
    /** Whether the field is an `Option` of the payload. */
    optional: boolean;
    /** The kind's payload type. */
    payloadType: EastType;
    /** The cell arm the payload lands in. */
    cellTag: "String" | "DateTime" | "Float" | "Integer" | "Boolean" | "Link" | "Action";
    /** Whether the sheet writes the column. */
    editable: boolean;
    /** A reified `value` projection — the column is a derived, read-only read. */
    derived?: ExprType<FunctionType<[StructType], EastType>>;
    /** Whether the derived projection returns an `Option` of the payload. */
    derivedOptional?: boolean;
    /** A `set` / `link` column's storage form. */
    form?: SheetLinkForm;
    /** For the `array` form: the half THIS field holds. */
    ownHalf?: "from" | "to";
    /** For a `link` column in the `array` form: the field holding the other half. */
    otherField?: string;
    /** The register the column resolves against. */
    register?: string;
    /** The driver's row type the column was built with. */
    driverType?: StructType;
    /** The unrendered cells the column's rules project (#844). */
    ruleCells?: SheetRuleCellMeta[];
    /** An action column's cell codec (#1474). */
    action?: SheetActionCodec;
    /** A cycle over a variant's steps: the register they make, and how a case and its key cross. */
    steps?: SheetStepsCodec;
    /** The column's `mark` over the row and the Record's day — words on its cells, or a lock; a column from data's is its {@link SheetFromDataMeta}'s. */
    mark?: ExprType<FunctionType<[StructType, DateTimeType], OptionType<typeof RecordMarkType>>>;
    /** A column from data: where its columns come from, and how each cell reads and writes the field. */
    data?: SheetFromDataMeta;
}

/**
 * One column of a family made from a struct's fields: the field it shows, its
 * header, and the value it holds.
 *
 * @internal
 */
export interface SheetStructMember {
    /** The struct's field. */
    name: string;
    /** The column's header, as `each` gives it. */
    header: string;
    /** The value the column's cells hold: the kind's, or an `Option` of it. */
    valueType: EastType;
    /** Whether a clear writes `none`: the struct's field is an `Option`. */
    clears: boolean;
}

/**
 * A column from data, described: where its columns come from — a register's
 * members, or a struct's fields — and the functions each cell is read and
 * written through, the author's or the defaults its field's shape makes
 * obvious, each checked against the field, the members' key, the kind's value
 * and the day.
 *
 * @internal
 */
export type SheetFromDataMeta = {
    /** Its columns are a register's members. */
    from: "register";
    /** The register, by name. */
    register: string;
    /** The register whose members head the columns' groups, through each member's `parent`. */
    groups: string | undefined;
    /** The value a cell holds: the kind's, or an `Option` of it. */
    valueType: EastType;
    /** Whether a clear writes `none`: the value `write` takes is an `Option`. */
    clears: boolean;
    /** `(field, member, day) → value`. */
    read: ExprType<FunctionType>;
    /** `(field, member, value, day) → field`; none for read-only columns. */
    write: ExprType<FunctionType> | undefined;
    /** `(field, member, day) → Option<Record.Types.Mark>`. */
    mark: ExprType<FunctionType> | undefined;
} | {
    /** Its columns are a struct's fields. */
    from: "fields";
    /** The struct `read` gives. */
    structType: StructType;
    /** The columns, in the order `each` gives them. */
    members: readonly SheetStructMember[];
    /** `(field, day) → struct`. */
    read: ExprType<FunctionType>;
    /** `(field, struct, day) → field`; none for read-only columns. */
    write: ExprType<FunctionType> | undefined;
    /** `(field, day) → Option<Record.Types.Mark>`. */
    mark: ExprType<FunctionType> | undefined;
};

/**
 * A cycle over a variant (`Record.column.cycle(R, V, { steps })`): its steps
 * as a register keyed by the cases' names, and how a case and its key cross.
 * The cell holds the key, so the renderer's cycle draws it as it draws any
 * register's.
 *
 * @internal
 */
export interface SheetStepsCodec {
    /** The steps as a register's members, in stepping order. */
    members: SheetRegisterValue;
    /** A case → its key. */
    encode: ExprType<FunctionType<[VariantType], StringType>>;
    /** A key → its case; `none` for a key no case has. */
    decode: ExprType<FunctionType<[StringType], OptionType<VariantType>>>;
}

/** Whether a type is `Option<T>` — a variant of exactly `none: Null` and `some`. */
export function optionPayload(t: EastType): EastType | undefined {
    const v = t as { type: string; cases?: Record<string, EastType> };
    if (v.type !== "Variant" || v.cases === undefined) return undefined;
    const keys = Object.keys(v.cases);
    if (keys.length !== 2 || v.cases["none"] === undefined || v.cases["some"] === undefined) return undefined;
    if ((v.cases["none"] as { type: string }).type !== "Null") return undefined;
    return v.cases["some"];
}

/** The cell arm a primitive payload lands in, or `undefined` for a type no cell holds. */
export function cellTagOf(t: EastType): SheetColumnMeta["cellTag"] | undefined {
    if (isTypeEqual(t, SheetLinkType)) return "Link";
    switch ((t as { type: string }).type) {
        case "String":   return "String";
        case "DateTime": return "DateTime";
        case "Float":    return "Float";
        case "Integer":  return "Integer";
        case "Boolean":  return "Boolean";
        default:         return undefined;
    }
}

const SCALAR_PAYLOAD: Partial<Record<SheetColumnKindLiteral, EastType>> = {
    text: StringType, lookup: StringType, reference: StringType, enum: StringType, stamped: StringType,
    date: DateTimeType, quantity: FloatType, integer: IntegerType,
    title: StringType, person: StringType, cycle: StringType, boolean: BooleanType, toggle: BooleanType,
};

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
 * @returns The column's metadata
 * @throws Error naming the column when the kind cannot sit on the field
 */
export function describeColumn(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
    const cfg = col.config;
    if (cfg.each === undefined) {
        for (const option of ["groups", "field", "read", "write"] as const) {
            if (cfg[option] !== undefined) {
                throw new Error(`Sheet: column "${key}" has \`${option}\`, which a column from data takes — give it \`each\`: the register whose members it makes a column for, or the struct's fields`);
            }
        }
    }
    const meta = cfg.each !== undefined ? describeFromData(key, col, rowType) : describeKind(key, col, rowType);
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
 * the member, and the struct `each` names. Every refusal names the column and
 * the remedy.
 */
function describeFromData(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
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
        accepted = [payloadType];
        cellTag = cellTagOf(payloadType)!;
        valueName = describeType(payloadType);
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
        // One column per member of a register: the functions take the member's key.
        const entry = fieldType.type === "Dict" && (fieldType.key as EastType).type === "String" && holds(fieldType.value as EastType) && optionPayload(fieldType.value as EastType) === undefined
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
            read = East.function([fieldType, StringType, DateTimeType], valueType, (_$, value, member, _day) =>
                (value as unknown as ExprType<DictType<StringType, EastType>>).tryGet(member)) as unknown as ExprType<FunctionType>;
            if (writes) {
                write = East.function([fieldType, StringType, valueType, DateTimeType], fieldType, ($, value, member, given, _day) => {
                    const next = $.let((value as unknown as ExprType<DictType<StringType, EastType>>).copy());
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
            if (pinned.inputs.length !== 3 || !isTypeEqual(pinned.inputs[0]!, fieldType) || !isTypeEqual(pinned.inputs[1]!, StringType) || !isTypeEqual(pinned.inputs[2]!, DateTimeType)) {
                throw new Error(`${where} has a \`read\` over (${spell(pinned.inputs)}) — it reads ${fieldSpelt}, the member's key (String) and the day (DateTime)`);
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
                if (pinnedWrite.inputs.length !== 4 || !isTypeEqual(writeField!, fieldType) || !isTypeEqual(writeMember!, StringType)
                    || !(isTypeEqual(writeValue!, own) || isTypeEqual(writeValue!, OptionType(own))) || !isTypeEqual(writeDay!, DateTimeType)) {
                    throw new Error(`${where} has a \`write\` over (${spell(pinnedWrite.inputs)}) — it writes ${fieldSpelt} given the member's key (String), the value its \`read\` gives (${describeType(own)}, or an Option of it) and the day (DateTime)`);
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
            from: "register", register: each, groups: cfg.groups, valueType, clears, read, write,
            mark: markOf([fieldType, StringType, DateTimeType], `${fieldSpelt}, the member's key (String) and the day (DateTime)`),
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
        ...(steps !== undefined ? { register: `$steps:${key}`, steps } : {}),
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
    return {
        key, field: key, kind: "cycle", config: col.config, fieldType, optional: false,
        payloadType: StringType, cellTag: "String", editable: col.config.editable !== false,
        register: `$steps:${key}`,
        steps: stepsOf(key, col),
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
    return { members, encode, decode };
}

/** {@link describeColumn}'s kind-by-kind half. */
function describeKind(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetColumnMeta {
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

    // A derived read — the projection decides the payload; the field is free.
    if (cfg.value !== undefined && kind !== "set" && kind !== "link" && kind !== "stamped" && kind !== "custom") {
        const payloadType = SCALAR_PAYLOAD[kind] as EastType;
        const derived = East.function([rowType], undefined, (_$, r) => cfg.value!(r)) as unknown as ExprType<FunctionType<[StructType], EastType>>;
        const out = (Expr.type(derived) as FunctionType).output as EastType;
        const outPayload = optionPayload(out);
        const outUnwrapped = outPayload ?? out;
        if (!isTypeEqual(outUnwrapped, payloadType)) {
            throw new Error(`Sheet: column "${key}" is a ${kind} column whose \`value\` projection returns ${(outUnwrapped as { type: string }).type} — a ${kind} column's projection must return ${(payloadType as { type: string }).type} or its Option`);
        }
        return {
            key, field: key, kind, config: cfg, fieldType, optional, payloadType,
            cellTag: cellTagOf(payloadType)!, editable: false,
            derived, derivedOptional: outPayload !== undefined,
            ...(col.register !== undefined ? { register: col.register } : {}),
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
    if (!isTypeEqual(unwrapped, payloadType)) {
        throw new Error(`Sheet: ${kind} column "${key}" must sit on a ${(payloadType as { type: string }).type} or Option<${(payloadType as { type: string }).type}> field — got ${(fieldType as { type: string }).type}`);
    }
    return {
        key, field: key, kind, config: cfg, fieldType, optional, payloadType,
        cellTag: cellTagOf(payloadType)!,
        editable: kind !== "stamped" && cfg.editable !== false,
        ...(col.register !== undefined ? { register: col.register } : {}),
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
 * @returns The cell's metadata
 * @throws Error naming the band cell when the kind cannot sit on the field, or is not a band kind
 */
export function describeGroupCell(cellKey: string, cell: SheetGroupCell<StructType>, groupType: StructType): SheetColumnMeta {
    if (cell.kind === "lookup" || cell.kind === "set" || cell.kind === "link" || cell.kind === "custom" || cell.kind === "action") {
        throw new Error(`Sheet: band cell "${cellKey}" is a ${cell.kind} cell — a band draws text, date, quantity, integer, reference, enum and stamped cells only`);
    }
    let meta: SheetColumnMeta;
    try {
        meta = describeColumn(cell.field, { kind: cell.kind, config: cell.config, ...(cell.register !== undefined ? { register: cell.register } : {}) }, groupType);
    } catch (e) {
        throw new Error(`Sheet: band cell "${cellKey}" — ${(e as Error).message.replace(/^Sheet: /, "")}`);
    }
    return { ...meta, key: cellKey, field: cell.field };
}

// ============================================================================
// Cells — payload ↔ cell (the static-tag moves)
// ============================================================================

/** A payload value as a cell. */
export function cellOfPayload(tag: SheetColumnMeta["cellTag"], v: ExprType<EastType>): ExprType<SheetCellType> {
    return East.value(variant(tag, v) as unknown as SubtypeExprOrValue<SheetCellType>, SheetCellType);
}

/** The blank cell. */
export const NULL_CELL = East.value(variant("Null", null), SheetCellType);

/** A field VALUE (the payload or its Option) as a cell, by the column's static shape. */
function cellOfFieldValue(tag: SheetColumnMeta["cellTag"], v: ExprType<EastType>, optional: boolean): ExprType<SheetCellType> {
    if (!optional) return cellOfPayload(tag, v);
    return (v as unknown as ExprType<OptionType<EastType>>).match({
        some: (_$, x) => cellOfPayload(tag, x as ExprType<EastType>),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

/**
 * The cell of a column for one row — the projection `make` and `encode`
 * share. `members` is the column's register (bound in the caller's block)
 * for the `String` link form.
 */
function projectCell(
    meta: SheetColumnMeta,
    r: ExprType<StructType>,
    members: ExprType<typeof SheetRegisterMembersType> | undefined,
): ExprType<SheetCellType> {
    const row = r as unknown as Record<string, ExprType<EastType>>;
    if (meta.derived !== undefined) {
        return cellOfFieldValue(meta.cellTag, meta.derived(r), meta.derivedOptional === true);
    }
    const fv = row[meta.field] as ExprType<EastType>;
    // An action column's case and its value (#1474).
    if (meta.action !== undefined) {
        const encode = meta.action.encode;
        return meta.optional
            ? (fv as unknown as ExprType<OptionType<VariantType>>).match({ some: (_$, v) => encode(v), none: (_$) => NULL_CELL }) as ExprType<SheetCellType>
            : encode(fv as ExprType<VariantType>);
    }
    // A cycle over a variant: its case's key.
    if (meta.steps !== undefined) return cellOfPayload("String", meta.steps.encode(fv as ExprType<VariantType>) as ExprType<EastType>);
    if (meta.form === undefined) return cellOfFieldValue(meta.cellTag, fv, meta.optional);
    if (meta.form === "link") return cellOfFieldValue(meta.cellTag, fv, meta.optional);
    if (meta.form === "array") {
        const half = fv as unknown as ExprType<typeof SheetMembersType>;
        const empty = East.value([], SheetMembersType);
        const other = meta.otherField !== undefined ? row[meta.otherField] as unknown as ExprType<typeof SheetMembersType> : empty;
        const link = meta.ownHalf === "from"
            ? East.value({ from: half, to: other }, SheetLinkType)
            : East.value({ from: other, to: half }, SheetLinkType);
        return cellOfPayload("Link", link as unknown as ExprType<EastType>);
    }
    // The String form — the grammar parses it on read; blank text is the blank cell.
    const parse = (text: ExprType<StringType>): ExprType<SheetCellType> =>
        text.trim().length().equal(0n).ifElse(
            (_$) => NULL_CELL,
            (_$) => cellOfPayload("Link", parseLink(text, members ?? East.value([], SheetRegisterMembersType)) as unknown as ExprType<EastType>),
        ) as ExprType<SheetCellType>;
    if (!meta.optional) return parse(fv as ExprType<StringType>);
    return (fv as unknown as ExprType<OptionType<StringType>>).match({
        some: (_$, s) => parse(s),
        none: (_$) => NULL_CELL,
    }) as ExprType<SheetCellType>;
}

// ============================================================================
// The bridge
// ============================================================================

/**
 * The resolved source the bridge reads real rows from: an inline Array, a
 * record's whole Dict read in key order (#1182), or a paged source, its
 * windows read by key when they are keyed. `keyType` is a keyed source's key.
 */
export type SheetBridgeSource =
    | { kind: "inline"; rows: ExprType<ArrayType<StructType>> }
    | { kind: "keyed"; rows: ExprType<DictType<EastType, EastType>>; keyType: EastType }
    | { kind: "paged"; source: ExprType<StructType>; keyed: boolean; keyType?: EastType | undefined };

/**
 * A row's id → its key in a keyed source: a String key is its own text, any
 * other key its `.east` printing (as `Record.onApply` reads it), and text that
 * names no key of the type names none.
 *
 * @param keyType - The source's key type
 * @returns `id` → `some(key)`, or `none`
 */
function keyOfId(keyType: EastType): ExprType<FunctionType<[StringType], OptionType<EastType>>> {
    if (keyType.type === "String") {
        return East.function([StringType], OptionType(StringType), (_$, id) => some(id)) as unknown as ExprType<FunctionType<[StringType], OptionType<EastType>>>;
    }
    return East.function([StringType], OptionType(keyType), ($, id) => {
        const key = $.let(none, OptionType(keyType));
        $.try(($2) => { $2.assign(key, some(id.parse(keyType))); }).catch((_$2) => {});
        return key;
    }) as unknown as ExprType<FunctionType<[StringType], OptionType<EastType>>>;
}

/**
 * The group half of a bridge (#740) — the group's summary cells and child rows on
 * the wire.
 *
 * @internal
 */
export interface SheetGroupBridge {
    /** The field holding the lines — an `Array<L>`, a line addressed by its index. */
    linesField: string;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
    /** `P` → the band's cells. */
    projectGroupCells: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `P` → its wire lines, in order, keyed by source identity. */
    projectLines: ExprType<FunctionType<[StructType], ArrayType<SheetLineType>>>;
    /** The group's row type `P` — the source row's, or on a source with loose rows its entries' group arm (#846). */
    groupType: StructType;
    /** Whether the source holds loose rows between its groups — entries `Sheet.Types.Entry(P, "lines")` (#846). */
    loose: boolean;
    /** A group's cells and lines over its `DraftGroup(P, "lines")` — the whole `draftDecode` without loose rows. */
    decodeGroup: ExprType<FunctionType<[SheetRowType, OptionType<StructType>, OptionType<SheetRowType>], StructType>>;
    /** A loose row's cells over its `Draft(L)`, its id field written from the row's id (#846). */
    decodeLoose?: ReturnType<typeof buildDraftRowDecoder> | undefined;
}

/**
 * The compiled bridge of one sheet — every wire function the root stores is
 * built from these.
 *
 * @remarks
 * `rowType` is the SOURCE row's type — the host's row on a flat sheet, the
 * group's on a grouped one, the entry `Sheet.Types.Entry(P, "lines")` on one
 * with loose rows (#846) — and `lineType` the type the columns are declared
 * over: the same type on a flat sheet, the line type on a grouped one. The
 * patch, the proposal, `projectRow` and `draftRow` run over `lineType`;
 * `rowById` and the edit type over `rowType`.
 *
 * @internal
 */
export interface SheetBridge {
    /** The source row's type — the host's row, the group's, or an entry of groups and loose rows. */
    rowType: EastType;
    /** The type the columns are declared over — the row, or the line. */
    lineType: StructType;
    /** The driver's row type (`NullType` without a driver). */
    driverType: EastType;
    /** `Sheet.Types.DraftContext(R, D)` — or `Context(P, "lines", D)` on a grouped sheet. */
    ctxType: StructType;
    /** `Sheet.Types.CheckContext(R)` — or `CheckContext(P, "lines")`. */
    checkCtxType: StructType;
    /** `Sheet.Types.Patch(L)`. */
    patchType: StructType;
    /** `Sheet.Types.Proposal(L)`. */
    proposalType: StructType;
    /** Constructor defaults, including read-only cells. */
    seedCells: SheetBridge["encodePatch"];
    /** `L` → the wire cells. */
    projectRow: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** `L` → its sub rows, sources in declaration order (#844; `[]` without `subRows`). */
    projectSubRows: ExprType<FunctionType<[StructType], ArrayType<SheetSubRowType>>>;
    /** Decode one row into its complete field draft. */
    draftRow: ReturnType<typeof buildDraftRowDecoder>;
    /** Decode edited cells into the source row's draft, preserving the previous child identities. */
    draftDecode: ExprType<FunctionType<[SheetRowType, OptionType<EastType>, OptionType<SheetRowType>], EastType>>;
    /** `(id, offset)` → the real source row. */
    rowById: ExprType<FunctionType<[StringType, IntegerType], OptionType<EastType>>>;
    /** The wire context → the typed context. */
    bridgeCtx: ExprType<FunctionType<[SheetContextType], StructType>>;
    /** A readiness batch → one typed context per check, over rows built once (#882). */
    bridgeReady: ExprType<FunctionType<[typeof SheetReadyBatchType], ArrayType<StructType>>>;
    /** `Sheet.Types.Patch(L)` → the set fields as cells. */
    encodePatch: ExprType<FunctionType<[StructType], typeof SheetCellsType>>;
    /** The group half — present on a grouped sheet. */
    group?: SheetGroupBridge;
    /** A row's cells at a day, over its draft or its entry: each column from data's, and every column's marks — present where a column reads any. */
    cellsAt?: ExprType<FunctionType<[typeof SheetReadFromType, DateTimeType], typeof SheetCellsType>>;
    /** A gesture's writes through the columns from data — its wire cells, the draft before it, the draft its cells decode to, and the day → the draft — present where a column from data writes. */
    writeData?: ExprType<FunctionType<[typeof SheetCellsType, OptionType<StructType>, StructType, DateTimeType], StructType>>;
}

/** The group declaration the bridge needs from the root (#740). */
export interface SheetBridgeGroupInput {
    /** The field holding the lines. */
    linesField: string;
    /** The band's cells, the title first. */
    cellMetas: SheetColumnMeta[];
}

/**
 * Binds a function once in the block a sheet is built in, and answers the
 * variable that names it there.
 *
 * @remarks
 * A wire function the root builds — a column's fill provider, a rule, a
 * check, the draft context — writes out in full every function of the
 * bridge it calls, and a sheet builds dozens of them, so a bridge written
 * into each would make a program many times the size it needs to be. Each of
 * the bridge's functions held once, the wire functions built after refer to
 * the block's variable instead. A sheet built in no block holds nothing.
 *
 * @internal
 */
export type SheetHold = <T extends EastType>(value: ExprType<T>) => ExprType<T>;

/** What the bridge needs from the root. */
export interface SheetBridgeInput {
    /** The source row's type — a struct, or on a source with loose rows the entry variant (#846). */
    rowType: EastType;
    idField: string | undefined;
    metas: SheetColumnMeta[];
    /** The columns from data: a row carries their rule cells over the row alone — a detail, a date's level and actual —
     *  never a member's cell, which is read at the Record's day. */
    dataMetas?: readonly SheetColumnMeta[];
    registers: Record<string, SheetRegisterValue>;
    driver: SheetDriverValue | undefined;
    source: SheetBridgeSource;
    group?: SheetBridgeGroupInput;
    subRows?: SheetSubRowsValue<StructType>;
    /** Binds each of the bridge's functions once in the block the sheet is
     *  built in ({@link SheetHold}); the functions are written where they are
     *  used without one. */
    hold?: SheetHold;
}

/**
 * The id of a row — the id field; on a source with loose rows (#846) the id
 * field of whichever arm the entry holds.
 */
function idOf(r: ExprType<EastType>, idField: string | undefined): ExprType<StringType> {
    if (idField === undefined) throw new Error("Sheet: a positional source needs `id` — the String field that identifies a row");
    if (Expr.type(r as Expr<EastType>).type === "Variant") {
        return (r as unknown as ExprType<VariantType<{ group: StructType; row: StructType }>>).match({
            group: (_$, g) => (g as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>,
            row: (_$, l) => (l as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>,
        });
    }
    return (r as unknown as Record<string, ExprType<StringType>>)[idField] as ExprType<StringType>;
}

/** A source of LOOSE rows between groups (#846): the entry variant `Sheet.Types.Entry(P, "lines")`. */
type SheetEntryVariant = VariantType<{ group: StructType; row: StructType }>;

/**
 * Compile the bridge for one sheet.
 *
 * @param input - The root's resolved declaration
 * @returns The bridge
 */
export function buildBridge(input: SheetBridgeInput): SheetBridge {
    const { rowType, idField, metas, registers, driver, source, group: groupInput, subRows } = input;
    // Each function held as it is built, so every one built after refers to it.
    const hold: SheetHold = input.hold ?? ((value) => value);
    const driverType: EastType = driver !== undefined ? driver.rowType : NullType;
    // A grouped sheet's columns are declared over the LINE type; its source
    // rows are groups — or, with loose rows between them (#846), entries of a
    // group or a row of the line type. A flat sheet's line type is its row type.
    const loose = rowType.type === "Variant";
    const groupType = loose ? (rowType as SheetEntryVariant).cases.group : rowType as StructType;
    const shape = groupInput !== undefined ? sheetLinesOf(groupType, groupInput.linesField) : undefined;
    const lineType = shape?.lineType ?? groupType;
    const lineIdField = shape === undefined ? idField : undefined;
    const ctxType = (groupInput !== undefined
        ? SheetGroupContextTypeFor(groupType, groupInput.linesField as never, driverType)
        : SheetContextTypeFor(lineType, driverType)) as unknown as StructType;
    const checkCtxType = (groupInput !== undefined
        ? SheetGroupCheckContextTypeFor(groupType, groupInput.linesField as never)
        : SheetCheckContextTypeFor(lineType)) as unknown as StructType;
    const patchType = SheetPatchTypeFor(lineType) as unknown as StructType;
    const proposalType = SheetProposalTypeFor(lineType) as unknown as StructType;
    // L → the wire cells. Registers are bound ONCE per body for the String
    // link form (the capture rule: data, never a spliced expression).
    const stringFormRegisters = [...new Set(metas.filter((m) => m.form === "string" && m.register !== undefined).map((m) => m.register!))];
    const projectRow = hold(East.function([lineType], SheetCellsType, ($, r) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        for (const m of metas) {
            $(cells.insert(m.key, projectCell(m, r, m.register !== undefined ? bound.get(m.register) : undefined)));
            for (const rc of m.ruleCells ?? []) {
                const rule = $.const(rc.fn);
                $(cells.insert(rc.key, cellOfFieldValue(rc.tag, rule(r), rc.optional)));
            }
        }
        for (const m of input.dataMetas ?? []) {
            for (const rc of m.ruleCells ?? []) {
                const rule = $.const(rc.fn);
                $(cells.insert(rc.key, cellOfFieldValue(rc.tag, rule(r), rc.optional)));
            }
        }
        return cells;
    })) as unknown as SheetBridge["projectRow"];
    const projectSubRows = hold(buildSubRowProjection(lineType, subRows));

    // (id, offset) → the real source row. Inline, the row at its offset
    // answers first — the renderer reads a resident row where it sits — and
    // otherwise the nearest match outward from there, so a row that a local
    // edit shifted is found in the steps it moved: a read is never a scan of
    // the collection, which made every context and every readiness check
    // quadratic in the rows (#859). The search starts inside the rows, so a
    // stale offset still finds the row. A keyed source — a record read whole
    // (#1182), or a keyed window — reads the row by its key.
    const pagedKeyOf = source.kind === "paged" && source.keyed && source.keyType !== undefined && source.keyType.type !== "String"
        ? keyOfId(source.keyType) : undefined;
    const rowById = hold((source.kind === "keyed"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, _offset) => {
            const rows = $.const(source.rows, DictType(source.keyType, rowType));
            const keyOf = $.const(keyOfId(source.keyType));
            return keyOf(id).match({
                none: (_$2) => East.value(none, OptionType(rowType)),
                some: (_$2, key) => rows.tryGet(key),
            });
        })
        : source.kind === "inline"
        ? East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const rows = $.const(source.rows as ExprType<ArrayType<EastType>>, ArrayType(rowType));
            const size = $.let(rows.size());
            const start = $.let(offset.less(0n).ifElse(() => 0n, () => offset.greaterEqual(size).ifElse(() => size.subtract(1n), () => offset)));
            const step = $.let(0n);
            $.while(start.subtract(step).greaterEqual(0n).or(() => start.add(step).less(size)), ($2) => {
                const below = $2.let(start.subtract(step));
                $2.if(below.greaterEqual(0n), ($3) => {
                    const r = $3.let(rows.get(below));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                const above = $2.let(start.add(step));
                $2.if(step.greater(0n).and(() => above.less(size)), ($3) => {
                    const r = $3.let(rows.get(above));
                    $3.if(idOf(r, idField).equal(id), ($4) => { $4.return(East.value(some(r), OptionType(rowType))); });
                });
                $2.assign(step, step.add(1n));
            });
            return East.value(none, OptionType(rowType));
        })
        : East.function([StringType, IntegerType], OptionType(rowType), ($, id, offset) => {
            const src = $.const(source.source as unknown as ExprType<StructType<{ page: FunctionType<[IntegerType, IntegerType], OptionType<EastType>> }>>);
            const noRow = $.const(none, OptionType(rowType));
            const keyOf = pagedKeyOf !== undefined ? $.const(pagedKeyOf) : undefined;
            return src.page(offset, 1n).match({
                none: (_$) => noRow,
                some: (_$, win) => !source.keyed
                    ? (win as unknown as ExprType<ArrayType<EastType>>).firstMap((_$2, r) => idOf(r, idField).equal(id).ifElse(
                        (_$3) => East.value(some(r), OptionType(rowType)),
                        (_$3) => East.value(none, OptionType(rowType)),
                    ))
                    : keyOf === undefined
                        ? (win as unknown as ExprType<DictType<StringType, EastType>>).tryGet(id)
                        : keyOf(id).match({
                            none: (_$2) => noRow,
                            some: (_$2, key) => (win as unknown as ExprType<DictType<EastType, EastType>>).tryGet(key),
                        }),
            });
        })) as unknown as SheetBridge["rowById"]);

    // The driver lookup — the driver data folded once into a dictionary; a
    // driverless sheet's lookup is always `none` (its `D` is `Null`).
    const lookupDriver = hold(driver !== undefined
        ? East.function([StringType], OptionType(driverType), ($, k) => {
            const dict = $.const(
                driver.data.toDict((_$, d) => driver.keyFn(d), (_$, d) => d),
                DictType(StringType, driverType),
            );
            return dict.tryGet(k);
        })
        : East.function([StringType], OptionType(driverType), ($, _k) => $.const(none, OptionType(driverType))));

    // The drafts: a line's cells over its draft (no id — a line's identity is
    // its place), and on a source with loose rows (#846) a loose row's, whose
    // id field is its own.
    // On a sheet with an action column, a read-only cell is read back too: an action's `updates` writes any field (#1477).
    const written = metas.some((m) => m.action !== undefined);
    const draftRow = hold(buildDraftRowDecoder(lineType, metas, registers, lineIdField, written));
    const looseRow = loose ? hold(buildDraftRowDecoder(lineType, metas, registers, idField, written)) : undefined;
    const decodeGroup = groupInput !== undefined
        ? hold(buildDraftGroupDecoder(groupType, groupInput.linesField, groupInput.cellMetas, draftRow, registers, idField, written))
        : undefined;
    const flatDraft = SheetDraftTypeFor(groupType) as StructType;
    const draftDecode = (decodeGroup === undefined
        ? hold(East.function([SheetRowType, OptionType(flatDraft), OptionType(SheetRowType)], flatDraft, ($, row, base, _previous) => {
            const decode = $.const(draftRow);
            return decode(row.id, row.cells, base);
        }))
        : looseRow !== undefined && groupInput !== undefined
            ? hold(buildDraftEntryDecoder(rowType as SheetEntryVariant, groupInput.linesField, decodeGroup, looseRow))
            : decodeGroup) as unknown as SheetBridge["draftDecode"];

    // The group half (#740).
    const groupProjections = groupInput !== undefined ? buildGroupBridge(groupType, groupInput, projectRow, projectSubRows) : undefined;
    const group = groupInput !== undefined && groupProjections !== undefined && shape !== undefined && decodeGroup !== undefined
        ? {
            ...groupProjections,
            projectGroupCells: hold(groupProjections.projectGroupCells),
            projectLines: hold(groupProjections.projectLines),
            groupType, loose, decodeGroup, decodeLoose: looseRow,
        }
        : undefined;

    const bridgeCtx = hold(buildDraftContextBridge(rowType, lineType, groupInput?.linesField, ctxType, driverType,
        rowById, draftDecode, draftRow, lookupDriver, looseRow));
    const bridgeReady = hold(buildReadyContexts(rowType, groupInput?.linesField, ctxType, driverType,
        rowById, draftDecode, lookupDriver, loose));

    // The columns from data and every column's marks (#1559): read at the Record's day over a row's draft or its entry,
    // and a gesture's edits to them written over the draft — a flat row's, as a Record's rows are.
    const dataMetas = input.dataMetas ?? [];
    const marked = metas.some((m) => m.mark !== undefined);
    if ((dataMetas.length > 0 || marked) && groupInput !== undefined) {
        throw new Error("Sheet: columns from data and marks are read over a flat row's draft — a grouped sheet draws neither");
    }
    // Each register columns from data are made from, its members once in the sheet's block: one column per key.
    const members = new Map(dataMetas.flatMap((m) => m.data?.from === "register" ? [m.data.register] : [])
        .map((name) => [name, hold(dedupeMembers(registers[name]!))] as const));
    const cellsAt = dataMetas.length > 0 || marked ? hold(buildCellsAt(lineType, metas, dataMetas, members)) : undefined;
    const writes = buildWriteData(lineType, dataMetas, members);
    const writeData = writes !== undefined ? hold(writes) : undefined;

    return {
        rowType, lineType, driverType, ctxType, checkCtxType, patchType, proposalType,
        projectRow, projectSubRows, draftDecode, draftRow, rowById,
        bridgeCtx: bridgeCtx as unknown as SheetBridge["bridgeCtx"],
        bridgeReady,
        encodePatch: hold(buildPatchCells(lineType, metas, registers)),
        seedCells: hold(buildPatchCells(lineType, metas, registers, false)),
        ...(group !== undefined ? { group } : {}),
        ...(cellsAt !== undefined ? { cellsAt } : {}),
        ...(writeData !== undefined ? { writeData } : {}),
    };
}

/** Project supplied constructor/proposal fields without inventing a complete row. @internal */
export function buildPatchCells(rowType: StructType, metas: readonly SheetColumnMeta[], registers: Record<string, SheetRegisterValue>, editableOnly = true): SheetBridge["encodePatch"] {
    const patchType = SheetPatchTypeFor(rowType) as StructType;
    const fields = rowType.fields;
    const stringFormRegisters = [...new Set(metas.filter(m => m.form === "string" && m.register !== undefined).map(m => m.register!))];
    return East.function([patchType], SheetCellsType, ($, patch) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const p = patch as unknown as Record<string, ExprType<OptionType<EastType>>>;
        const bound = new Map<string, ExprType<typeof SheetRegisterMembersType>>();
        for (const name of stringFormRegisters) {
            bound.set(name, $.const(registers[name]!, SheetRegisterMembersType));
        }
        for (const m of metas) {
            if ((editableOnly && !m.editable) || m.derived !== undefined) continue;
            if (m.form === "array") {
                // The other half is `none` when the column names no other field.
                const otherKey = m.otherField;
                const own = $.let(p[m.field] as never, OptionType(SheetMembersType));
                const other = $.let((otherKey !== undefined ? p[otherKey] : none) as never, OptionType(SheetMembersType));
                $.if(own.hasTag("some").or(() => other.hasTag("some")), ($2) => {
                    const empty = $2.const([], SheetMembersType);
                    const ownVal = $2.let(own.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const otherVal = $2.let(other.match({ some: (_$, v) => v, none: (_$) => empty }), SheetMembersType);
                    const link = m.ownHalf === "from"
                        ? $2.let({ from: ownVal, to: otherVal }, SheetLinkType)
                        : $2.let({ from: otherVal, to: ownVal }, SheetLinkType);
                    $2(cells.insert(m.key, cellOfPayload("Link", link as unknown as ExprType<EastType>)));
                });
                continue;
            }
            const field = $.let(p[m.field] as never, OptionType(fields[m.field] as EastType));
            $.if(field.hasTag("some"), ($2) => {
                const v = $2.let(field.unwrap("some") as never, fields[m.field] as EastType);
                const asRow = { [m.field]: v } as unknown as ExprType<StructType>;
                $2(cells.insert(m.key, projectCell(m, asRow, m.register !== undefined ? bound.get(m.register) : undefined)));
            });
        }
        return cells;
    }) as unknown as SheetBridge["encodePatch"];
}

// ============================================================================
// Columns from data (#1559) — their cells read at the day, their edits
// written over the draft
// ============================================================================

/** The registers columns from data are made from, by name: each one's members, held once in the sheet's block. */
type SheetDataMembers = ReadonlyMap<string, ExprType<typeof SheetRegisterMembersType>>;

/** A block a member's cells are written in, whatever the function it sits in returns. */
type SheetAnyBlock = BlockBuilder<EastType>;

/** A draft's field: its value, missing, or text no column could read. */
type SheetDraftField = VariantType<{ value: EastType; missing: NullType; invalid: StringType }>;

/**
 * A member's value as its column's cell draws it: a variant's case by its
 * step's key, a change by its moment, any other value as its kind's payload —
 * an `Option`'s none the blank cell.
 */
function memberCell(meta: SheetColumnMeta, valueType: EastType, value: ExprType<EastType>): ExprType<SheetCellType> {
    const own = optionPayload(valueType);
    const change = isTypeEqual(own ?? valueType, RecordChangeType);
    const cellOf = (v: ExprType<EastType>): ExprType<SheetCellType> => meta.steps !== undefined
        ? cellOfPayload("String", meta.steps.encode(v as ExprType<VariantType>) as ExprType<EastType>)
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

/** A cell's mark, as the two cells beside it ({@link sheetRuleCell}): its words, and whether it locks the cell. */
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
 * `none` where the cell writes nothing: text no column could read, a cell of
 * another kind, or a blank where the value is no `Option`, which has nowhere
 * to hold one. A blank where it is one writes `none`.
 */
function writtenValue(meta: SheetColumnMeta, own: EastType, clears: boolean, cell: ExprType<SheetCellType>): ExprType<OptionType<EastType>> {
    const out = OptionType(clears ? OptionType(own) : own);
    const nothing = East.value(none, out);
    const given = (v: ExprType<EastType>): ExprType<OptionType<EastType>> => East.value(some(clears ? some(v) : v) as never, out);
    return cell.match({
        Null: (_$: unknown) => (clears ? East.value(some(none) as never, out) : nothing),
        [meta.cellTag]: (_$: unknown, payload: ExprType<EastType>) => (meta.steps === undefined ? given(payload)
            : meta.steps.decode(payload as ExprType<StringType>).match({
                some: (_$2, v) => given(v as ExprType<EastType>),
                none: (_$2) => nothing,
            })),
    } as never, (_$: unknown) => nothing) as ExprType<OptionType<EastType>>;
}

/**
 * Compile a row's cells at a day (#1559): each column from data's — every
 * member's value through its column's `read` — and every column's marks,
 * read over the row's draft, or over its entry before it has one. A field not
 * yet set shows nothing, nor one holding text no column could read; a mark
 * over the row reads it once its draft is whole.
 *
 * @param rowType - The row type
 * @param metas - The declared columns, for their marks
 * @param dataMetas - The columns from data
 * @param members - Each register they are made from, its members held once
 * @returns What a row is read over, and the day → its cells
 */
function buildCellsAt(rowType: StructType, metas: readonly SheetColumnMeta[], dataMetas: readonly SheetColumnMeta[], members: SheetDataMembers): NonNullable<SheetBridge["cellsAt"]> {
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const lift = buildDraftLift(rowType) as unknown as ExprType<FunctionType<[StructType], StructType>>;
    const marked = metas.filter((m) => m.mark !== undefined);
    const complete = marked.length > 0 ? buildComplete(rowType) : undefined;
    return East.function([SheetReadFromType, DateTimeType], SheetCellsType, ($, from, day) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        const toDraft = $.const(lift);
        const draft = $.const(from.match({
            entry: (_$2, bytes) => toDraft(bytes.decodeBeast(rowType, "v2")),
            draft: (_$2, bytes) => bytes.decodeBeast(draftType, "v2"),
        }), draftType);
        if (complete !== undefined) {
            const whole = $.const(complete);
            $.match(whole(draft), {
                some: ($2, row) => {
                    for (const m of marked) {
                        const mark = $2.const(m.mark!);
                        insertMark($2 as unknown as SheetAnyBlock, cells, East.value(m.key, StringType), mark(row, day));
                    }
                },
            });
        }
        const drafted = draft as unknown as Record<string, ExprType<SheetDraftField>>;
        for (const m of dataMetas) {
            const data = m.data!;
            $.match(drafted[m.field]!, {
                value: ($2, value) => {
                    if (data.from === "register") {
                        const read = $2.const(data.read as unknown as ExprType<FunctionType<[EastType, StringType, DateTimeType], EastType>>);
                        const mark = data.mark !== undefined
                            ? $2.const(data.mark as unknown as ExprType<FunctionType<[EastType, StringType, DateTimeType], OptionType<typeof RecordMarkType>>>)
                            : undefined;
                        $2.for(members.get(data.register)!, ($3, member) => {
                            const key = $3.const(East.str`${m.key}:${member.key}`);
                            insertMember($3 as unknown as SheetAnyBlock, cells, m, data.valueType, key, read(value, member.key, day));
                            if (mark !== undefined) insertMark($3 as unknown as SheetAnyBlock, cells, key, mark(value, member.key, day));
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
        return cells;
    }) as unknown as NonNullable<SheetBridge["cellsAt"]>;
}

/**
 * Compile a gesture's writes through the columns from data (#1559): each cell
 * the gesture changed — one its wire row holds that differs from what the
 * column's `read` gave over the field before the gesture — written through
 * its column's `write`, in the columns' order, each over the field as the
 * writes before it left it, whichever column made them. A field not yet set
 * starts from its type's default at its first write, as a nested struct the
 * inspector sets does; one holding text no column could read takes none.
 *
 * @param rowType - The row type
 * @param dataMetas - The columns from data
 * @param members - Each register they are made from, its members held once
 * @returns The gesture's cells, the draft before it, the draft its cells decode to and the day → the draft; `undefined` where no column from data writes
 */
function buildWriteData(rowType: StructType, dataMetas: readonly SheetColumnMeta[], members: SheetDataMembers): NonNullable<SheetBridge["writeData"]> | undefined {
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
            let seed: ExprType<OptionType<EastType>>;
            try {
                seed = East.value(some(defaultValue(fieldType)) as never, OptionType(fieldType));
            } catch {
                seed = East.value(none, OptionType(fieldType));
            }
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
                    const read = $.const(data.read as unknown as ExprType<FunctionType<[EastType, StringType, DateTimeType], EastType>>);
                    const write = $.const(data.write as unknown as ExprType<FunctionType<[EastType, StringType, EastType, DateTimeType], EastType>>);
                    $.for(members.get(data.register)!, ($2, member) => {
                        const key = $2.const(East.str`${m.key}:${member.key}`);
                        $2.match(cells.tryGet(key), {
                            some: ($3, cell) => {
                                const shown = $3.const(before.match({ value: (_$4, v) => memberCell(m, data.valueType, read(v, member.key, day)) }, (_$4) => NULL_CELL), SheetCellType);
                                $3.if(East.notEqual(cell, shown), ($4) => {
                                    $4.match(writtenValue(m, own, data.clears, cell), {
                                        some: ($5, given) => {
                                            $5.match(now, {
                                                some: ($6, field) => {
                                                    $6.assign(now, some(write(field, member.key, given, day)) as never);
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
            out[name] = wrote.ifElse(
                (_$2) => East.value(variant("value", now.unwrap("some")) as never, draftField),
                (_$2) => start,
            );
        }
        return East.value(out as SubtypeExprOrValue<StructType>, draftType);
    }) as unknown as NonNullable<SheetBridge["writeData"]>;
}

// ============================================================================
// Sub rows (#844)
// ============================================================================

/**
 * Compile the sub-row sources into one projection over the line type: each
 * mapper is compiled ONCE as `East.function([L, T], SubRow)` and called in
 * an eager map over its field; the sources concatenate in declaration order.
 *
 * @param lineType - The type the columns are built over
 * @param subRows - The `subRows` declaration, if any
 * @returns `L` → its sub rows
 * @throws Error when the declaration was built over another type, or a key is not an array field
 */
export function buildSubRowProjection(lineType: StructType, subRows: SheetSubRowsValue<StructType> | undefined): SheetBridge["projectSubRows"] {
    const fields = lineType.fields as Record<string, EastType>;
    const mappers: { field: string; fn: ExprType<FunctionType<[StructType, EastType], SheetSubRowType>> }[] = [];
    if (subRows !== undefined) {
        if (!isTypeEqual(subRows.rowType, lineType)) {
            throw new Error("Sheet: `subRows` was built over a different type than the columns — pass the columns' type (a grouped sheet: the line type) to `Sheet.subRows(…)`");
        }
        for (const [field, map] of Object.entries(subRows.sources as Record<string, ((item: ExprType<EastType>, row: ExprType<StructType>) => SubtypeExprOrValue<SheetSubRowType>) | undefined>)) {
            if (map === undefined) continue;
            const t = fields[field] as { type?: string; value?: EastType } | undefined;
            if (t === undefined || t.type !== "Array" || t.value === undefined) {
                throw new Error(`Sheet: \`subRows\` names "${field}", which is ${t === undefined ? "not a field of the row type" : `a ${t.type} field`} — a sub-row source must be an Array field`);
            }
            mappers.push({ field, fn: East.function([lineType, t.value], SheetSubRowType, (_$, row, item) => map(item, row)) });
        }
    }
    return East.function([lineType], ArrayType(SheetSubRowType), ($, r) => {
        const row = r as unknown as Record<string, ExprType<ArrayType<EastType>>>;
        let all: ExprType<ArrayType<SheetSubRowType>> = $.const([], ArrayType(SheetSubRowType));
        for (const m of mappers) {
            const map = $.const(m.fn);
            const part = $.let(row[m.field]!.map((_$2, x) => map(r, x)), ArrayType(SheetSubRowType));
            all = mappers[0] === m ? part : $.let(all.concat(part), ArrayType(SheetSubRowType));
        }
        return all;
    }) as unknown as SheetBridge["projectSubRows"];
}

// ============================================================================
// The group half (#740)
// ============================================================================

/**
 * Compile a group's summary cells and ordered children into wire rows.
 *
 * @param rowType - The group's row type
 * @param input - The child field and summary cell metadata
 * @param projectRow - Child row to wire cells
 * @param projectSubRows - Child row to its sub rows
 * @returns The group half
 */
function buildGroupBridge(
    rowType: StructType,
    input: SheetBridgeGroupInput,
    projectRow: SheetBridge["projectRow"],
    projectSubRows: SheetBridge["projectSubRows"],
): Pick<SheetGroupBridge, "linesField" | "cellMetas" | "projectGroupCells" | "projectLines"> {
    const { linesField, cellMetas } = input;
    const linesType = rowType.fields[linesField] as ArrayType<StructType>;
    const projectGroupCells = East.function([rowType], SheetCellsType, ($, p) => {
        const cells = $.let(new Map<string, never>(), SheetCellsType);
        for (const m of cellMetas) $(cells.insert(m.key, projectCell(m, p, undefined)));
        return cells;
    }) as SheetGroupBridge["projectGroupCells"];
    const projectLines = East.function([rowType], ArrayType(SheetLineType), ($, p) => {
        const project = $.const(projectRow);
        const subRowsOf = $.const(projectSubRows);
        const lines = $.const(p[linesField] as ExprType<ArrayType<StructType>>, linesType);
        return lines.map((_$, line, index) => East.value({ key: East.print(index), cells: project(line), subRows: subRowsOf(line) }, SheetLineType));
    }) as SheetGroupBridge["projectLines"];
    return { linesField, cellMetas, projectGroupCells, projectLines };
}

// ============================================================================
// Wrappers — the author's typed functions inside their wire twins
// ============================================================================

/** Whether an East function value is asynchronous. */
export function isAsyncFunction(fn: ExprType<EastType>): boolean {
    return (typeOf(fn) as { type: string }).type === "AsyncFunction";
}

/** Pin an author function value and check its East input type against the bridge's context type. */
function pinProvider(
    bridge: SheetBridge,
    fn: unknown,
    where: string,
    expectedOutput: EastType,
): { fn: ExprType<EastType>; async: boolean } {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" && t.type !== "AsyncFunction") {
        throw new Error(`Sheet: ${where} must be an East.function or East.asyncFunction — got a ${t.type}`);
    }
    const inputs = t.inputs ?? [];
    if (inputs.length !== 1 || !isTypeEqual(inputs[0]!, bridge.ctxType)) {
        throw new Error(`Sheet: ${where} must take exactly this sheet's context — ${contextName(bridge)} — as its one argument; a function written over another row or driver type cannot run here`);
    }
    if (t.output === undefined || !isTypeEqual(t.output, expectedOutput)) {
        throw new Error(`Sheet: ${where} returns the wrong type — it must return ${describeType(expectedOutput)}`);
    }
    return { fn: expr, async: t.type === "AsyncFunction" };
}

/** How this sheet's context is spelt, for a refusal message. */
function contextName(bridge: SheetBridge): string {
    const driver = isTypeEqual(bridge.driverType, NullType) ? "" : ", DriverType";
    return bridge.group !== undefined
        ? `Sheet.Types.DraftContext(GroupType, "${bridge.group.linesField}"${driver})`
        : `Sheet.Types.DraftContext(RowType${driver})`;
}

/** A short description of an East type for a refusal message. */
function describeType(t: EastType): string {
    const payload = optionPayload(t);
    if (payload !== undefined) return `Option<${describeType(payload)}>`;
    if (t.type === "Struct") return `{ ${Object.entries(t.fields as Record<string, EastType>).map(([k, f]) => `${k}: ${describeType(f)}`).join(", ")} }`;
    if (t.type === "Array") return `Array<${describeType(t.value)}>`;
    return t.type;
}

/**
 * Wrap a fill provider — `Sheet.Types.DraftContext(R, D)` → `Option<Fill(T)>` —
 * into the wire provider variant (sync or async by the function's type).
 */
export function wrapProvider(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetProviderType> {
    const fillType = StructType({ value: meta.payloadType, meta: StringType });
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" fill provider #${index + 1}`, OptionType(fillType));
    const body = ($: BlockBuilder<OptionType<SheetFillType>>, ctx: ExprType<SheetContextType>): ExprType<OptionType<SheetFillType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<StructType<{ value: EastType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).match({
            none: (_$) => East.value(none, OptionType(SheetFillType)),
            some: (_$, f) => East.value(some({ value: cellOfPayload(meta.cellTag, f.value as ExprType<EastType>), meta: f.meta }), OptionType(SheetFillType)),
        }) as ExprType<OptionType<SheetFillType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], OptionType(SheetFillType), body)
        : East.function([SheetContextType], OptionType(SheetFillType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProviderType>, SheetProviderType);
}

/**
 * Wrap a row proposer — `Sheet.Types.DraftContext(R, D)` → `Array<Proposal(R)>` —
 * into the wire proposer variant.
 */
export function wrapProposer(bridge: SheetBridge, fn: unknown, index: number): ExprType<SheetProposerType> {
    const { fn: author, async } = pinProvider(bridge, fn, `suggest.propose #${index + 1}`, ArrayType(bridge.proposalType));
    const body = ($: BlockBuilder<ArrayType<SheetProposalType>>, ctx: ExprType<SheetContextType>): ExprType<ArrayType<SheetProposalType>> => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], ArrayType<StructType<{ patch: StructType; meta: StringType }>>>>);
        const bc = $.const(bridge.bridgeCtx);
        const enc = $.const(bridge.encodePatch);
        const typed = $.let(bc(ctx), bridge.ctxType);
        return a(typed).map((_$, p) => East.value({ cells: enc(p.patch), meta: p.meta }, SheetProposalType)) as unknown as ExprType<ArrayType<SheetProposalType>>;
    };
    const wire = async
        ? East.asyncFunction([SheetContextType], ArrayType(SheetProposalType), body)
        : East.function([SheetContextType], ArrayType(SheetProposalType), body);
    return East.value(variant(async ? "async" : "sync", wire) as unknown as SubtypeExprOrValue<SheetProposerType>, SheetProposerType);
}

/** Wrap an arity rule — `Sheet.Types.DraftContext(R, D)` → `Option<Counted>`. */
export function wrapArity(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetContextType], OptionType<SheetCountedType>>> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" arity rule`, OptionType(SheetCountedType));
    if (async) throw new Error(`Sheet: column "${meta.key}" arity rule must be synchronous — the strip reads it while the half is edited`);
    return East.function([SheetContextType], OptionType(SheetCountedType), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<SheetCountedType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(bc(ctx));
    });
}

/**
 * Wrap an options rule (#844) — `Sheet.Types.DraftContext(R, D)` →
 * `Option<Array<String>>` — into the wire rule. Synchronous: the menu reads
 * it as the cell opens.
 */
export function wrapOptions(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<SheetOptionsRuleType> {
    const { fn: author, async } = pinProvider(bridge, fn, `column "${meta.key}" options rule`, OptionType(ArrayType(StringType)));
    if (async) throw new Error(`Sheet: column "${meta.key}" options rule must be synchronous — the menu reads it as the cell opens`);
    return East.function([SheetContextType], OptionType(ArrayType(StringType)), ($, ctx) => {
        const a = $.const(author as unknown as ExprType<FunctionType<[StructType], OptionType<ArrayType<StringType>>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(bc(ctx));
    });
}

/** Wrap an author member check — `Sheet.Types.CheckContext(R)` → `Option<String>` — into the `custom` check arm. */
export function wrapCheck(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown, index: number): ExprType<SheetCheckType> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    if (t.type !== "Function" || (t.inputs ?? []).length !== 1 || !isTypeEqual(t.inputs![0]!, bridge.checkCtxType) ||
        t.output === undefined || !isTypeEqual(t.output, OptionType(StringType))) {
        const spelt = bridge.group !== undefined ? `Sheet.Types.CheckContext(GroupType, "${bridge.group.linesField}")` : "Sheet.Types.CheckContext(RowType)";
        throw new Error(`Sheet: column "${meta.key}" check #${index + 1} must be an East.function over ${spelt} returning Option<String>`);
    }
    const groupHalf = bridge.group;
    const field = groupHalf?.linesField;
    const entryDraft = SheetDraftEntryTypeFor(bridge.rowType, field) as EastType;
    const draftType = (groupHalf === undefined ? entryDraft : SheetDraftGroupTypeFor(groupHalf.groupType, groupHalf.linesField)) as StructType;
    const rowDraft = SheetDraftTypeFor(bridge.lineType) as StructType;
    const base = buildDraftBase(bridge.rowType, field, bridge.rowById);
    const wire = East.function([SheetCheckContextType], OptionType(StringType), ($, c) => {
        const a = $.const(expr as ExprType<FunctionType<[StructType], OptionType<StringType>>>);
        const read = $.const(base);
        const dec = $.const(bridge.draftRow);
        const original = $.const(read(c.drafts, c.rowId, c.offset), OptionType(entryDraft));
        if (field === undefined || groupHalf === undefined) {
            const row = $.const(dec(c.rowId, c.row, original as ExprType<OptionType<StructType>>));
            return a($.const({ rowIndex: c.rowIndex, row, group: none, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        }
        const decGroup = $.const(groupHalf.decodeGroup);
        /** A line's check: the line over its prior draft in its group, the group decoded over the wire group row. */
        const lineCheck = ($2: BlockBuilder<EastType>, own: ExprType<OptionType<StructType>>) => {
            const group = $2.const(c.group.match({
                none: () => own,
                some: (_$, wire) => some(decGroup(wire, own, some(wire))),
            }), OptionType(draftType));
            const prior = $2.const(group.match({
                none: () => none,
                some: (_$, value) => {
                    const children = value[field] as ExprType<ArrayType<StructType>>;
                    return c.rowIndex.greaterEqual(0n).and(() => c.rowIndex.less(children.size())).ifElse(() => some(children.get(c.rowIndex)), () => none);
                },
            }), OptionType(rowDraft));
            const row = $2.const(dec("", c.row, prior));
            return a($2.const({ rowIndex: c.rowIndex, row, group, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
        };
        const decLoose = groupHalf.decodeLoose;
        if (decLoose === undefined) return lineCheck($ as unknown as BlockBuilder<EastType>, original as ExprType<OptionType<StructType>>);
        // A source with loose rows (#846): the entry's arms. A loose row has
        // no line address — its own cells over its own draft, and no group.
        const entry = original as unknown as ExprType<OptionType<SheetEntryVariant>>;
        const decodeLoose = $.const(decLoose);
        return c.line.match({
            some: ($2) => {
                const own = $2.const(entry.match({ none: () => none, some: (_$, e) => e.match({ group: (_$3, g) => some(g), row: () => none }) }), OptionType(draftType));
                return lineCheck($2 as unknown as BlockBuilder<EastType>, own);
            },
            none: ($2) => {
                const own = $2.const(entry.match({ none: () => none, some: (_$, e) => e.match({ row: (_$3, r) => some(r), group: () => none }) }), OptionType(rowDraft));
                const row = $2.const(decodeLoose(c.rowId, c.row, own));
                return a($2.const({ rowIndex: c.rowIndex, row, group: none, half: c.half, member: c.member } as SubtypeExprOrValue<StructType>, bridge.checkCtxType));
            },
        });
    });
    return East.value(variant("custom", wire) as unknown as SubtypeExprOrValue<SheetCheckType>, SheetCheckType);
}

/** Wrap a custom kind's `parse` — `(text, Context(R, D))` → `Option<P>` — into the wire parse. */
export function wrapCustomParse(bridge: SheetBridge, meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[StringType, SheetContextType], OptionType<SheetCellType>>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 2 || !isTypeEqual(inputs[0]!, StringType) || !isTypeEqual(inputs[1]!, bridge.ctxType)) {
        throw new Error(`Sheet: custom column "${meta.key}" \`parse\` must be an East.function over (String, ${contextName(bridge)}) returning Option<payload>`);
    }
    return East.function([StringType, SheetContextType], OptionType(SheetCellType), ($, text, ctx) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[StringType, StructType], OptionType<EastType>>>);
        const bc = $.const(bridge.bridgeCtx);
        return a(text, bc(ctx)).match({
            none: (_$) => East.value(none, OptionType(SheetCellType)),
            some: (_$, v) => East.value(some(cellOfPayload(meta.cellTag, v as ExprType<EastType>)), OptionType(SheetCellType)),
        });
    });
}

/** Wrap a custom kind's `print` — `P` → `String` — into the wire print. */
export function wrapCustomPrint(meta: SheetColumnMeta, fn: unknown): ExprType<FunctionType<[SheetCellType], StringType>> {
    const expr = East.value(fn as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    const t = typeOf(expr) as { type: string; inputs?: EastType[]; output?: EastType };
    const inputs = t.inputs ?? [];
    if (t.type !== "Function" || inputs.length !== 1 || !isTypeEqual(inputs[0]!, meta.payloadType) ||
        t.output === undefined || !isTypeEqual(t.output, StringType)) {
        throw new Error(`Sheet: custom column "${meta.key}" \`print\` must be an East.function over the payload (${describeType(meta.payloadType)}) returning String`);
    }
    return East.function([SheetCellType], StringType, ($, cell) => {
        const a = $.const(expr as unknown as ExprType<FunctionType<[EastType], StringType>>);
        return cell.match(
            { [meta.cellTag]: (_$: unknown, v: ExprType<EastType>) => a(v) } as never,
            (_$: unknown) => East.value("", StringType),
        ) as ExprType<StringType>;
    });
}

/** Re-exported for the root's driver-typed refusals. */
export { SheetHalfType, BooleanType, AsyncFunctionType, EMPTY_LINK };
