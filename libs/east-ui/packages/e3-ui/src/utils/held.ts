/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * An author's handle, bound once in a builder's own block (#1599).
 *
 * A builder's wire functions — the page its rows are read through, the read
 * a gesture begins from, the Apply a Save commits through — are made over the
 * handles its author binds (`Data.bindPaged`, `Record.bind`). A function
 * captures the variables it reads, and an author usually binds a handle with
 * `$.let`: a mutable variable, which a function captures as the variable
 * itself, its box. Each evaluation of the author's block makes its own box,
 * so every function over the handle differs from the last evaluation's
 * (East's `equivalentFor`: two boxes are two variables, whatever they hold) —
 * though the handle is the same one. A renderer that keeps what it read by the
 * function that read it — a sheet's windows, a plan's — then let all of it go
 * at every evaluation, a State the block reads or a record it reads whole
 * having moved: every row read and drawn again, and no row at all while a read
 * of its record was on its way.
 *
 * Bound here as a constant, in the builder's own block, the handle is captured
 * as its value, which a platform bind gives the same from one evaluation to
 * the next — and so are the functions made over it.
 *
 * @packageDocumentation
 */

import { Expr, type BlockBuilder, type EastType } from "@elaraai/east";

/**
 * Binds an author's handle once in a builder's block (see the module docs).
 *
 * @typeParam T - What the author passed
 * @param $ - The builder's own block
 * @param value - What the author passed for a prop that takes a handle: the handle — a struct a platform bind returns —
 *   or anything else the prop takes (a collection, a value written out, nothing)
 * @returns The handle's constant in the block; anything else as it was passed
 */
export function heldHandle<B extends EastType, T>($: BlockBuilder<B>, value: T): T {
    if (!(value instanceof Expr) || (Expr.type(value) as EastType).type !== "Struct") return value;
    return $.const(value as never) as T;
}
