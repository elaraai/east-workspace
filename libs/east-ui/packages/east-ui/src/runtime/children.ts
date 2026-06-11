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
 * A JS array of children may freely mix single `UIComponentType` elements with
 * dynamic `ArrayType<UIComponentType>` expressions — e.g. a static `<Text/>`
 * beside a `rows.map(...)`. Consecutive statics are grouped into list literals
 * and the dynamic lists are concatenated in place, so the result is one flat
 * `ArrayType<UIComponentType>` regardless of ordering.
 *
 * No JS `boolean`/`null`/nesting: conditional UI is East-side (`ifElse`). The
 * only runtime type read is `Expr.type(x).type === "Array"`, to tell a dynamic
 * array expression apart from a single element when lowering.
 */

import { Expr, East, ArrayType, isSubtype, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { UIComponentType } from "../component.js";

/**
 * One JSX child of a container: a single `UIComponentType` element or a dynamic
 * `ArrayType<UIComponentType>` list (e.g. `rows.map(...)`).
 */
export type ContainerChild =
    | SubtypeExprOrValue<UIComponentType>
    | SubtypeExprOrValue<ArrayType<UIComponentType>>;

/**
 * The children of a container tag: a single {@link ContainerChild}, or a JS
 * array of them (`<Box><A/>{rows.map(...)}<B/></Box>`) — elements may freely mix
 * single elements and dynamic lists, flattened in source order by
 * {@link coalesceChildren}.
 */
export type ContainerChildrenType =
    | ContainerChild
    | ReadonlyArray<ContainerChild>
    | undefined;

/**
 * Lower a container tag's `children` into the factory's
 * `SubtypeExprOrValue<ArrayType<UIComponentType>>` arg.
 */
export function coalesceChildren(
    child: ContainerChildrenType,
): SubtypeExprOrValue<ArrayType<UIComponentType>> {
    if (child === undefined) return East.value([], ArrayType(UIComponentType));
    // Multiple children: JSX hands a JS array of element expressions, each
    // either a single UIComponentType or a dynamic ArrayType<UIComponentType>
    // (`rows.map(...)`). Group consecutive statics into list literals and concat
    // the dynamic lists in place, so a static element beside a dynamic one
    // flattens to a single ArrayType<UIComponentType>.
    if (Array.isArray(child)) {
        // JSX hands a heterogeneous array of element expressions; each is an
        // `Expr` that's either a single UIComponentType or a dynamic list.
        const elements = child as Expr[];
        const parts: ExprType<ArrayType<UIComponentType>>[] = [];
        let statics: SubtypeExprOrValue<UIComponentType>[] = [];
        const flush = () => {
            if (statics.length > 0) {
                parts.push(East.value(statics, ArrayType(UIComponentType)));
                statics = [];
            }
        };
        for (const el of elements) {
            if (Expr.type(el).type === "Array") {
                flush();
                parts.push(el as ExprType<ArrayType<UIComponentType>>);
            } else {
                statics.push(el as ExprType<UIComponentType>);
            }
        }
        flush();
        if (parts.length === 0) return East.value([], ArrayType(UIComponentType));
        return parts.reduce((acc, part) => acc.concat(part));
    }
    // A single East expression: an ArrayType<UIComponentType> (e.g. `rows.map(...)`)
    // is the list already; anything else is one UIComponentType — wrap it.
    return isSubtype(Expr.type(child as Expr), ArrayType(UIComponentType))
        ? (child as SubtypeExprOrValue<ArrayType<UIComponentType>>)
        : East.value([child as SubtypeExprOrValue<UIComponentType>], ArrayType(UIComponentType));
}
