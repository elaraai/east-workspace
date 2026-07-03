/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal factory plumbing — reifies authoring-time mapper/accessor lambdas
 * into real East functions (elaraai/east-workspace#203, #205).
 *
 * Component factories accept generic TS lambdas over `ExprType` placeholders
 * (`value: (v, row) => …`, `assignment: x => ({ … })`). Historically each
 * factory invoked the lambda mid-`.map` and spliced the resulting expression
 * tree straight into the map body — giving double-evaluation hazards when a
 * result was referenced twice, undefined capture semantics for outer-scope
 * references, and per-expansion type checks. These helpers wrap the lambda
 * into a genuine East function exactly once per factory call; the factory
 * then CALLS that function inside the same eager `.map`, so materialization
 * semantics and evaluated values are unchanged while captures and type
 * checking gain proper function semantics.
 *
 * Not exported from the package barrel — factory-internal only.
 *
 * @packageDocumentation
 */

import {
    type ArrayType,
    type BlockBuilder,
    East,
    type EastType,
    Expr,
    type ExprType,
    type FunctionType,
    type StructType,
    type SubtypeExprOrValue,
    type TypeOf,
} from "@elaraai/east";

/**
 * Reifies an accessor lambda into an East function, inferring the output
 * type from the lambda's expanded result (single expansion via
 * `East.function`'s inference overload).
 *
 * Use for accessors whose output type is caller-determined (Table/Gantt
 * column `value`, Chart encodings). For mappers with a fixed output type,
 * call `East.function(inputs, OutType, …)` directly — no inference needed.
 *
 * @typeParam I - The concrete East parameter types
 * @typeParam R - The lambda's result (an expression or plain value)
 * @param inputs - Concrete East parameter types, typically recovered via `Expr.type` on the data expression
 * @param accessor - The authoring-time lambda; expanded exactly once against typed placeholder parameters
 * @returns A callable East function expression whose output type is the expanded result's East type
 *
 * @internal
 */
export function reifyAccessor<const I extends EastType[], R>(
    inputs: [...I],
    accessor: (...args: { [K in keyof I]: ExprType<I[K]> }) => R,
): ExprType<FunctionType<I, TypeOf<R>>> {
    const fn = East.function(
        inputs,
        undefined,
        (_$: unknown, ...args: { [K in keyof I]: ExprType<I[K]> }) => accessor(...args),
    );
    return fn as unknown as ExprType<FunctionType<I, TypeOf<R>>>;
}

/**
 * Maps `rows` through a reified per-row mapper — the standard factory move
 * of normalizing caller rows into a fixed IR element type, with the mapper
 * body inside a real East function instead of spliced into the map body.
 *
 * The mapping stays eager (`rows.map(fn)`), so the produced array value is
 * identical to the historical splice; only the generation mechanics change.
 *
 * @typeParam T - The fixed East element type the mapper produces
 * @param rows - The caller's rows array expression
 * @param outType - The fixed East output element type
 * @param body - Per-row normalization; expanded exactly once against a typed placeholder row
 * @returns The eagerly-mapped array expression
 *
 * @internal
 */
export function mapRows<T extends EastType>(
    rows: ExprType<ArrayType<StructType>>,
    outType: T,
    body: (row: ExprType<StructType>) => SubtypeExprOrValue<T>,
): ExprType<ArrayType<T>> {
    const rowType = (Expr.type(rows) as ArrayType<StructType>).value;
    const fn = East.function([rowType], outType, (_$, row) => body(row));
    return rows.map((_$, row) => fn(row)) as unknown as ExprType<ArrayType<T>>;
}

/**
 * `mapRows` for row mappers whose body needs a block builder — per-row
 * normalizations that declare `$.let` bindings or emit statements (Matrix,
 * Planner, Library row construction).
 *
 * @typeParam T - The fixed East element type the mapper produces
 * @param rows - The caller's rows array expression
 * @param outType - The fixed East output element type
 * @param body - Per-row normalization receiving the function's block builder; expanded exactly once against a typed placeholder row
 * @returns The eagerly-mapped array expression
 *
 * @internal
 */
export function mapRowsBlock<T extends EastType>(
    rows: ExprType<ArrayType<StructType>>,
    outType: T,
    body: ($: BlockBuilder<T>, row: ExprType<StructType>) => SubtypeExprOrValue<T>,
): ExprType<ArrayType<T>> {
    const rowType = (Expr.type(rows) as ArrayType<StructType>).value;
    const fn = East.function([rowType], outType, ($, row) => body($ as BlockBuilder<T>, row));
    return rows.map((_$, row) => fn(row)) as unknown as ExprType<ArrayType<T>>;
}
