/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The `<Reactive>` selective-rerender tag.
 */

import { East, type BlockBuilder, type SubtypeExprOrValue } from "@elaraai/east";
import { Reactive as ReactiveFactory } from "../../reactive/index.js";
import { UIComponentType } from "../../component.js";
import type { UIElement } from "../runtime.js";

/**
 * The builder body of a `<Reactive>` tag — an East block whose `$` reads
 * State/Data, binds locals, and returns the subtree to render. The set of
 * State/Data reads it touches becomes the reactive subscription.
 */
export type ReactiveRender = (
    $: BlockBuilder<typeof UIComponentType>,
) => SubtypeExprOrValue<typeof UIComponentType> | void;

/**
 * Reactive boundary — re-renders only this subtree when the State or Data it
 * reads changes, leaving the rest of the surface untouched. Use it to wrap
 * any interactive region (a counter, a form, a filtered list) so that
 * updating its backing State does not re-render the whole page. The child is
 * a builder closure `{$ => …}`: inside it you bind State/Data with
 * `State.bind` / `Data.bind`, read and write through the returned closures,
 * and return the rendered components.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, IntegerType, NullType } from "@elaraai/east";
 * import { Button, Reactive, State, Text, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const counter = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const countBind = $.let(State.bind([IntegerType], "demo.counter", 0n));
 *         const count = $.let(countBind.read());
 *         const increment = $.const(East.function([], NullType, $ => {
 *             const current = $.let(countBind.read());
 *             $(countBind.write(current.add(1n)));
 *         }));
 *         return (
 *             <VStack gap="2" align="stretch">
 *                 <Text>{East.str`Count: ${count}`}</Text>
 *                 <Button onClick={increment}>+1</Button>
 *             </VStack>
 *         );
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * The child is a {@link ReactiveRender} block-builder, not a UI sub-tag. The
 * tag lifts it into the zero-input `East.function([], UIComponentType, …)`
 * that the factory expects, so authors write the `$` block directly. Desugars
 * to `Reactive.Root(East.function([], UIComponentType, children))`.
 */
export function Reactive(props: { children: ReactiveRender }): UIElement {
    return ReactiveFactory.Root(East.function([], UIComponentType, props.children));
}
