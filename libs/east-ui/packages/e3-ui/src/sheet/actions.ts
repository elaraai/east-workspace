/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Sheet.column.action` — a variant's state machine as a column (#1474,
 * `Sheet Actions - DX Proposal.md`).
 *
 * The column sits on a field of type `V` or `Option<V>`, `V` a variant. Each
 * case of `V` is a state and the action that gets a row there: the author
 * gives its words, the cases it may go to next (`next`, and `start` for a
 * row with nothing taken), and what else taking it updates. The case's type
 * decides how it is asked: `NullType` is a button, a variant whose every case
 * is `NullType` a menu of those cases, anything else a form drawn with
 * `Fields` — the inspectors' vocabulary. One optional function, `blocked`,
 * says when a row cannot act for a reason the table cannot hold (a step
 * waiting for the one before it).
 *
 * The builder only captures. {@link describeAction} checks the declaration
 * against the row type at build time; {@link buildActionKind} compiles it into
 * the closed wire kind over the sheet's bridge; {@link buildActionCodec} is the
 * cell a row's case lands in.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    BlobType,
    DateTimeType,
    DictType,
    East,
    Expr,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    none,
    some,
    toEastTypeValue,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { StatusValueType, type StatusValueLiteral } from "@elaraai/east-ui";
import {
    FIELD_HINT,
    fieldSelect,
    fieldSpecs,
    resolveTag,
    spellOut,
    type FieldHint,
    type FieldHints,
    type FieldSpecValue,
} from "@elaraai/east-ui/internal";
import {
    SheetActionCaseType,
    SheetActionCellType,
    SheetActionGateType,
    SheetActionKindType,
    SheetActionTakeType,
    SheetActionUpdatesType,
    SheetCellType,
    SheetContextType,
    sheetLinesOf,
    sheetRuleCell,
    SheetPatchTypeFor,
    type SheetPatchOf,
    type SheetLinesField,
    type SheetLineOf,
} from "./types.js";
import { SheetDraftTypeFor } from "./transactions.js";
import { SheetDraftGroupTypeFor } from "./drafts.js";
import type { SheetColumn } from "./columns.js";
import type { SheetBridge, SheetColumnMeta, SheetRuleCellMeta } from "./bridge.js";
import type { SheetRegisterValue } from "./registers.js";

// ============================================================================
// The context `blocked`, `initial` and `updates` see
// ============================================================================

/**
 * `Sheet.Types.ActionContext(R)` — what an action column's functions see on
 * a flat sheet: the row as plain values, never a draft — a row whose draft
 * is incomplete never acts (T6) — and its neighbours, each `none` while its
 * own draft is incomplete.
 *
 * @typeParam R - The row type
 * @param rowType - The row type value
 * @returns The context type
 *
 * @property row - The row, as it stands before the action
 * @property index - Its place among the rows
 * @property rows - The resident rows, in order; `none` where a row's draft is incomplete
 * @property group - Always `none` on a flat sheet
 * @property today - UTC midnight
 */
export function SheetActionContextTypeFor<R extends StructType>(rowType: R): SheetActionContextOf<R> {
    return StructType({
        row: rowType,
        index: IntegerType,
        rows: ArrayType(OptionType(rowType)),
        group: OptionType(NullType),
        today: DateTimeType,
    }) as unknown as SheetActionContextOf<R>;
}

/**
 * `Sheet.Types.ActionContext(P, "lines")` — what an action column's
 * functions see on a grouped sheet: the line as plain values, its group's
 * lines, and the group.
 *
 * @typeParam P - The group type
 * @typeParam F - The lines field
 * @param groupType - The group type value
 * @param lines - The lines field
 * @returns The context type
 *
 * @property row - The line, as it stands before the action
 * @property index - Its place among its group's lines
 * @property rows - Its group's lines, in order; `none` where a line's draft is incomplete
 * @property group - Its group; `none` while the group's own draft is incomplete, and for a loose row
 * @property today - UTC midnight
 */
export function SheetGroupActionContextTypeFor<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F): SheetActionContextOf<SheetLineOf<P, F>> {
    const { lineType } = sheetLinesOf(groupType, lines);
    return StructType({
        row: lineType,
        index: IntegerType,
        rows: ArrayType(OptionType(lineType)),
        group: OptionType(groupType),
        today: DateTimeType,
    }) as unknown as SheetActionContextOf<SheetLineOf<P, F>>;
}

/**
 * The TS type of an action context over the row type `R` — on a grouped
 * sheet `R` is the line, and `group` the group.
 *
 * @typeParam R - The row type (a grouped sheet's line)
 */
export type SheetActionContextOf<R extends StructType> = StructType<{
    row: R;
    index: IntegerType;
    rows: ArrayType<OptionType<R>>;
    group: OptionType<StructType>;
    today: DateTimeType;
}>;

/**
 * `Sheet.Types.ActionContext` — `ActionContext(R)` on a flat sheet,
 * `ActionContext(P, "lines")` on a grouped one.
 */
export function sheetActionContextType<R extends StructType>(rowType: R): SheetActionContextOf<R>;
export function sheetActionContextType<P extends StructType, F extends SheetLinesField<P>>(groupType: P, lines: F): SheetActionContextOf<SheetLineOf<P, F>>;
export function sheetActionContextType(first: StructType, second?: string): unknown {
    return second === undefined ? SheetActionContextTypeFor(first) : SheetGroupActionContextTypeFor(first, second as never);
}

// ============================================================================
// The author's declaration
// ============================================================================

/** The cases of a variant, by name. */
export type SheetActionCaseOf<V extends VariantType> = Extract<keyof V["cases"], string>;

/** Whether every case of a variant's cases is `NullType` — what a menu chooses among. */
type IsChoice<C> = [C[keyof C]] extends [NullType] ? true : false;

/**
 * A case's menu (`Sheet.action.menu({ labels })`): a variant whose every case
 * is `NullType`, each case a choice, the labelled ones first.
 *
 * @typeParam C - The cases it labels
 */
export interface SheetActionMenu<C extends string> {
    /** The take's kind. */
    readonly [FIELD_HINT]: "action-menu";
    /** The words for a case, where its name spelled out will not do. */
    readonly labels?: { readonly [K in C]?: string };
}

/** A case's menu of a register's members (`Sheet.action.menu({ of })`), its value a `String`: the chosen member's key. */
export interface SheetActionRegisterMenu {
    /** The take's kind. */
    readonly [FIELD_HINT]: "action-register";
    /** The register's name — one of the sheet's `registers`. */
    readonly of: string;
}

/**
 * A case's form (`Sheet.action.form({ fields, initial })`): its value's
 * fields, through the inspectors' hints.
 *
 * @typeParam R - The row type
 * @typeParam T - The case's value type
 */
export interface SheetActionForm<R extends StructType, T extends EastType> {
    /** The take's kind. */
    readonly [FIELD_HINT]: "action-form";
    /** `Sheet.field.*` — one hint for a value that is no struct, a hint per field for a struct. */
    readonly fields?: T extends StructType ? FieldHints<T["fields"]> : FieldHint<T>;
    /** What the form opens with (F10); without it, the row's own value of this case, else empty. */
    readonly initial?: (ctx: ExprType<SheetActionContextOf<R>>) => SubtypeExprOrValue<T>;
}

/**
 * How a case of type `T` may be asked for: a `NullType` case is always a
 * button; a variant of `NullType` cases a menu or a form; a `String` a
 * register's menu or a form; anything else a form.
 *
 * @typeParam R - The row type
 * @typeParam T - The case's value type
 */
export type SheetActionTake<R extends StructType, T extends EastType> =
    T extends NullType ? never
    : T extends VariantType<infer C> ? (IsChoice<C> extends true ? SheetActionMenu<Extract<keyof C, string>> | SheetActionForm<R, T> : SheetActionForm<R, T>)
    : T extends StringType ? SheetActionRegisterMenu | SheetActionForm<R, T>
    : SheetActionForm<R, T>;

/**
 * What taking a case updates beside its own field: a patch of the row and,
 * on a grouped sheet, of its group — `Sheet.patch`, as `newRow` and templates
 * build them. A field a patch leaves out is left as it is.
 *
 * @typeParam R - The row type
 */
export interface SheetUpdatesInput<R extends StructType> {
    /** The row's patch. */
    row?: SubtypeExprOrValue<SheetPatchOf<R>>;
    /** The group's patch — a grouped sheet's only. */
    group?: SubtypeExprOrValue<StructType>;
}

/**
 * One case of an action column: a state, and the action into it.
 *
 * @typeParam R - The row type
 * @typeParam V - The variant
 * @typeParam T - The case's value type
 */
export interface SheetActionCase<R extends StructType, V extends VariantType, T extends EastType> {
    /** The verb on the control — "Complete". */
    label: SubtypeExprOrValue<StringType>;
    /** The word once taken — "Completed". */
    state: SubtypeExprOrValue<StringType>;
    /** The state's tone (S6); neutral when left out. */
    tone?: StatusValueLiteral;
    /** A Font Awesome solid icon by name — "check", "pause" (S13). */
    icon?: string;
    /** The cases a row in this state may go to, in the order they are offered; left out, a final state. */
    next?: readonly SheetActionCaseOf<V>[];
    /** How it is asked for, where its type alone does not say. */
    take?: SheetActionTake<R, T>;
    /** What follows the state word (S7), over the case's value and the row. */
    summary?: (value: ExprType<T>, row: ExprType<R>) => SubtypeExprOrValue<StringType | OptionType<StringType>>;
    /** What else taking it updates: the case's value (what was entered), the row's context before, and the moment. */
    updates?: (value: ExprType<T>, ctx: ExprType<SheetActionContextOf<R>>, at: ExprType<DateTimeType>) => SheetUpdatesInput<R>;
}

/**
 * Config for `Sheet.column.action(R, V, config)`.
 *
 * @typeParam R - The row type (a grouped sheet's line)
 * @typeParam V - The variant
 */
export interface SheetActionConfig<R extends StructType, V extends VariantType> {
    /** The header line. */
    header?: SubtypeExprOrValue<StringType>;
    /** The grey second header line. */
    sub?: SubtypeExprOrValue<StringType>;
    /** CSS width (`"304px"`). */
    width?: SubtypeExprOrValue<StringType>;
    /** `false` shows the state alone, no controls (T9). */
    editable?: boolean;
    /** What a row with nothing taken may do — an `Option<V>` field's only. */
    start?: readonly SheetActionCaseOf<V>[];
    /** Every case of `V`, and no other; the record's order is the order they read in. */
    cases: { [C in SheetActionCaseOf<V>]: SheetActionCase<R, V, V["cases"][C]> };
    /** Why the row cannot act now, over its context; `none` when it can. */
    blocked?: (ctx: ExprType<SheetActionContextOf<R>>) => SubtypeExprOrValue<OptionType<StringType>>;
    /** How menus, forms and the strip name the row — `"step 20"`; left out, by its number. */
    name?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    /** The row's words beside its name — `"Weld frame"`. */
    title?: (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
}

/** An action column's config, erased — what the built column carries. @internal */
export type SheetAnyActionConfig = Omit<SheetActionConfig<StructType, VariantType>, "cases"> & {
    cases: Record<string, SheetAnyActionCase>;
};

/** One case's config, erased. @internal */
export interface SheetAnyActionCase {
    label: SubtypeExprOrValue<StringType>;
    state: SubtypeExprOrValue<StringType>;
    tone?: StatusValueLiteral;
    icon?: string;
    next?: readonly string[];
    take?: { readonly [FIELD_HINT]: string; readonly labels?: Readonly<Record<string, string | undefined>>; readonly of?: string; readonly fields?: unknown; readonly initial?: (ctx: ExprType<StructType>) => unknown };
    summary?: (value: ExprType<EastType>, row: ExprType<StructType>) => unknown;
    updates?: (value: ExprType<EastType>, ctx: ExprType<StructType>, at: ExprType<DateTimeType>) => { row?: unknown; group?: unknown };
}

/**
 * A case's menu of a variant's cases, each `NullType` — `Sheet.action.menu({ labels })`.
 *
 * @typeParam C - The cases it labels
 * @param options - The words for the cases whose names, spelled out, will not do
 * @returns The take
 */
export function actionMenu<C extends string = never>(options?: { readonly labels?: { readonly [K in C]?: string } }): SheetActionMenu<C>;
/**
 * A case's menu of a register's members — `Sheet.action.menu({ of: "crews" })`.
 *
 * @param options - The register's name
 * @returns The take
 */
export function actionMenu(options: { readonly of: string }): SheetActionRegisterMenu;
export function actionMenu(options: { readonly labels?: Readonly<Record<string, string | undefined>>; readonly of?: string } = {}): SheetActionMenu<string> | SheetActionRegisterMenu {
    if (options.of !== undefined) return { [FIELD_HINT]: "action-register", of: options.of };
    return { ...(options.labels !== undefined ? { labels: options.labels as Readonly<Record<string, string>> } : {}), [FIELD_HINT]: "action-menu" };
}

/**
 * A case's form — `Sheet.action.form({ fields, initial })`: its value's
 * fields through `Sheet.field.*`, and what it opens with.
 *
 * @typeParam R - The row type
 * @typeParam T - The case's value type
 * @param options - The fields' hints and the opening value
 * @returns The take
 */
export function actionForm<R extends StructType, T extends EastType>(options: Omit<SheetActionForm<R, T>, typeof FIELD_HINT> = {}): SheetActionForm<R, T> {
    return { ...options, [FIELD_HINT]: "action-form" } as SheetActionForm<R, T>;
}

/**
 * An action column — `Sheet.column.action(R, V, config)`: a variant's state
 * machine, each case a state and the action into it. Sits on a `V` or
 * `Option<V>` field.
 *
 * @typeParam R - The row type (a grouped sheet's line)
 * @typeParam V - The variant
 * @param rowType - The row type value
 * @param variantType - The variant the field holds
 * @param config - The cases, `start`, `blocked` and the column's words ({@link SheetActionConfig})
 * @returns The column
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { DictType, East, NullType, OptionType, StringType, StructType, VariantType, none, some, variant } from "@elaraai/east";
 * import { Box, Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Record, Sheet } from "@elaraai/e3-ui";
 * import e3 from "@elaraai/e3";
 *
 * export const JobState = VariantType({ started: NullType, finished: NullType });
 * export const ActionJob = StructType({ task: StringType, state: OptionType(JobState) });
 * export const sheetActionJobs = e3.record("sheet_action_jobs", DictType(StringType, ActionJob), {
 *     initial: new Map([
 *         ["J-0001", { task: "Panel cutting", state: some(variant("finished", null)) }],
 *         ["J-0002", { task: "Edge banding", state: some(variant("started", null)) }],
 *         ["J-0003", { task: "CNC routing", state: none }],
 *     ]),
 *     mutations: (mutation) => ({
 *         // The jobs' patch door — every Save commits through it.
 *         patch: mutation.patch(),
 *     }),
 * });
 *
 * const sheet = East.function([], UIComponentType, (_$) => (
 *     <Reactive>{$ => {
 *         const jobs = $.let(Record.bind(sheetActionJobs));
 *         return (
 *             <Box height="320px">
 *                 <Sheet
 *                     record={jobs}
 *                     name="sheetActionsBasic"
 *                     columns={{
 *                         task: Sheet.column.text(ActionJob, { header: "Task", width: "240px" }),
 *                         state: Sheet.column.action(ActionJob, JobState, {
 *                             header: "State", width: "240px",
 *                             start: ["started"],
 *                             cases: {
 *                                 started: { label: "Start", state: "Started", tone: "info", icon: "play", next: ["finished"] },
 *                                 finished: { label: "Finish", state: "Finished", tone: "success", icon: "check" },
 *                             },
 *                         }),
 *                     }}
 *                 />
 *             </Box>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 */
export function action<R extends StructType, V extends VariantType>(rowType: R, variantType: V, config: SheetActionConfig<R, V>): SheetColumn<R, V | OptionType<V>> {
    return { kind: "action", config: config as never, rowType, variantType } as SheetColumn<R, V | OptionType<V>>;
}

// ============================================================================
// Build time: the declaration checked, the cell's codec, the rule cells
// ============================================================================

/** The compiled codec of an action column's cell. @internal */
export interface SheetActionCodec {
    /** The variant. */
    variantType: VariantType;
    /** `V` → its cell. */
    encode: ExprType<FunctionType<[VariantType], SheetCellType>>;
    /** An `Action` cell's payload → its value, `none` for a case the variant does not have. */
    decode: ExprType<FunctionType<[SheetActionCellType], OptionType<VariantType>>>;
}

/**
 * Compiles an action column's cell codec: a value of `V` to its `Action`
 * cell (its case and its value, beast2 at the case's type), and back.
 *
 * @param variantType - The variant
 * @returns The codec
 * @internal
 */
export function buildActionCodec(variantType: VariantType): SheetActionCodec {
    const cases = Object.entries(variantType.cases as Record<string, EastType>);
    const encode = East.function([variantType], SheetCellType, (_$, v) => v.match(Object.fromEntries(cases.map(([name]) => [name,
        (_$2: unknown, value: ExprType<EastType>) => East.value(variant("Action", { case: name, value: East.Blob.encodeBeast(value, "v2") }), SheetCellType),
    ])) as never) as ExprType<SheetCellType>) as unknown as SheetActionCodec["encode"];
    const decode = East.function([SheetActionCellType], OptionType(variantType), ($, cell) => {
        for (const [name, type] of cases) {
            $.if(cell.case.equal(name), ($2) => {
                $2.return(East.value(some(variant(name, cell.value.decodeBeast(type, "v2"))) as never, OptionType(variantType)));
            });
        }
        return East.value(none, OptionType(variantType));
    }) as unknown as SheetActionCodec["decode"];
    return { variantType, encode, decode };
}

/** A short description of a type, for a refusal. */
function describeType(type: EastType): string {
    return type.type === "Struct" ? `a struct` : type.type === "Variant" ? "a variant" : `a ${type.type}`;
}

/** Whether a type is a variant whose every case is `NullType`. */
function isChoice(type: EastType): type is VariantType {
    if (type.type !== "Variant") return false;
    const cases = Object.values(type.cases as Record<string, EastType>);
    return cases.length > 0 && cases.every((t) => isTypeEqual(t, NullType));
}

/**
 * Checks an action column's declaration against its field: the field is `V`
 * or `Option<V>`; `cases` names every case of `V` and no other; `start` and
 * each `next` name cases of `V`, once each; `start` sits only on an
 * `Option<V>` field; no `fill` or `value`.
 *
 * @param key - The column key
 * @param col - The built column
 * @param fieldType - The field's type
 * @param optional - Whether the field is an `Option` of `V`
 * @throws Error naming the column and the case
 * @internal
 */
export function describeAction(key: string, col: SheetColumn<StructType, EastType>, fieldType: EastType, optional: boolean): void {
    const variantType = col.variantType;
    const where = `Sheet: action column "${key}"`;
    if (variantType === undefined || variantType.type !== "Variant") {
        throw new Error(`${where} names no variant — Sheet.column.action(RowType, VariantType, { … })`);
    }
    const unwrapped = optional ? (fieldType as { cases: Record<string, EastType> }).cases["some"]! : fieldType;
    if (!isTypeEqual(unwrapped, variantType)) {
        throw new Error(`${where} sits on ${describeType(fieldType)} field — it sits on a field of its variant, or an Option of it`);
    }
    const cfg = col.config as unknown as SheetAnyActionConfig & { fill?: unknown; value?: unknown };
    if (cfg.fill !== undefined) throw new Error(`${where} takes no \`fill\` — an action is taken, never filled`);
    if (cfg.value !== undefined) throw new Error(`${where} takes no \`value\` — it shows the field its actions write`);
    const names = Object.keys(variantType.cases as Record<string, EastType>);
    const declared = Object.keys(cfg.cases ?? {});
    const missing = names.filter((n) => !declared.includes(n));
    const stray = declared.filter((n) => !names.includes(n));
    if (missing.length > 0) throw new Error(`${where} declares no case for ${missing.map((n) => `"${n}"`).join(", ")} — \`cases\` gives every case of the variant its words`);
    if (stray.length > 0) throw new Error(`${where} declares ${stray.map((n) => `"${n}"`).join(", ")}, ${stray.length === 1 ? "a case" : "cases"} the variant does not have (${names.join(", ")})`);
    const checkList = (list: readonly string[] | undefined, what: string) => {
        if (list === undefined) return;
        const seen = new Set<string>();
        for (const n of list) {
            if (!names.includes(n)) throw new Error(`${where}'s ${what} names "${n}", a case the variant does not have (${names.join(", ")})`);
            if (seen.has(n)) throw new Error(`${where}'s ${what} names "${n}" twice — each case is offered once`);
            seen.add(n);
        }
    };
    if (cfg.start !== undefined && !optional) {
        throw new Error(`${where} has a \`start\`, and its field is always in a case — \`start\` is what a row with nothing taken may do, on an Option field; a new row's first case is \`newRow\`'s`);
    }
    checkList(cfg.start, "`start`");
    for (const n of names) checkList(cfg.cases[n]!.next, `case "${n}"'s \`next\``);
}

/**
 * The rule cells an action column projects: the row's summary, and its name
 * and title where the column gives them.
 *
 * @param key - The column key
 * @param col - The built column
 * @param rowType - The row type (a grouped sheet's line)
 * @returns The rule cells
 * @throws Error naming the case whose summary does not return String or Option<String>
 * @internal
 */
export function actionRuleCells(key: string, col: SheetColumn<StructType, EastType>, rowType: StructType): SheetRuleCellMeta[] {
    const cfg = col.config as unknown as SheetAnyActionConfig;
    const variantType = col.variantType!;
    const fieldType = (rowType.fields as Record<string, EastType>)[key]!;
    const optional = !isTypeEqual(fieldType, variantType);
    const cases = Object.entries(variantType.cases as Record<string, EastType>);
    const summaries = new Map<string, { fn: ExprType<FunctionType>; optional: boolean }>();
    for (const [name, type] of cases) {
        const summary = cfg.cases[name]!.summary;
        if (summary === undefined) continue;
        const fn = East.function([type, rowType], undefined, (_$, v, r) => summary(v, r) as SubtypeExprOrValue<EastType>) as unknown as ExprType<FunctionType>;
        const out = (Expr.type(fn as never) as FunctionType).output as EastType;
        const asOption = isTypeEqual(out, OptionType(StringType));
        if (!asOption && !isTypeEqual(out, StringType)) {
            throw new Error(`Sheet: action column "${key}" case "${name}" has a \`summary\` returning ${describeType(out)} — it returns String or Option<String>`);
        }
        summaries.set(name, { fn, optional: asOption });
    }
    const summary = East.function([rowType], StringType, ($, r) => {
        const bound = new Map([...summaries].map(([name, s]) => [name, { fn: $.const(s.fn as ExprType<FunctionType<[EastType, StructType], EastType>>), optional: s.optional }]));
        const ofValue = (v: ExprType<VariantType>): ExprType<StringType> => v.match(Object.fromEntries(cases.map(([name]) => [name, (_$2: unknown, value: ExprType<EastType>) => {
            const s = bound.get(name);
            if (s === undefined) return East.value("", StringType);
            const out = s.fn(value, r);
            return s.optional ? (out as unknown as ExprType<OptionType<StringType>>).match({ some: (_$3, text) => text, none: () => "" }) : out;
        }])) as never) as ExprType<StringType>;
        const field = (r as unknown as Record<string, ExprType<EastType>>)[key]!;
        return optional
            ? (field as unknown as ExprType<OptionType<VariantType>>).match({ some: (_$2, v) => ofValue(v), none: () => "" })
            : ofValue(field as unknown as ExprType<VariantType>);
    }) as unknown as SheetRuleCellMeta["fn"];
    const out: SheetRuleCellMeta[] = [{ key: sheetRuleCell("summary", key), fn: summary, tag: "String", optional: false }];
    if (cfg.name !== undefined) {
        const name = cfg.name;
        out.push({ key: sheetRuleCell("name", key), fn: East.function([rowType], StringType, (_$, r) => name(r)) as unknown as SheetRuleCellMeta["fn"], tag: "String", optional: false });
    }
    if (cfg.title !== undefined) {
        const title = cfg.title;
        out.push({ key: sheetRuleCell("title", key), fn: East.function([rowType], StringType, (_$, r) => title(r)) as unknown as SheetRuleCellMeta["fn"], tag: "String", optional: false });
    }
    return out;
}

// ============================================================================
// The wire kind
// ============================================================================

/** Whether a type is `Option<T>`. */
function optionOf(type: EastType): EastType | undefined {
    if (type.type !== "Variant") return undefined;
    const cases = type.cases as Record<string, EastType>;
    const keys = Object.keys(cases);
    return keys.length === 2 && cases["none"] !== undefined && cases["some"] !== undefined && isTypeEqual(type, OptionType(cases["some"])) ? cases["some"] : undefined;
}

/**
 * A draft → the value it stands for, `none` while a field it needs is missing
 * or unread: an `Option` field missing is `none`.
 */
function buildComplete(rowType: StructType): ExprType<FunctionType<[StructType], OptionType<StructType>>> {
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const fields = Object.entries(rowType.fields as Record<string, EastType>);
    return East.function([draftType], OptionType(rowType), ($, d) => {
        const draft = d as unknown as Record<string, ExprType<VariantType>>;
        const out: Record<string, unknown> = {};
        for (const [name, type] of fields) {
            const field = $.const(draft[name]!);
            $.if(field.hasTag("invalid"), ($2) => { $2.return(East.value(none, OptionType(rowType))); });
            if (optionOf(type) !== undefined) {
                out[name] = $.const(field.match({ value: (_$2: unknown, v: ExprType<EastType>) => v } as never, () => East.value(none as never, type)) as ExprType<EastType>, type);
            } else {
                $.if(field.hasTag("missing"), ($2) => { $2.return(East.value(none, OptionType(rowType))); });
                out[name] = $.const(field.unwrap("value" as never) as ExprType<EastType>, type);
            }
        }
        return East.value(some(out as never), OptionType(rowType));
    }) as unknown as ExprType<FunctionType<[StructType], OptionType<StructType>>>;
}

/** A group's draft → the group it stands for, `none` while its own fields or any line is incomplete. */
function buildCompleteGroup(groupType: StructType, linesField: string, completeLine: ExprType<FunctionType<[StructType], OptionType<StructType>>>): ExprType<FunctionType<[StructType], OptionType<StructType>>> {
    const draftType = SheetDraftGroupTypeFor(groupType, linesField as never) as StructType;
    const lineType = sheetLinesOf(groupType, linesField).lineType;
    const fields = Object.entries(groupType.fields as Record<string, EastType>);
    return East.function([draftType], OptionType(groupType), ($, d) => {
        const draft = d as unknown as Record<string, ExprType<EastType>>;
        const line = $.const(completeLine);
        const out: Record<string, unknown> = {};
        for (const [name, type] of fields) {
            if (name === linesField) {
                const lines = $.const((draft[name] as ExprType<ArrayType<StructType>>).map((_$2, l) => line(l)), ArrayType(OptionType(lineType)));
                $.if(lines.some((_$2, l) => l.hasTag("none")), ($2) => { $2.return(East.value(none, OptionType(groupType))); });
                out[name] = $.const(lines.map((_$2, l) => l.unwrap("some")), ArrayType(lineType));
                continue;
            }
            const field = $.const(draft[name] as ExprType<VariantType>);
            $.if(field.hasTag("invalid"), ($2) => { $2.return(East.value(none, OptionType(groupType))); });
            if (optionOf(type) !== undefined) {
                out[name] = $.const(field.match({ value: (_$2: unknown, v: ExprType<EastType>) => v } as never, () => East.value(none as never, type)) as ExprType<EastType>, type);
            } else {
                $.if(field.hasTag("missing"), ($2) => { $2.return(East.value(none, OptionType(groupType))); });
                out[name] = $.const(field.unwrap("value" as never) as ExprType<EastType>, type);
            }
        }
        return East.value(some(out as never), OptionType(groupType));
    }) as unknown as ExprType<FunctionType<[StructType], OptionType<StructType>>>;
}

/** A draft → the labels of the fields an action waits on: a required field missing, any field unread. */
function buildMissing(rowType: StructType, labels: ReadonlyMap<string, SubtypeExprOrValue<StringType>>): ExprType<FunctionType<[StructType], ArrayType<StringType>>> {
    const draftType = SheetDraftTypeFor(rowType) as StructType;
    const fields = Object.entries(rowType.fields as Record<string, EastType>);
    return East.function([draftType], ArrayType(StringType), ($, d) => {
        const draft = d as unknown as Record<string, ExprType<VariantType>>;
        const out = $.let([], ArrayType(StringType));
        for (const [name, type] of fields) {
            const field = $.const(draft[name]!);
            const waits = optionOf(type) !== undefined ? field.hasTag("invalid") : field.hasTag("invalid").or(() => field.hasTag("missing"));
            $.if(waits, ($2) => { $2(out.pushLast(East.value(labels.get(name) ?? spellOut(name), StringType))); });
        }
        return out;
    }) as unknown as ExprType<FunctionType<[StructType], ArrayType<StringType>>>;
}

/** What the root hands {@link buildActionKind}. @internal */
export interface SheetActionKindInput {
    /** The column, described. */
    meta: SheetColumnMeta;
    /** The sheet's bridge. */
    bridge: SheetBridge;
    /** Every declared column, described: the labels a waiting row names its missing fields by. */
    metas: readonly SheetColumnMeta[];
    /** The sheet's registers, by name: what a `menu({ of })` or a form's reference names. */
    registers: Record<string, SheetRegisterValue>;
    /** A grouped sheet's band cells, described against the group: what a group patch writes. */
    groupCells?: SheetColumnMeta[] | undefined;
    /** Encodes a group patch into the band's cells. */
    encodeGroup?: ExprType<FunctionType<[StructType], DictType<StringType, SheetCellType>>> | undefined;
}

/**
 * Compiles an action column into its wire kind: the machine as names, each
 * case's take resolved through `Fields`, and `blocked`, each `initial` and
 * each `updates` bridged over the wire context.
 *
 * @param input - The column, the bridge, the registers and the group's encoding ({@link SheetActionKindInput})
 * @returns The column's kind payload
 * @throws Error naming the column and the case: a take that does not fit its case's type, a register the sheet does not declare, a group patch on a flat sheet, or a group patch of another type
 * @internal
 */
export function buildActionKind(input: SheetActionKindInput): ExprType<typeof SheetActionKindType> {
    const { meta, bridge, metas, registers } = input;
    const key = meta.key;
    const where = `Sheet: action column "${key}"`;
    const cfg = meta.config as unknown as SheetAnyActionConfig;
    const variantType = meta.action!.variantType;
    const grouped = bridge.group !== undefined;
    const lineType = bridge.lineType;
    const groupType = bridge.group?.groupType;
    const ctxType = (grouped
        ? SheetGroupActionContextTypeFor(groupType!, bridge.group!.linesField as never)
        : SheetActionContextTypeFor(lineType)) as unknown as StructType;
    const rowPatchType = SheetPatchTypeFor(lineType) as unknown as StructType;
    const groupPatchType = groupType !== undefined ? SheetPatchTypeFor(groupType) as unknown as StructType : undefined;
    const authorUpdatesType = groupPatchType !== undefined
        ? StructType({ row: rowPatchType, group: groupPatchType })
        : StructType({ row: rowPatchType });

    // The draft context → the action context: the row complete, its neighbours each complete or none.
    const completeLine = buildComplete(lineType);
    const completeGroup = grouped ? buildCompleteGroup(groupType!, bridge.group!.linesField, completeLine) : undefined;
    const toContext = East.function([bridge.ctxType], OptionType(ctxType), ($, c) => {
        const ctx = c as unknown as Record<string, ExprType<EastType>>;
        const complete = $.const(completeLine);
        const row = $.const(complete(ctx["row"] as ExprType<StructType>));
        $.if(row.hasTag("none"), ($2) => { $2.return(East.value(none, OptionType(ctxType))); });
        const rows = $.const((ctx["rows"] as ExprType<ArrayType<StructType>>).map((_$2, r) => complete(r)), ArrayType(OptionType(lineType)));
        let group: ExprType<EastType>;
        if (completeGroup !== undefined) {
            const whole = $.const(completeGroup);
            group = $.const((ctx["group"] as unknown as ExprType<OptionType<StructType>>).match({ some: (_$2, g) => whole(g), none: () => East.value(none, OptionType(groupType!)) }), OptionType(groupType!)) as unknown as ExprType<EastType>;
        } else {
            group = $.const(none, OptionType(NullType)) as unknown as ExprType<EastType>;
        }
        return East.value(some({ row: row.unwrap("some"), index: ctx["rowIndex"], rows, group, today: ctx["today"] } as never), OptionType(ctxType));
    });

    // Whether a row may act now: its draft complete, and not `blocked`.
    const labels = new Map(metas.filter((m) => m.config.header !== undefined).map((m) => [m.field, m.config.header as SubtypeExprOrValue<StringType>]));
    const missing = buildMissing(lineType, labels);
    const blockedRule = cfg.blocked;
    const blocked = blockedRule !== undefined
        ? East.function([ctxType], OptionType(StringType), (_$, c) => blockedRule(c as never))
        : undefined;
    const gate = East.function([SheetContextType], SheetActionGateType, ($, wire) => {
        const bridgeCtx = $.const(bridge.bridgeCtx);
        const to = $.const(toContext);
        const typed = $.const(bridgeCtx(wire), bridge.ctxType);
        const ctx = $.const(to(typed));
        $.if(ctx.hasTag("none"), ($2) => {
            const waits = $2.const(missing);
            $2.return(East.value(variant("incomplete", waits((typed as unknown as Record<string, ExprType<StructType>>)["row"]!)), SheetActionGateType));
        });
        if (blocked === undefined) return East.value(variant("open", null), SheetActionGateType);
        const rule = $.const(blocked);
        return rule(ctx.unwrap("some")).match({
            some: (_$2, reason) => East.value(variant("blocked", reason), SheetActionGateType),
            none: () => East.value(variant("open", null), SheetActionGateType),
        });
    });

    // The author's order: the `cases` record's, as East keeps a variant's cases in name order.
    const types = variantType.cases as Record<string, EastType>;
    const ordered = Object.keys(cfg.cases).map((name) => [name, types[name]!] as const);
    const caseValues = ordered.map(([name, type]) => {
        const at = `${where} case "${name}"`;
        const cs = cfg.cases[name]!;
        const take = cs.take;
        const kind = take?.[FIELD_HINT];
        let wireTake: ExprType<typeof SheetActionTakeType>;
        let formInitial: ((ctx: ExprType<StructType>) => unknown) | undefined;
        if (isTypeEqual(type, NullType)) {
            if (take !== undefined) throw new Error(`${at} is NullType — it asks nothing, and is a button; it takes no \`take\``);
            wireTake = East.value(variant("button", null), SheetActionTakeType);
        } else if (kind === "action-register") {
            if (!isTypeEqual(type, StringType)) throw new Error(`${at} is ${describeType(type)} — Sheet.action.menu({ of }) chooses a register member, whose key is a String`);
            if (registers[take!.of!] === undefined) throw new Error(`${at}'s menu names register "${take!.of}", which \`registers\` does not declare (${Object.keys(registers).join(", ") || "none declared"})`);
            wireTake = East.value(variant("register", take!.of!), SheetActionTakeType);
        } else if (kind === "action-menu" || (kind === undefined && isChoice(type))) {
            if (!isChoice(type)) throw new Error(`${at} is ${describeType(type)} — Sheet.action.menu({ labels }) chooses among a variant's cases, each NullType`);
            let spec: FieldSpecValue;
            try {
                spec = fieldSpecs(StructType([[name, type]]), { [name]: fieldSelect({ labels: take?.labels ?? {} } as never) } as never)[0]!;
            } catch (e) {
                throw new Error(`${at}'s menu ${(e as Error).message.replace(/^Fields: "[^"]*" is .* field — /, "")}`);
            }
            wireTake = East.value(variant("menu", spec.editor.type === "select" ? spec.editor.value : []), SheetActionTakeType);
        } else if (kind === "action-form" || kind === undefined) {
            const scalar = type.type !== "Struct";
            const hints = take?.fields;
            let specs: FieldSpecValue[];
            try {
                specs = scalar
                    ? fieldSpecs(StructType([[name, type]]), (hints === undefined ? {} : { [name]: hints }) as never)
                    : fieldSpecs(type as StructType, (hints ?? {}) as never);
            } catch (e) {
                throw new Error(`${at}'s form — ${(e as Error).message.replace(/^Fields: /, "")}`);
            }
            for (const spec of specs) {
                if (spec.editor.type === "reference" && registers[spec.editor.value.of] === undefined) {
                    throw new Error(`${at}'s form field "${spec.path.join(".")}" is a reference to "${spec.editor.value.of}", which is not one of the sheet's registers (${Object.keys(registers).join(", ") || "none declared"})`);
                }
            }
            wireTake = East.value(variant("form", { specs, scalar }), SheetActionTakeType);
            formInitial = take?.initial;
        } else {
            throw new Error(`${at}'s \`take\` is "${String(kind)}" — it is Sheet.action.menu(…) or Sheet.action.form(…)`);
        }

        // What the form opens with, encoded at the case's type.
        const initial = formInitial !== undefined
            ? (() => {
                const opening = East.function([ctxType], type, (_$, c) => formInitial!(c as never) as SubtypeExprOrValue<EastType>);
                return some(East.function([SheetContextType], BlobType, ($, wire) => {
                    const bridgeCtx = $.const(bridge.bridgeCtx);
                    const to = $.const(toContext);
                    const open = $.const(opening);
                    return East.Blob.encodeBeast(open(to(bridgeCtx(wire)).unwrap("some")), "v2");
                }));
            })()
            : none;

        // What else taking it writes, as the cells its patches set.
        const updatesRule = cs.updates;
        const updates = updatesRule !== undefined
            ? (() => {
                const author = East.function([type, ctxType, DateTimeType], authorUpdatesType, (_$, v, c, moment) => {
                    const given = updatesRule(v, c as never, moment) ?? {};
                    if (given.group !== undefined && groupPatchType === undefined) {
                        throw new Error(`${at}'s \`updates\` returns a group patch, and the sheet declares no group — a flat sheet's action updates its row alone`);
                    }
                    const row = given.row !== undefined ? East.value(given.row as SubtypeExprOrValue<EastType>) : East.value(emptyPatch(lineType), rowPatchType);
                    if (!isTypeEqual(Expr.type(row as never) as EastType, rowPatchType)) {
                        throw new Error(`${at}'s \`updates\` returns a row patch of another type — build it with Sheet.patch(RowType, { … }) over the columns' type`);
                    }
                    if (groupPatchType === undefined) return { row } as never;
                    const group = given.group !== undefined ? East.value(given.group as SubtypeExprOrValue<EastType>) : East.value(emptyPatch(groupType!), groupPatchType);
                    if (!isTypeEqual(Expr.type(group as never) as EastType, groupPatchType)) {
                        throw new Error(`${at}'s \`updates\` returns a group patch of another type — build it with Sheet.patch(GroupType, { … }) over the group's type`);
                    }
                    return { row, group } as never;
                });
                return some(East.function([BlobType, SheetContextType, DateTimeType], SheetActionUpdatesType, ($, bytes, wire, moment) => {
                    const bridgeCtx = $.const(bridge.bridgeCtx);
                    const to = $.const(toContext);
                    const rule = $.const(author);
                    const encodeRow = $.const(bridge.seedCells);
                    const value = $.const(bytes.decodeBeast(type, "v2"));
                    const result = $.const(rule(value, to(bridgeCtx(wire)).unwrap("some"), moment)) as unknown as ExprType<StructType<{ row: StructType; group: StructType }>>;
                    const row = $.const(encodeRow(result.row));
                    if (input.encodeGroup === undefined || groupPatchType === undefined) {
                        return East.value({ row, group: new Map() }, SheetActionUpdatesType);
                    }
                    const encodeGroup = $.const(input.encodeGroup);
                    return East.value({ row, group: encodeGroup(result.group) }, SheetActionUpdatesType);
                }));
            })()
            : none;

        return East.value({
            case: name,
            label: cs.label,
            state: cs.state,
            tone: cs.tone !== undefined ? some(resolveTag(cs.tone, StatusValueType)) : none,
            icon: cs.icon !== undefined ? some(cs.icon) : none,
            next: [...(cs.next ?? [])],
            take: wireTake,
            valueType: toEastTypeValue(type),
            initial,
            updates,
        } as SubtypeExprOrValue<typeof SheetActionCaseType>, SheetActionCaseType);
    });

    return East.value({
        start: [...(cfg.start ?? [])],
        cases: caseValues,
        gate,
        summary: sheetRuleCell("summary", key),
        name: cfg.name !== undefined ? some(sheetRuleCell("name", key)) : none,
        title: cfg.title !== undefined ? some(sheetRuleCell("title", key)) : none,
    } as SubtypeExprOrValue<typeof SheetActionKindType>, SheetActionKindType);
}

/** A patch of a struct that sets nothing — every field `none`. */
function emptyPatch(type: StructType): Record<string, unknown> {
    return Object.fromEntries(Object.keys(type.fields as Record<string, EastType>).map((name) => [name, none]));
}
