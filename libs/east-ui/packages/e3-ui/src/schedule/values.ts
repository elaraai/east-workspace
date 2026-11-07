/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A new row's own fields, from the app's `values` (#1526): an East function
 * from what a builder has decided of a row it makes — the roles it writes — to
 * the rest of the row, as a template's values, an arrival's and the Sheet's
 * `newRow` give them. The Roster's duties and targets, the Allocation's
 * reservations and a builder's periods take one, giving the fields no role
 * maps; the Schematic's links and nets take one too, giving every field but
 * their ends, as their templates do. It is reified once and held to those
 * fields at build: a field missing, one they lack, or one of another type is
 * refused, naming it. The builder writes its roles over what it returns;
 * without `values`, each field takes its type's default.
 *
 * @packageDocumentation
 */

import { East, Expr, printType, type EastType, type ExprType, type FunctionType, type StructType, type SubtypeExprOrValue } from "@elaraai/east";
import { fieldOf, type FieldName } from "./fields.js";

/**
 * What an app's `values` returns: a new row's own fields, each a field of the
 * row at its type. The build holds them to the fields its builder leaves to
 * the app — every one of them, and no other.
 *
 * @typeParam R - The row type
 */
export type ScheduleNewValues<R extends StructType> = { readonly [F in FieldName<R>]?: SubtypeExprOrValue<R["fields"][F]> };

/**
 * Reifies an app's `values` for a new row, held to the row's own fields (see
 * the module docs).
 *
 * @param made - What the builder has decided of the new row, the function's argument (`Roster.Types.NewDuty`, …)
 * @param rowType - The row type
 * @param own - The new row's own fields, what `values` returns: the fields no role maps, or for the Schematic's links and nets every field but their ends, as a template gives them
 * @param values - The app's `values`; `undefined`, none
 * @param where - The declaration, as a refusal names it
 * @returns The function from `made` to `own`; `undefined` without `values`
 * @throws {Error} When `values` is no function, or returns no struct, or a struct missing a field of `own`, holding one
 *   `own` lacks — a field the builder writes itself, or one the row does not have — or holding a field of another type,
 *   naming it
 */
export function scheduleNewValues(made: EastType, rowType: StructType, own: StructType, values: unknown, where: string): ExprType<FunctionType<[EastType], StructType>> | undefined {
    if (values === undefined) return undefined;
    const names = Object.keys(own.fields);
    const list = names.length === 0 ? "none" : names.join(", ");
    if (typeof values !== "function") {
        throw new Error(`${where}: \`values\` is a function giving a new row's own fields (${list}) — (made) => ({ … })`);
    }
    const given = values as (made: ExprType<EastType>) => unknown;
    // What it returns, as East infers it from its own body: refused field by field, so an object literal written in any
    // order is taken, and a field it leaves out or adds is named.
    const inferred = (Expr.type(East.function([made], undefined, (_$, arg) => given(arg) as ExprType<EastType>) as unknown as Expr) as FunctionType).output as EastType;
    if (inferred.type !== "Struct") {
        throw new Error(`${where}: \`values\` returns a struct of a new row's own fields (${list}) — and it returns ${printType(inferred)}`);
    }
    const returned = inferred.fields as Record<string, EastType>;
    const wanted = own.fields as Record<string, EastType>;
    const missing = names.filter((name) => !Object.hasOwn(returned, name));
    if (missing.length > 0) {
        throw new Error(`${where}: \`values\` gives every one of a new row's own fields (${list}) — and it leaves out ${missing.map((name) => `"${name}"`).join(", ")}`);
    }
    for (const name of Object.keys(returned)) {
        if (!Object.hasOwn(wanted, name)) {
            throw new Error(`${where}: \`values\` gives "${name}", ${Object.hasOwn(rowType.fields, name) ? "which the builder writes itself" : "a field the row does not have"} — ` +
                `it gives a new row's own fields (${list})`);
        }
    }
    // Each field at the row's type for it, as East converts it: a literal's empty collection or `none` takes the field's
    // type, which its inferred one is not a subtype of, and a value of another type is refused — an expression's with a
    // TypeMismatchError, a literal's with its conversion's. The body ran whole above, so what fails here is the field's.
    for (const name of names) {
        try {
            East.function([made], wanted[name]!, (_$, arg) => {
                const out = given(arg);
                return (out instanceof Expr ? fieldOf(out, name) : (out as Readonly<Record<string, unknown>>)[name]) as never;
            });
        } catch (err) {
            if (!(err instanceof Error)) throw err;
            throw new Error(`${where}: \`values\` gives "${name}" ${printType(returned[name]!)} — and the row's "${name}" holds ${printType(wanted[name]!)}`);
        }
    }
    return East.function([made], own, ($, arg) => {
        const out = given(arg);
        if (!(out instanceof Expr)) return out as SubtypeExprOrValue<StructType>;
        // A struct East built in another order: read field by field, in the row's.
        const held = $.const(out as ExprType<StructType>);
        return Object.fromEntries(names.map((name) => [name, fieldOf(held, name)])) as never;
    }) as unknown as ExprType<FunctionType<[EastType], StructType>>;
}
