/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An accessor of a Schedule declaration, `(row, key) => …`, reified once
 * (#1367): a real East function over the row and its key, which the kind
 * calls per row (`shared/reify.ts`' rule), held to the type it returns. One
 * returning another type is refused at build, naming the accessor and what it
 * returns, rather than in East's own words.
 *
 * @packageDocumentation
 */

import { East, Expr, TypeMismatchError, printType, type EastType, type ExprType, type FunctionType, type SubtypeExprOrValue } from "@elaraai/east";

/**
 * Reifies an accessor over a row and its key, held to the type it returns.
 *
 * @typeParam T - The type it returns
 * @param rowType - The row type
 * @param keyType - The key type
 * @param out - The type it returns
 * @param accessor - The author's accessor
 * @param refusal - The refusal's words, given what the accessor returns instead, as East prints a type (`.String`)
 * @returns The accessor, an East function `(row, key) => T`
 * @throws {Error} The refusal, for an accessor returning another type; any other error its body throws, as it threw it
 */
export function scheduleAccessor<T extends EastType>(
    rowType: EastType,
    keyType: EastType,
    out: T,
    accessor: (row: ExprType<EastType>, key: ExprType<EastType>) => SubtypeExprOrValue<T>,
    refusal: (returns: string) => string,
): ExprType<FunctionType<[EastType, EastType], T>> {
    try {
        return East.function([rowType, keyType], out, (_$, row, key) => accessor(row, key)) as unknown as ExprType<FunctionType<[EastType, EastType], T>>;
    } catch (err) {
        if (!(err instanceof TypeMismatchError)) throw err;
        // What it returns, as East infers it from the accessor's own body.
        const inferred = East.function([rowType, keyType], undefined, (_$, row, key) => accessor(row, key) as ExprType<EastType>);
        throw new Error(refusal(printType((Expr.type(inferred as unknown as Expr) as FunctionType).output as EastType)));
    }
}
