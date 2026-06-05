/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<ToggleTip>` tag — see the export's JSDoc. */

import { ToggleTip as ToggleTipFactory } from "../../overlays/toggle-tip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Click-activated tip — an accessible alternative to the hover {@link Tooltip}.
 * Tapping or focusing the `trigger` toggles a small floating panel, so it works
 * for touch and keyboard users where a hover tip never appears. Pair it with an
 * info `IconButton` next to a label to offer an optional "what is this?"
 * explanation. Placement, a pointing arrow, and an `onOpenChange` callback are
 * flat props ({@link ToggleTipOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { HStack, IconButton, Text, ToggleTip, UIComponentType } from "@elaraai/east-ui";
 *
 * const help = East.function([], UIComponentType, _$ => (
 *     <HStack gap="2" align="center">
 *         <Text>What is this?</Text>
 *         <ToggleTip
 *             trigger={<IconButton prefix="fas" name="circle-info" label="What is this" variant="ghost" size="xs" />}
 *             placement="top"
 *             hasArrow={true}
 *         >
 *             An accessible alternative to hover tooltips. Click to toggle!
 *         </ToggleTip>
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `ToggleTip.Types` — the East data type and the style struct. The tip
 * text is the child; the activating element is the `trigger` prop. Desugars to
 * `ToggleTip.Root(content, options)`.
 */
export const ToggleTip: JsxTag<ContentProps<typeof ToggleTipFactory.Root>> & { Types: typeof ToggleTipFactory.Types } =
    Object.assign(content(ToggleTipFactory.Root), { Types: ToggleTipFactory.Types });
