/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Flex>` tag — see the export's JSDoc.
 */

import { Flex as FlexFactory } from "../../layout/flex/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * A flexbox container — lays children out along a main axis with control over
 * direction, wrapping, and alignment. Use it when you want one-dimensional
 * flow with arbitrary `direction` (`row` / `column` / their reverses) and
 * optional `wrap`; for an axis-locked stack with a single `gap`, prefer
 * {@link VStack} / {@link HStack}. Direction, `wrap`, `justify`/`align`, `gap`
 * and the box-model props are flat ({@link FlexStyle}); children are the JSX
 * children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Flex, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const toolbar = East.function([], UIComponentType, _$ => (
 *     <Flex direction="row" justifyContent="space-between" alignItems="center" padding="4">
 *         <Text>Left</Text>
 *         <Text>Center</Text>
 *         <Text>Right</Text>
 *     </Flex>
 * ));
 * ```
 *
 * @remarks
 * Carries `Flex.Types` — the East data type and the style struct. Desugars to
 * `Flex.Root(children, options)`.
 */
export const Flex: JsxTag<ContainerProps<typeof FlexFactory.Root>> & { Types: typeof FlexFactory.Types } =
    Object.assign(container(FlexFactory.Root), { Types: FlexFactory.Types });
