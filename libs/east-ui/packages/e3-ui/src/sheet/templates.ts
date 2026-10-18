/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s templates (#1183, #1345, `Sheet Builder Spec.md` §4.2, SB9):
 * the Rows tab's cards. Templates are records (#1340): `Sheet.templates(rows,
 * { name, group?, values, source })` reads one templates record — its rows the
 * templates, its keys theirs — and names the source of the sheet's
 * `Slice.bindRecords` that narrows the Rows tab's cards of it. A grouped
 * sheet's row templates and group templates are two records, each its own
 * source.
 *
 * A template is a row template — over the row type, a grouped sheet's line
 * type — or a group template, over the group type with its lines, as its
 * `values` patch's type says, as an author's tab's `drop` does. Each carries
 * a seed built by the code that builds `newRow`'s and `newGroup`'s: the
 * constructor's defaults first, the template's set fields over them. The
 * cells its card shows are the template's own fields, through the columns'
 * projection.
 *
 * @packageDocumentation
 */

import {
    ArrayType,
    DictType,
    East,
    Expr,
    FunctionType,
    OptionType,
    StringType,
    StructType,
    VariantType,
    isTypeEqual,
    none,
    printType,
    variant,
    type EastType,
    type ExprType,
    type SubtypeExprOrValue,
} from "@elaraai/east";
import { SheetCellType, SheetPatchTypeFor, type SheetPatchOf } from "./types.js";
import { SheetNewGroupType, SheetNewRowType } from "./transactions.js";
import { SheetSeedType } from "./editing-types.js";
import { buildSheetSeed } from "./seed-bridge.js";
import { buildPatchCells, type SheetBridge } from "./bridge.js";

/** Identifies a templates list, as `Sheet.templates` declares one. */
export const SHEET_TEMPLATES: unique symbol = Symbol("Sheet.templates");

/**
 * The accessors over one row of a templates record, each given the row and
 * its key — `Sheet.templates(rows, { name, group?, values, source })`.
 *
 * @typeParam R - The templates record's row type
 * @typeParam P - The patch `values` returns: `Sheet.Types.Patch` of the row type (a grouped sheet's line type), or of the group type
 */
export interface SheetTemplatesConfig<R extends EastType, P extends EastType> {
    /** The card's name. */
    name: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<StringType>;
    /** The Rows tab's group the card sits under; none, it sits under no group. */
    group?: (row: ExprType<R>, key: ExprType<StringType>) => SubtypeExprOrValue<OptionType<StringType>>;
    /**
     * The fields the template sets — `Sheet.patch(RowType, …)` for a row
     * template (a grouped sheet's line type), `Sheet.patch(GroupType, …)` for
     * a group template with its lines. A field it leaves unset takes
     * `newRow`'s (or `newGroup`'s) default, or starts missing.
     */
    values: (row: ExprType<R>, key: ExprType<StringType>) => ExprType<P>;
    /**
     * The source of the sheet's `Slice.bindRecords` whose shown keys narrow
     * these cards: the templates record's own source, its keys these
     * templates' keys. A templates list must name one.
     */
    source?: string;
}

/**
 * One templates list — what `Sheet.templates` returns, and `<Sheet
 * templates>` takes, alone or several in an array.
 *
 * @typeParam P - The patch its `values` returns
 */
export interface SheetTemplates<P extends EastType = EastType> {
    /** Identifies the declaration. */
    readonly [SHEET_TEMPLATES]: true;
    /** The templates record's rows, keyed by String: its `read()`. */
    readonly rows: ExprType<DictType<StringType, EastType>>;
    /** The accessors, read once when the sheet is built. */
    readonly config: SheetTemplatesConfig<EastType, P>;
    /** The source it names, if any. */
    readonly source: string | undefined;
}

/**
 * What `<Sheet templates>` takes: one templates list, or several — a grouped
 * sheet's row templates and group templates are two.
 *
 * @typeParam L - The row type (a grouped sheet's line type)
 * @typeParam G - The group type, on a grouped sheet
 */
export type SheetTemplatesProp<L extends StructType, G extends StructType = never> =
    | SheetTemplates<SheetPatchOf<L>>
    | ([G] extends [never] ? never : SheetTemplates<SheetPatchOf<G>>)
    | readonly (SheetTemplates<SheetPatchOf<L>> | ([G] extends [never] ? never : SheetTemplates<SheetPatchOf<G>>))[];

/**
 * Reads a templates record — `Sheet.templates(rows, { name, group?, values,
 * source })`, usually over a bound record's `read()`: one card per row, in
 * the record's key order, its key the row's key. `source` names the sheet's
 * `Slice.bindRecords` source over the same record, which narrows these cards
 * as it narrows anything of that record's (#1340, #1345). Each accessor is
 * reified once, when the sheet is built.
 *
 * @typeParam R - The templates record's row type
 * @typeParam P - The patch `values` returns
 * @param rows - The templates record's rows, keyed by String
 * @param config - The accessors, and the source that narrows the cards
 * @returns The templates list
 * @throws {Error} When the rows are not a Dict keyed by String
 */
export function sheetTemplates<R extends EastType, P extends EastType>(
    rows: SubtypeExprOrValue<DictType<StringType, R>>,
    config: SheetTemplatesConfig<R, P>,
): SheetTemplates<P> {
    const source = East.value(rows) as unknown as ExprType<DictType<StringType, EastType>>;
    const type = Expr.type(source as unknown as Expr) as EastType;
    if (type.type !== "Dict" || (type.key as EastType).type !== "String") {
        throw new Error(`Sheet.templates: rows must be a Dict keyed by String — a templates record's read(), its keys the templates' keys — and these are ${printType(type)}`);
    }
    return { [SHEET_TEMPLATES]: true, rows: source, config: config as unknown as SheetTemplatesConfig<EastType, P>, source: config.source };
}

/**
 * Whether a value is a templates list `Sheet.templates` declared.
 *
 * @param input - Anything `templates` was given
 * @returns Whether it is one
 * @internal
 */
export function isSheetTemplates(input: unknown): input is SheetTemplates {
    return typeof input === "object" && input !== null && (input as { [SHEET_TEMPLATES]?: unknown })[SHEET_TEMPLATES] === true;
}

/**
 * One template on the wire: its card, and its seed — the draft and the row it
 * drops, as `newRow`'s and `newGroup`'s constructors make them.
 *
 * @property key - The template's key: its row's key in its templates record
 * @property source - The source of the sheet's slice its list follows: its key, one of that source's keys
 * @property name - The card's name
 * @property group - The Rows tab's group the card sits under
 * @property cells - What the card shows: the template's own fields, through the columns' projection
 * @property seed - A row template's seed, over the new row's context; or a group template's, over the new group's
 */
export const SheetTemplateWireType = StructType({
    key: StringType,
    source: StringType,
    name: StringType,
    group: OptionType(StringType),
    cells: DictType(StringType, SheetCellType),
    seed: VariantType({
        row: FunctionType([SheetNewRowType], SheetSeedType),
        group: FunctionType([SheetNewGroupType], SheetSeedType),
    }),
});

/** Type representing {@link SheetTemplateWireType}. */
export type SheetTemplateWireType = typeof SheetTemplateWireType;

/** The constructors a sheet declares, already checked by its root: `newRow` and `newGroup`. */
export interface SheetConstructors {
    /** `newRow`: the new row's context to its defaults. */
    newRow?: unknown;
    /** `newGroup`: the new group's context to its defaults. */
    newGroup?: unknown;
}

/** A templates list, its source checked against the sheet's slice. */
export interface SheetTemplatesList {
    /** The list. */
    templates: SheetTemplates;
    /** The source it follows, one of the slice's. */
    source: string;
}

/**
 * A constructor whose defaults the template's set fields override: each field
 * the template sets, else the constructor's default, else unset.
 */
function overDefaults(
    contextType: StructType,
    rowType: StructType,
    values: ExprType<EastType>,
    defaults: unknown,
): ExprType<FunctionType<[StructType], StructType>> {
    const patchType = SheetPatchTypeFor(rowType) as StructType;
    const fields = Object.keys(rowType.fields as Record<string, EastType>);
    const unset = East.value(Object.fromEntries(fields.map((f) => [f, none])) as never, patchType);
    const construct = defaults === undefined ? undefined
        : East.value(defaults as SubtypeExprOrValue<EastType>) as ExprType<FunctionType<[StructType], StructType>>;
    return East.function([contextType], patchType, ($, context) => {
        const set = $.const(values as ExprType<StructType>, patchType) as unknown as Record<string, ExprType<OptionType<EastType>>>;
        let base: Record<string, ExprType<OptionType<EastType>>>;
        if (construct === undefined) base = $.const(unset, patchType) as never;
        else {
            const make = $.const(construct);
            base = $.const(make(context), patchType) as never;
        }
        return Object.fromEntries(fields.map((f) => [f, set[f]!.hasTag("some").ifElse(() => set[f]!, () => base[f]!)])) as never;
    }) as unknown as ExprType<FunctionType<[StructType], StructType>>;
}

/**
 * One templates list on the wire: a card per row of its record, in key order,
 * each a row template or a group template as the list's `values` say.
 */
function buildList(
    list: SheetTemplatesList,
    bridge: SheetBridge,
    constructors: SheetConstructors,
): ExprType<ArrayType<SheetTemplateWireType>> {
    const { templates, source } = list;
    const rowsType = Expr.type(templates.rows as unknown as Expr) as DictType<StringType, EastType>;
    const rowType = rowsType.value as EastType;
    const cfg = templates.config;
    // The accessors, reified once: what each row's card is made by.
    const values = East.function([rowType, StringType], undefined, (_$, row, key) => cfg.values(row, key));
    const valuesType = (Expr.type(values as unknown as Expr) as FunctionType).output as EastType;
    const groupHalf = bridge.group;
    const kind = isTypeEqual(valuesType, SheetPatchTypeFor(bridge.lineType)) ? "row"
        : groupHalf !== undefined && isTypeEqual(valuesType, SheetPatchTypeFor(groupHalf.groupType)) ? "group" : undefined;
    if (kind === undefined) {
        throw new Error(`Sheet: the templates of source '${source}' set ${printType(valuesType)} — build their values with Sheet.patch(RowType, …) over the sheet's row type (a grouped sheet: its line type)${groupHalf !== undefined ? ", or Sheet.patch(GroupType, …) for group templates" : ""}`);
    }
    // A row template's cells and seed are a row's; a group template's, its group's with its lines.
    const rowKind = kind === "row";
    const patchType = SheetPatchTypeFor(rowKind ? bridge.lineType : groupHalf!.groupType) as StructType;
    const cellsOf = rowKind ? bridge.seedCells : buildPatchCells(groupHalf!.groupType, groupHalf!.cellMetas, {}, false);
    const seedOf = (set: ExprType<StructType>) => (rowKind
        ? variant("row", buildSheetSeed(SheetNewRowType, bridge.lineType, overDefaults(SheetNewRowType, bridge.lineType, set, constructors.newRow), bridge.seedCells))
        : variant("group", buildSheetSeed(SheetNewGroupType, groupHalf!.groupType, overDefaults(SheetNewGroupType, groupHalf!.groupType, set, constructors.newGroup), cellsOf,
            { field: groupHalf!.linesField, project: bridge.projectRow })));
    const named = East.function([rowType, StringType], StringType, (_$, row, key) => cfg.name(row, key));
    const grouped = East.function([rowType, StringType], OptionType(StringType), (_$, row, key) =>
        cfg.group === undefined ? East.value(none, OptionType(StringType)) : cfg.group(row, key));
    const describe = East.function([rowType, StringType], SheetTemplateWireType, ($, row, key) => {
        const valuesOf = $.const(values);
        const set = $.const(valuesOf(row, key), patchType) as unknown as ExprType<StructType>;
        const nameOf = $.const(named);
        const groupOf = $.const(grouped);
        const cells = $.const(cellsOf);
        return { key, source, name: nameOf(row, key), group: groupOf(row, key), cells: cells(set), seed: seedOf(set) } as never;
    });
    return templates.rows.toArray(($, row, key) => {
        const card = $.const(describe);
        return card(row, key);
    }) as unknown as ExprType<ArrayType<SheetTemplateWireType>>;
}

/**
 * Builds the sheet's templates on the wire (SB9): each list's, in the order
 * the lists are given, each in its record's key order.
 *
 * @param lists - The templates lists, each with the source it follows, checked against the sheet's slice
 * @param bridge - The sheet's bridge, as its root compiled it
 * @param constructors - The sheet's `newRow` and `newGroup`, as its root checked them
 * @returns The templates on the wire
 * @throws Error naming the source: a list whose `values` set neither the row type (a grouped sheet's line type) nor the group type
 * @internal
 */
export function buildTemplates(
    lists: readonly SheetTemplatesList[],
    bridge: SheetBridge,
    constructors: SheetConstructors,
): ExprType<ArrayType<SheetTemplateWireType>> {
    let out = East.value([], ArrayType(SheetTemplateWireType));
    for (const list of lists) out = out.concat(buildList(list, bridge, constructors));
    return out;
}
