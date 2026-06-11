/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Navigation `<Breadcrumb>` tag — a trail of ancestor links. */

import { Breadcrumb as BreadcrumbFactory } from "../../navigation/breadcrumb/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Breadcrumb trail — shows where the current view sits in a hierarchy and
 * lets the user jump back up it. Each entry has a `label`, an optional
 * `current` flag marking the page the user is on, and an optional `onClick`
 * handler for the ancestor links. An optional `runAnchor` pins the trail to a
 * specific run or stamp at its tail. The entries are the `items` prop; visual
 * options are flat props ({@link BreadcrumbStyle}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East, some, none } from "@elaraai/east";
 * import { Breadcrumb, UIComponentType } from "@elaraai/east-ui";
 *
 * const trail = East.function([], UIComponentType, _$ => (
 *     <Breadcrumb
 *         items={[
 *             { label: "SE region", current: none, onClick: none },
 *             { label: "wk of Sep 16", current: none, onClick: none },
 *             { label: "Roster builder", current: some(true), onClick: none },
 *         ]}
 *         runAnchor="run #42"
 *     />
 * ));
 * ```
 *
 * @remarks
 * Carries `Breadcrumb.Types` — the East data type, the item struct, and the
 * style struct. Desugars to `Breadcrumb.Root(items, options)`.
 */
export const Breadcrumb: JsxTag<ValueProps<typeof BreadcrumbFactory.Root, "items">> & { Types: typeof BreadcrumbFactory.Types } =
    Object.assign(leaf(BreadcrumbFactory.Root, "items"), { Types: BreadcrumbFactory.Types });
