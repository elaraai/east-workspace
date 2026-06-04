/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Reactive JSX tag — the builder-children form `<Reactive>{$ => …}</Reactive>`.
 *
 * Its children are an East block-builder function: the body may read/write
 * State and Data, bind locals with `$.let`, and returns the rendered subtree.
 * The wrapper lifts it into the zero-input `East.function` that `Reactive.Root`
 * expects, so authors write the `$` block directly instead of the
 * `Reactive.Root(East.function([], UIComponentType, $ => …))` nesting.
 */

import { East, type BlockBuilder, type SubtypeExprOrValue } from "@elaraai/east";
import { Reactive as ReactiveFactory } from "../../reactive/index.js";
import { UIComponentType } from "../../component.js";
import type { UIElement } from "../runtime.js";

/** The block-builder body of a `<Reactive>` tag. */
export type ReactiveRender = (
    $: BlockBuilder<typeof UIComponentType>,
) => SubtypeExprOrValue<typeof UIComponentType> | void;

/** `<Reactive>` — re-renders when its State/Data reads change. Maps to `Reactive.Root`. */
export function Reactive(props: { children: ReactiveRender }): UIElement {
    return ReactiveFactory.Root(East.function([], UIComponentType, props.children));
}
