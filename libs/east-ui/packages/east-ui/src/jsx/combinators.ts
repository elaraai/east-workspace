/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Combinators that turn an east-ui component factory into a JSX tag. Every tag
 * forwards the factory's own `SubtypeExprOrValue<T>` args verbatim — props are
 * never re-typed into JS/TS junk unions, and values are never coerced at the
 * JSX boundary. (Enum/variant style props carry their `XxxLiteral` string-union
 * proxy, but that lives on the factory's option interface, not here.)
 *
 * - {@link container} wraps a `(children, style?)` factory: children are the
 *   JSX children-collection (see `./children.js`), lowered to the factory's
 *   `SubtypeExprOrValue<ArrayType<UIComponentType>>`; style props sit flat.
 * - {@link content} wraps a `(value, style?)` factory whose single value is the
 *   JSX child — a text leaf (`Text`/`Badge`, value `SubtypeExprOrValue<StringType>`)
 *   or a single-content slot (`ScrollArea`/`Sticky`, value
 *   `SubtypeExprOrValue<UIComponentType>`) — forwarded verbatim.
 * - {@link leaf} wraps a `(value, style?)` factory whose value is a named prop.
 */

import { ArrayType, type SubtypeExprOrValue } from "@elaraai/east";
import { UIComponentType } from "../component.js";
import { coalesceChildren, type ContainerChildrenType } from "./children.js";
import type { UIElement } from "./runtime.js";

/** A JSX tag: a function from a single props object to a built east-ui element. */
export type JsxTag<P> = (props: P) => UIElement;

/** Props for a container tag wrapping `F`: its style props (flat) + children. */
export type ContainerProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children?: ContainerChildrenType };

/**
 * Props for a text-leaf tag wrapping `F`: its style props (flat) + the value as
 * `children`, typed exactly as the factory's value arg
 * (`SubtypeExprOrValue<StringType>`). Interpolate with `East.str` — text is a
 * single string value, not a join of mixed children.
 */
export type ContentProps<F extends (...a: never[]) => UIElement> =
    NonNullable<Parameters<F>[1]> & { children: Parameters<F>[0] };

/**
 * Props for a value-leaf tag wrapping `F` (signature `(value, style?)`): the
 * factory's value arg surfaced under the prop name `K`, plus its style props
 * (flat). E.g. `ValueProps<typeof Checkbox.Root, "checked">`.
 */
export type ValueProps<F extends (...a: never[]) => UIElement, K extends string> =
    Record<K, Parameters<F>[0]> & NonNullable<Parameters<F>[1]>;

/** True when an object has at least one own enumerable key. */
function hasKeys(o: Record<string, unknown>): boolean {
    for (const _ in o) return true;
    return false;
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
): JsxTag<S & { children?: ContainerChildrenType }> {
    return (props) => {
        const { children, ...style } = props as { children?: ContainerChildrenType } &
            Record<string, unknown>;
        return factory(coalesceChildren(children), (hasKeys(style) ? style : undefined) as S);
    };
}

/**
 * Build a JSX tag for a text-leaf factory (signature `(value, style?)`) whose
 * value is the text children — forwarded verbatim as the factory's value type.
 *
 * @example
 * ```ts
 * import { Code } from "@elaraai/east-ui";
 * export const CodeTag = content(Code.Root);
 * // <CodeTag>{"const x = 1"}</CodeTag>
 * ```
 */
export function content<V, S>(
    factory: (value: V, style?: S) => UIElement,
): JsxTag<S & { children: V }> {
    return (props) => {
        const { children, ...style } = props as { children: V } & Record<string, unknown>;
        return factory(children, (hasKeys(style) ? style : undefined) as S);
    };
}

/**
 * Build a JSX tag for a value-leaf factory (signature `(value, style?)`) whose
 * value is a typed datum exposed as the prop named `key` (its natural name —
 * `checked`, `value`, …); the rest of the options sit flat.
 *
 * @example
 * ```ts
 * import { Slider } from "@elaraai/east-ui";
 * export const SliderTag = leaf(Slider.Root, "value");
 * // <SliderTag value={v} min={0} max={100} onChange={set} />
 * ```
 */
export function leaf<V, S, K extends string>(
    factory: (value: V, style?: S) => UIElement,
    key: K,
): JsxTag<Record<K, V> & S> {
    return (props) => {
        const bag = props as Record<string, unknown>;
        const value = bag[key] as V;
        const style: Record<string, unknown> = {};
        for (const k of Object.keys(bag)) {
            if (k !== key) style[k] = bag[k];
        }
        return factory(value, (hasKeys(style) ? style : undefined) as S);
    };
}

export { hasKeys };
