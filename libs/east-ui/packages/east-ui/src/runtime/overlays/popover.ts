/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Popover>` tag — see the export's JSDoc. */

import { Popover as PopoverFactory } from "../../overlays/popover/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * Popover — a non-modal floating panel anchored to a `trigger` and opened by
 * click. Unlike a {@link Dialog} it does not capture the page; use it for an
 * inline edit form, a small chart, or a details panel that should sit next to
 * its trigger. The body is the children (any UI components); an optional title
 * and description render as a header. Placement, a pointing arrow, and an
 * `onOpenChange` callback are flat props ({@link PopoverOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, Popover, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const panel = East.function([], UIComponentType, _$ => (
 *     <Popover trigger={<Button>Open Popover</Button>} title="Popover Title" description="A helpful description">
 *         <Text>This is the popover content. You can put any UI components here.</Text>
 *     </Popover>
 * ));
 * ```
 *
 * @remarks
 * Carries `Popover.Types` — the East data type and the style struct. The panel
 * body is the children; the anchoring element is the `trigger` prop. Desugars
 * to `Popover.Root(body, options)`.
 */
export const Popover: JsxTag<ContainerProps<typeof PopoverFactory.Root>> & { Types: typeof PopoverFactory.Types } =
    Object.assign(container(PopoverFactory.Root), { Types: PopoverFactory.Types });
