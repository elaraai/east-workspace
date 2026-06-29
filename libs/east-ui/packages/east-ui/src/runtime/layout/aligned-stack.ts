/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<AlignedStack>` tag — see the export's JSDoc.
 */

import { AlignedStack as AlignedStackFactory } from "../../layout/aligned-stack/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * Vertically stacks axis/lane components (Chart, Trace, Calendar, Planner, …) on
 * a **shared plot gutter** so their data lanes line up on a common x. Set
 * `gutter` to `{ left, right }` (px) — every child's lane occupies exactly
 * `[left, W − right]`, chrome (axes, frozen columns, headers) rendering within
 * the gutter — or `"auto"` to measure the max gutter the children need. A
 * child's own `plotGutter` prop overrides the inherited value (#147).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { AlignedStack, Chart, UIComponentType } from "@elaraai/east-ui";
 *
 * const aligned = East.function([], UIComponentType, _$ => (
 *     <AlignedStack gutter={{ left: "48px", right: "12px" }} gap="8px">
 *         <Chart layers={Chart.Line(rows, { x: r => r.day, y: r => r.value })} />
 *         {/* …a Trace / Planner on the same day axis… *\/}
 *     </AlignedStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `AlignedStack.Types`. Desugars to `AlignedStack.Root(children, options)`.
 */
export const AlignedStack: JsxTag<ContainerProps<typeof AlignedStackFactory.Root>> & { Types: typeof AlignedStackFactory.Types } =
    Object.assign(container(AlignedStackFactory.Root), { Types: AlignedStackFactory.Types });
