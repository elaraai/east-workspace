/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Children handling for the east-ui JSX runtime.
 *
 * A container factory's children arg is `SubtypeExprOrValue<ArrayType<
 * UIComponentType>>` — a list. JSX hands that list in one of two East-typed
 * shapes, and {@link coalesceChildren} normalizes either to the factory's arg:
 *
 * - a single `UIComponentType` (a lone child, or an East `cond.ifElse(<A/>, <B/>)`)
 *   → wrapped into a one-element list `[child]`;
 * - an `ArrayType<UIComponentType>` — a JS array of elements (`<Box><A/><B/></Box>`)
 *   or a dynamic East expression (`rows.map(...)`) → passed straight through.
 *
 * No JS `boolean`/`null`/nesting: conditional UI is East-side (`ifElse`), and a
 * static element among a dynamic list is composed East-side (`.concat`) or by
 * wrapping the dynamic part in its own container. The only runtime type read is
 * `Expr.type(x).type === "Array"`, to tell a dynamic array expression apart
 * from a single element when lowering.
 */

import { Expr, East, ArrayType, isSubtype, type SubtypeExprOrValue } from "@elaraai/east";
import { UIComponentType } from "../component.js";

/**
 * The children of a container tag: a single `UIComponentType` or an
 * `ArrayType<UIComponentType>` — both East-typed.
 */
export type ContainerChildrenType =
    | SubtypeExprOrValue<UIComponentType>
    | SubtypeExprOrValue<ArrayType<UIComponentType>>
    | undefined;

/**
 * Lower a container tag's `children` into the factory's
 * `SubtypeExprOrValue<ArrayType<UIComponentType>>` arg.
 */
export function coalesceChildren(
    child: ContainerChildrenType,
): SubtypeExprOrValue<ArrayType<UIComponentType>> {
    if (child === undefined) return East.value([], ArrayType(UIComponentType));
    // Multiple static children: JSX hands a JS array of element expressions.
    if (Array.isArray(child)) return East.value(child, ArrayType(UIComponentType));
    // A single East expression: an ArrayType<UIComponentType> (e.g. `rows.map(...)`)
    // is the list already; anything else is one UIComponentType — wrap it.
    return isSubtype(Expr.type(child as Expr), ArrayType(UIComponentType))
        ? (child as SubtypeExprOrValue<ArrayType<UIComponentType>>)
        : East.value([child as SubtypeExprOrValue<UIComponentType>], ArrayType(UIComponentType));
}
