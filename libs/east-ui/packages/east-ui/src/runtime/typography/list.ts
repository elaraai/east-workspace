/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Typography tag for an ordered or unordered list — bullets, numbered
 * steps, checklists, or rich rows. Items may be plain strings or full UI
 * components, and the marker is configurable (`check`, `dash`, `none`, …).
 */

import { List as ListFactory } from "../../typography/list/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * List — an ordered or unordered run of items. Items are supplied as the
 * `items` prop (strings or nested components, not JSX children); choose
 * `variant` (`ordered`/`unordered`) or a custom `marker` + `markerColor`,
 * and `gap`, via flat props ({@link ListStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { List, UIComponentType } from "@elaraai/east-ui";
 *
 * const checklist = East.function([], UIComponentType, _$ => (
 *     <List
 *         items={["Max 5 consecutive shifts — clear", "SLA: 92% on-time", "Within tolerance"]}
 *         marker="check"
 *         markerColor="fg.success"
 *         gap="2"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `List.Types` — the East data type and style struct. The `items`
 * prop is the positional `items` argument folded onto the JSX surface.
 * Desugars to `List.Root(items, options)`.
 */
export const List: JsxTag<ValueProps<typeof ListFactory.Root, "items">> & { Types: typeof ListFactory.Types } =
    Object.assign(leaf(ListFactory.Root, "items"), { Types: ListFactory.Types });
