/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Box>` tag — see the export's JSDoc.
 */

import { Box as BoxFactory } from "../../layout/box/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * The general-purpose layout primitive — a single styled `<div>` that holds
 * any number of children. Reach for it when no more specialised container
 * fits: it exposes the full box-model and flex surface (padding, background,
 * border, radius, shadow, `display="flex"` with `flexDirection`/`justify`/
 * `align`, fixed `width`/`height`, `position`, `overflow`, typography) as flat
 * props ({@link BoxStyle}). Children are the JSX children.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const card = East.function([], UIComponentType, _$ => (
 *     <Box padding="4" background="blue.50" color="blue.800" borderRadius="md">
 *         <Text>Styled container content</Text>
 *     </Box>
 * ));
 * ```
 *
 * @remarks
 * Carries `Box.Types` — the East data type and the style struct. Desugars to
 * `Box.Root(children, options)`.
 */
export const Box: JsxTag<ContainerProps<typeof BoxFactory.Root>> & { Types: typeof BoxFactory.Types } =
    Object.assign(container(BoxFactory.Root), { Types: BoxFactory.Types });
