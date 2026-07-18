/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<ValueTree>` tag — see the export's JSDoc. */

import { type EastType, type Expr, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import {
    ValueTree as ValueTreeFactory,
    type ValueTreeOptions,
} from "../../collections/value-tree/index.js";
import { UIComponentType } from "../../component.js";

/**
 * `<ValueTree>` — the editable tree of any East value: the `value` prop's
 * STATIC East type is walked at authoring time and materialized into a
 * fixed recursive node IR (structs, arrays, string-keyed dicts, options
 * and variants become branches; primitives become typed editable leaves;
 * everything else summarizes read-only). Pass `onUpdate` (and optionally
 * `at` scopes built with `ValueTree.at`) to receive the whole rebuilt
 * value — or subtree — after every edit; the raw path callbacks
 * (`onEdit` / `onInsert` / `onRemove` / `onTag`) remain for hosts with a
 * finer-grained store. Omit all callbacks for a read-only inspector.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { ValueTree, UIComponentType } from "@elaraai/east-ui";
 *
 * // Read-only inspector — any value materializes automatically.
 * const surface = East.function([], UIComponentType, _$ => (
 *     <ValueTree
 *         value={{
 *             rate: 0.15,
 *             label: "Base",
 *             tags: ["a", "b"],
 *         }}
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `ValueTree.at` (scoped subtree handlers), `ValueTree.zero`
 * (host-side default element for raw `onInsert` handlers) and
 * `ValueTree.Types`. Desugars to `ValueTree.Root(value, options)`.
 */
function ValueTreeTag<T extends EastType>(
    props: { value: SubtypeExprOrValue<T> | Expr } & ValueTreeOptions<T>,
): ExprType<UIComponentType> {
    const { value, ...options } = props;
    return ValueTreeFactory.Root(value, options);
}

/** The callable `<ValueTree>` tag carrying the factory namespace statics. */
export const ValueTree = Object.assign(ValueTreeTag, ValueTreeFactory);
