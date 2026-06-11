/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<ScrollArea>` tag — see the export's JSDoc.
 */

import { ScrollArea as ScrollAreaFactory } from "../../layout/scroll-area/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * A scroll container with a consistent, themed scrollbar across browsers.
 * Reach for it when content overflows a bounded region — a long list, a wide
 * table in a drawer — and you want a styled scrollbar rather than the native
 * one. Set the scroll axes with `orientation` (`vertical` / `horizontal` /
 * `both`) and the scrollbar treatment with `scrollbarStyle` (e.g. `overlay`,
 * `reserved` to avoid layout shift); options are flat ({@link ScrollAreaStyle}).
 * The scrolled content is the single JSX child.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, ScrollArea, Text, VStack, UIComponentType } from "@elaraai/east-ui";
 *
 * const list = East.function([], UIComponentType, _$ => (
 *     <ScrollArea scrollbarStyle="overlay" orientation="vertical">
 *         <VStack gap="1">
 *             {Array.from({ length: 40 }, (_, i) => (
 *                 <Box padding="2"><Text>{`Driver ${i + 1}`}</Text></Box>
 *             ))}
 *         </VStack>
 *     </ScrollArea>
 * ));
 * ```
 *
 * @remarks
 * Carries `ScrollArea.Types` — the East data type, the style struct, and the
 * orientation/scrollbar-style enums. Desugars to `ScrollArea.Root(content,
 * options)`.
 */
export const ScrollArea: JsxTag<ContentProps<typeof ScrollAreaFactory.Root>> & { Types: typeof ScrollAreaFactory.Types } =
    Object.assign(content(ScrollAreaFactory.Root), { Types: ScrollAreaFactory.Types });
