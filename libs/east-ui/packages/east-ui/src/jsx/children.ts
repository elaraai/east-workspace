/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Child coalescing for the east-ui JSX runtime.
 *
 * A container tag's `children` arg is `SubtypeExprOrValue<ArrayType<
 * UIComponentType>>`. JSX hands children as a mix of static element values,
 * nested arrays, fragments, and — crucially — single East expressions whose
 * East type is `ArrayType<UIComponentType>` (e.g. an East `.map(...)` over a
 * dataset). {@link coalesceChildren} lowers any of these into one value of the
 * factory's real children type:
 *
 * - all-static → a plain JS `UIElement[]` (the factory's value branch; keeps
 *   the IR shape identical to a hand-written factory call);
 * - any East array-typed child present → an East `ArrayType<UIComponentType>`
 *   expression built by concatenating static runs (`East.value([...],
 *   ArrayType(UIComponentType))`) with the array expressions in source order.
 *
 * An East array child is not a special case — it is simply a value of the slot
 * type — so it flows straight through; the runtime only has to detect it (by
 * East type, never `Array.isArray`) and concat rather than push.
 */

import { East, Expr, ArrayType, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { UIComponentType } from "../component.js";
import type { UIElement } from "./runtime.js";

/**
 * A child of a container tag: a built element, a single East
 * `ArrayType<UIComponentType>` expression (e.g. `rows.map(...)`), a
 * conditional, or nested arrays of the same.
 */
export type ElementChild =
    | UIElement
    | ExprType<ArrayType<UIComponentType>>
    | boolean
    | null
    | undefined
    | ElementChild[];

/** Is `x` an East expression (a built value), vs a JS primitive/array? */
function isExpr(x: unknown): x is Expr {
    return x instanceof Expr;
}

/** Is `x` an East expression whose East type is `ArrayType<…>`? */
function isArrayExpr(x: unknown): x is ExprType<ArrayType<UIComponentType>> {
    return isExpr(x) && (Expr.type(x) as { type?: string }).type === "Array";
}

/** A contiguous run of static elements, or one East array expression. */
type Segment = UIElement[] | ExprType<ArrayType<UIComponentType>>;

/**
 * Lower JSX children into a value of the factory's `children` arg type.
 *
 * @param child - the raw `props.children` (one node, a JS array, a fragment
 *   result, or an East array expression — in any nesting)
 * @returns a `UIElement[]` when fully static, else a single East
 *   `ArrayType<UIComponentType>` expression
 */
export function coalesceChildren(
    child: unknown,
): SubtypeExprOrValue<ArrayType<UIComponentType>> {
    const segments: Segment[] = [];
    let staticRun: UIElement[] | null = null;

    const walk = (c: unknown): void => {
        if (c === null || c === undefined || typeof c === "boolean") return;
        if (Array.isArray(c)) {
            for (const x of c) walk(x);
            return;
        }
        if (isArrayExpr(c)) {
            segments.push(c);
            staticRun = null;
            return;
        }
        // Anything else is a single UIComponentType element.
        if (staticRun === null) {
            staticRun = [];
            segments.push(staticRun);
        }
        staticRun.push(c as UIElement);
    };
    walk(child);

    // Fully static: hand back a plain JS array (factory value branch).
    if (segments.every((s) => Array.isArray(s))) {
        return (segments as UIElement[][]).flat();
    }

    // Mixed / contains East array expressions: concat into one array expr.
    let acc: ExprType<ArrayType<UIComponentType>> | undefined;
    for (const seg of segments) {
        const segExpr: ExprType<ArrayType<UIComponentType>> = Array.isArray(seg)
            ? East.value(seg, ArrayType(UIComponentType))
            : seg;
        acc = acc === undefined ? segExpr : acc.concat(segExpr);
    }
    return acc ?? [];
}
