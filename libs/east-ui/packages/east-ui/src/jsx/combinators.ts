/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Combinators that turn an east-ui component factory into a JSX tag.
 *
 * - {@link container} wraps a `(children, style?)` factory: children are
 *   coalesced (see `./children.js`); style props sit flat at the top level.
 * - {@link textLeaf} wraps a `(value, style?)` factory: text children become
 *   the value; style props sit flat.
 *
 * Both are exported so any factory not given a built-in tag is a one-liner.
 */

import {
    East,
    Expr,
    ArrayType,
    type ExprType,
    type SubtypeExprOrValue,
    type StringType,
    type IntegerType,
    type FloatType,
} from "@elaraai/east";
import { UIComponentType } from "../component.js";
import { coalesceChildren, type ElementChild } from "./children.js";
import type { UIElement } from "./runtime.js";

/**
 * A child of a text-leaf tag: a string/number literal, a string expression, or
 * a numeric expression — all East-typed. Numbers and numeric expressions fold
 * to their decimal string via `East.str`, so `<Text>{count}</Text>` and
 * `<Text>Hi {name}, {n} items</Text>` work.
 */
export type TextChild =
    | string
    | number
    | SubtypeExprOrValue<StringType>
    | ExprType<IntegerType>
    | ExprType<FloatType>
    | null
    | undefined
    | TextChild[];

/** A JSX tag: a function from a single props object to a built east-ui element. */
export type JsxTag<P> = (props: P) => UIElement;

/** Props for a container tag wrapping `F`: its style props (flat) + children. */
export type ContainerProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children?: ElementChild };

/** Props for a text tag wrapping `F`: its style props (flat) + text children. */
export type TextProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children?: TextChild };

function isExpr(x: unknown): x is Expr {
    return x instanceof Expr;
}

/** True when an object has at least one own enumerable key. */
function hasKeys(o: Record<string, unknown>): boolean {
    for (const _ in o) return true;
    return false;
}

/**
 * Fold literal + expression parts into one `StringType` expression via
 * `East.str`, which inserts `Print` for non-string expressions (so an Integer
 * or Float interpolates as its decimal string, and a lone string expression
 * folds to an equivalent value).
 */
function foldStr(parts: unknown[]): ExprType<StringType> {
    let buf = "";
    const strings: string[] = [];
    const exprs: Expr[] = [];
    for (const p of parts) {
        if (isExpr(p)) {
            strings.push(buf);
            buf = "";
            exprs.push(p);
        } else {
            buf += String(p);
        }
    }
    strings.push(buf);
    const template = Object.assign([...strings], {
        raw: [...strings],
    }) as unknown as TemplateStringsArray;
    return East.str(template, ...exprs);
}

/**
 * Collapse text children into a single `StringType` value. Nullish parts are
 * dropped; all-static parts join; anything with an expression — alone or
 * interpolated with literals — folds through `East.str`.
 */
export function joinText(child: TextChild): SubtypeExprOrValue<StringType> {
    const parts: unknown[] = [];
    const walk = (c: TextChild): void => {
        if (c === null || c === undefined) return;
        if (Array.isArray(c)) {
            for (const x of c) walk(x);
            return;
        }
        parts.push(c);
    };
    walk(child);

    if (parts.length === 0) return "";
    if (parts.every((p) => typeof p === "string" || typeof p === "number")) {
        return parts.map((p) => String(p)).join("");
    }
    return foldStr(parts);
}

/**
 * Build a JSX tag for a container factory (signature `(children, style?)`).
 * Style props are top-level; `children` are coalesced into the factory's real
 * `SubtypeExprOrValue<ArrayType<UIComponentType>>` children arg.
 *
 * @example
 * ```ts
 * import { Flex } from "@elaraai/east-ui";
 * export const FlexTag = container(Flex.Root);
 * // <FlexTag gap="2"><Text>hi</Text></FlexTag>
 * ```
 */
export function container<S>(
    factory: (
        children: SubtypeExprOrValue<ArrayType<UIComponentType>>,
        style?: S,
    ) => UIElement,
): JsxTag<S & { children?: ElementChild }> {
    return (props) => {
        const { children, ...style } = props as { children?: ElementChild } &
            Record<string, unknown>;
        return factory(coalesceChildren(children), (hasKeys(style) ? style : undefined) as S);
    };
}

/**
 * Build a JSX tag for a text-leaf factory (signature `(value, style?)`). Text
 * children become the value; style props are top-level.
 *
 * @example
 * ```ts
 * import { Code } from "@elaraai/east-ui";
 * export const CodeTag = textLeaf(Code.Root);
 * // <CodeTag>const x = 1</CodeTag>
 * ```
 */
export function textLeaf<V extends SubtypeExprOrValue<StringType>, S>(
    factory: (value: V, style?: S) => UIElement,
): JsxTag<S & { children?: TextChild }> {
    return (props) => {
        const { children, ...style } = props as { children?: TextChild } &
            Record<string, unknown>;
        return factory(joinText(children) as V, (hasKeys(style) ? style : undefined) as S);
    };
}

export { hasKeys };
