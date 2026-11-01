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
    return scheduleAccessorOver([rowType, keyType], out, accessor as (...args: ExprType<EastType>[]) => SubtypeExprOrValue<T>, refusal) as
        unknown as ExprType<FunctionType<[EastType, EastType], T>>;
}

/**
 * Reifies an accessor over any inputs, held to the type it returns: what
 * {@link scheduleAccessor} does over a row and its key, for an accessor that
 * reads more — a DecisionQueue option's roles read the option, its key and
 * its case.
 *
 * @typeParam T - The type it returns
 * @param inputs - The types it reads, in order
 * @param out - The type it returns
 * @param accessor - The author's accessor
 * @param refusal - The refusal's words, given what the accessor returns instead, as East prints a type (`.String`)
 * @returns The accessor, an East function over `inputs` to `T`
 * @throws {Error} The refusal, for an accessor returning another type; any other error its body throws, as it threw it
 */
export function scheduleAccessorOver<T extends EastType>(
    inputs: readonly EastType[],
    out: T,
    accessor: (...args: ExprType<EastType>[]) => SubtypeExprOrValue<T>,
    refusal: (returns: string) => string,
): ExprType<FunctionType<EastType[], T>> {
    try {
        return East.function([...inputs], out, (_$, ...args) => accessor(...args as ExprType<EastType>[])) as unknown as ExprType<FunctionType<EastType[], T>>;
    } catch (err) {
        if (!(err instanceof TypeMismatchError)) throw err;
        // What it returns, as East infers it from the accessor's own body.
        throw new Error(refusal(printType(scheduleAccessorReturns(inputs, accessor as (...args: ExprType<EastType>[]) => unknown))));
    }
}

/**
 * The type an accessor returns, as East infers it from the accessor's own
 * body: what a role whose type the app's row decides reads — a DecisionQueue
 * case's options, an option's change.
 *
 * @param inputs - The types it reads, in order
 * @param accessor - The author's accessor
 * @returns The type it returns
 * @throws {Error} Any error its body throws, as it threw it
 */
export function scheduleAccessorReturns(inputs: readonly EastType[], accessor: (...args: ExprType<EastType>[]) => unknown): EastType {
    const inferred = East.function([...inputs], undefined, (_$, ...args) => accessor(...args as ExprType<EastType>[]) as ExprType<EastType>);
    return (Expr.type(inferred as unknown as Expr) as FunctionType).output as EastType;
}
