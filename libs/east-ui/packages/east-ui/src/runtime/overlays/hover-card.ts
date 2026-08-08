/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<HoverCard>` tag — see the export's JSDoc. */

import { HoverCard as HoverCardFactory } from "../../overlays/hover-card/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * HoverCard — a rich preview panel that opens on hover, after a short delay.
 * Use it for context that is helpful but optional: a profile card behind a
 * @-mention, a link preview, or a summary behind an entity name. It carries
 * arbitrary UI children (avatars, badges, text), which distinguishes it from
 * the text-only {@link Tooltip}. Placement, open/close delays, and a pointing
 * arrow are flat props ({@link HoverCardOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Avatar, HoverCard, HStack, Text, UIComponentType, VStack } from "@elaraai/east-ui";
 *
 * const profile = East.function([], UIComponentType, _$ => (
 *     <HoverCard trigger={<Text color="link" fontWeight="medium">@johndoe</Text>} placement="bottom" openDelay={200n}>
 *         <HStack gap="3">
 *             <Avatar name="John Doe" size="lg" />
 *             <VStack gap="1" align="flex-start">
 *                 <Text fontWeight="semibold">John Doe</Text>
 *                 <Text textStyle="body-sm" color="fg.muted">Software Engineer</Text>
 *             </VStack>
 *         </HStack>
 *     </HoverCard>
 * ));
 * ```
 *
 * @remarks
 * Carries `HoverCard.Types` — the East data type and the style struct. The
 * preview body is the children; the hovered element is the `trigger` prop.
 * Desugars to `HoverCard.Root(body, options)`.
 */
export const HoverCard: JsxTag<ContainerProps<typeof HoverCardFactory.Root>> & { Types: typeof HoverCardFactory.Types } =
    Object.assign(container(HoverCardFactory.Root), { Types: HoverCardFactory.Types });
