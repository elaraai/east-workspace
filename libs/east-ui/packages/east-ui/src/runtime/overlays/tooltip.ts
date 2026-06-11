/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Tooltip>` tag — see the export's JSDoc. */

import { Tooltip as TooltipFactory } from "../../overlays/tooltip/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Hover tooltip — a small floating label that explains the element it wraps.
 * The `trigger` is the element you hover; the tip text is the child. Reach for
 * it to clarify an icon, abbreviate a long label, or surface a keyboard
 * shortcut; for click-activated or touch-friendly hints use {@link ToggleTip},
 * and for rich previews use {@link HoverCard}. Placement, an optional pointing
 * arrow, and open/close delays are flat props ({@link TooltipOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, Tooltip, UIComponentType } from "@elaraai/east-ui";
 *
 * const tip = East.function([], UIComponentType, _$ => (
 *     <Tooltip trigger={<Button variant="solid">With Arrow</Button>} hasArrow={true}>
 *         This tooltip has an arrow
 *     </Tooltip>
 * ));
 * ```
 *
 * @remarks
 * Carries `Tooltip.Types` — the East data type and the style struct. The tip
 * text is the child; the hovered element is the `trigger` prop. Desugars to
 * `Tooltip.Root(content, options)`.
 */
export const Tooltip: JsxTag<ContentProps<typeof TooltipFactory.Root>> & { Types: typeof TooltipFactory.Types } =
    Object.assign(content(TooltipFactory.Root), { Types: TooltipFactory.Types });
