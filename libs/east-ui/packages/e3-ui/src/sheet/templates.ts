/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sheet>`'s templates (#1183, `Sheet Builder Spec.md` §4.2, SB9): the
 * Rows tab's cards. A row template is over the row type (a grouped sheet's
 * line type), a group template over the group type with its lines. Each is
 * checked against its type, and each carries a seed built by the code that
 * builds `newRow`'s and `newGroup`'s: the constructor's defaults first, the
 * template's set fields over them. The cells its card shows are the
 * template's own fields, through the columns' projection.
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
    some,
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

/**
 * One card of the library's Rows tab: a preset a planner drops into the sheet.
 *
 * @typeParam R - The type it sets: the row type (a grouped sheet's line type), or the group type
 */
export interface SheetTemplate<R extends StructType> {
    /** Its key — unique among the sheet's templates, rows and groups alike. */
    key: string;
    /** The card's name. */
    name: string;
    /** The Rows tab's group the card sits under. */
    group?: string;
    /** The fields it sets — `Sheet.patch(R, { … })`. A field it leaves unset takes `newRow`'s (or `newGroup`'s) default, or starts missing. */
    values: SubtypeExprOrValue<SheetPatchOf<R>>;
}

/**
 * The sheet's templates.
 *
 * @typeParam L - The row type (a grouped sheet's line type)
 * @typeParam G - The group type, on a grouped sheet
 */
export interface SheetTemplatesInput<L extends StructType, G extends StructType = never> {
    /** Row templates — on a grouped sheet, lines dropped into a group. */
    rows?: SheetTemplate<L>[];
    /** Group templates, each with its lines — a grouped sheet's only. */
    groups?: [G] extends [never] ? never : SheetTemplate<G>[];
}

/**
 * One template on the wire: its card, and its seed — the draft and the row it
 * drops, as `newRow`'s and `newGroup`'s constructors make them.
 *
 * @property key - The template's key
 * @property name - The card's name
 * @property group - The Rows tab's group the card sits under
 * @property cells - What the card shows: the template's own fields, through the columns' projection
 * @property seed - A row template's seed, over the new row's context; or a group template's, over the new group's
 */
export const SheetTemplateWireType = StructType({
    key: StringType,
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

/** A template's values, checked against the type it must set. */
function valuesOf(template: SheetTemplate<StructType>, rowType: StructType, what: "row" | "group"): ExprType<EastType> {
    const values = East.value(template.values as SubtypeExprOrValue<EastType>) as ExprType<EastType>;
    if (!isTypeEqual(Expr.type(values as Expr) as EastType, SheetPatchTypeFor(rowType))) {
        throw new Error(what === "row"
            ? `Sheet: row template "${template.key}" was built over another type — build its values with Sheet.patch(RowType, …) over the sheet's row type (a grouped sheet: its line type)`
            : `Sheet: group template "${template.key}" was built over another type — build its values with Sheet.patch(GroupType, …) over the sheet's group type`);
    }
    return values;
}

/**
 * Builds the sheet's templates on the wire (SB9).
 *
 * @param input - The templates, by kind
 * @param bridge - The sheet's bridge, as its root compiled it
 * @param constructors - The sheet's `newRow` and `newGroup`, as its root checked them
 * @returns The templates on the wire, rows first, each in the order declared
 * @throws Error naming the template: a template over another type, a key that repeats, or a group template on a flat sheet
 * @internal
 */
export function buildTemplates(
    input: { rows?: SheetTemplate<StructType>[]; groups?: SheetTemplate<StructType>[] } | undefined,
    bridge: SheetBridge,
    constructors: SheetConstructors,
): ExprType<ArrayType<SheetTemplateWireType>> {
    const rows = input?.rows ?? [];
    const groups = input?.groups ?? [];
    const seen = new Set<string>();
    for (const t of [...rows, ...groups]) {
        if (seen.has(t.key)) throw new Error(`Sheet: template key "${t.key}" repeats — each template's key is unique among the sheet's templates, rows and groups alike`);
        seen.add(t.key);
    }
    const groupHalf = bridge.group;
    if (groups.length > 0 && groupHalf === undefined) {
        throw new Error("Sheet: `templates.groups` needs a grouped sheet — declare `group={Sheet.group(GroupType, \"lines\", …)}`, or drop the group templates");
    }
    const wires: ExprType<SheetTemplateWireType>[] = [];
    for (const t of rows) {
        const values = valuesOf(t, bridge.lineType, "row");
        const seed = buildSheetSeed(SheetNewRowType, bridge.lineType, overDefaults(SheetNewRowType, bridge.lineType, values, constructors.newRow), bridge.seedCells);
        wires.push(East.value({
            key: t.key, name: t.name, group: t.group === undefined ? none : some(t.group),
            cells: bridge.seedCells(values as ExprType<StructType>),
            seed: variant("row", seed),
        }, SheetTemplateWireType));
    }
    if (groupHalf !== undefined) {
        const groupType = groupHalf.groupType;
        const groupCells = buildPatchCells(groupType, groupHalf.cellMetas, {}, false);
        for (const t of groups) {
            const values = valuesOf(t, groupType, "group");
            const seed = buildSheetSeed(SheetNewGroupType, groupType, overDefaults(SheetNewGroupType, groupType, values, constructors.newGroup), groupCells,
                { field: groupHalf.linesField, project: bridge.projectRow });
            wires.push(East.value({
                key: t.key, name: t.name, group: t.group === undefined ? none : some(t.group),
                cells: groupCells(values as ExprType<StructType>),
                seed: variant("group", seed),
            }, SheetTemplateWireType));
        }
    }
    return East.value(wires, ArrayType(SheetTemplateWireType));
}
