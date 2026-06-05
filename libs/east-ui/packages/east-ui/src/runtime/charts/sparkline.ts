/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sparkline>` tag — see the export's JSDoc.
 */

import { Sparkline as SparklineFactory } from "../../charts/sparkline/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Compact, axis-free trend line — a single series of numbers rendered inline
 * to show shape and direction at a glance. Sized to fit beside text in a
 * metric tile, table cell, or list row, where a full {@link Chart} would be
 * too heavy. The numbers are the `data` prop; pick a `line` or filled `area`
 * `type`, a `color`, and explicit `width` / `height`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { HStack, VStack, Text, Sparkline, UIComponentType } from "@elaraai/east-ui";
 *
 * const revenueTile = East.function([], UIComponentType, _$ => (
 *     <HStack gap="4" align="center">
 *         <VStack gap="1">
 *             <Text>Revenue</Text>
 *             <Text fontWeight="bold">$45,231</Text>
 *         </VStack>
 *         <Sparkline data={[100.0, 120.0, 115.0, 130.0, 125.0, 140.0, 155.0]} type="area" color="teal.400" width="100px" height="40px" />
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * `data` accepts plain numbers or East expressions, so the trend can be driven
 * by reactive `State` inside a `<Reactive>` block. Carries `Sparkline.Types` —
 * the East data type and the type enum. Desugars to `Sparkline.Root(data, options)`.
 */
export const Sparkline: JsxTag<ValueProps<typeof SparklineFactory.Root, "data">> & { Types: typeof SparklineFactory.Types } =
    Object.assign(leaf(SparklineFactory.Root, "data"), { Types: SparklineFactory.Types });
