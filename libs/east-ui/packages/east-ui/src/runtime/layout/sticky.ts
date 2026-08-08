/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Sticky>` tag — see the export's JSDoc.
 */

import { Sticky as StickyFactory } from "../../layout/sticky/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Pins its single child in place as the surrounding scroll container scrolls.
 * Reach for it for section headers that stay visible, or a left-column subnav
 * that holds at the top while the body scrolls past. Set the `offset` at which
 * it pins and the `boundary` it sticks within; styling props ({@link StickyStyle})
 * carry through. The pinned content is the single JSX child.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Sticky, Text, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const pinned = East.function([], UIComponentType, _$ => (
 *     <Box overflowY="auto" height="240px">
 *         <Sticky offset="0" boundary="parent" background="bg.surface">
 *             <Box padding="3" background="bg.surface"><Text>Section header — stays pinned</Text></Box>
 *         </Sticky>
 *         <VStack gap="2" padding="3">
 *             <Text>Row 1</Text>
 *             <Text>Row 2</Text>
 *             <Text>Row 3</Text>
 *         </VStack>
 *     </Box>
 * ));
 * ```
 *
 * @remarks
 * Carries `Sticky.Types` — the East data type, the style struct, and the
 * boundary enum. Desugars to `Sticky.Root(content, options)`.
 */
export const Sticky: JsxTag<ContentProps<typeof StickyFactory.Root>> & { Types: typeof StickyFactory.Types } =
    Object.assign(content(StickyFactory.Root), { Types: StickyFactory.Types });
