/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Disclosure JSX tag for {@link CollapsibleFactory | Collapsible} — a single
 * region that expands and collapses behind one trigger. Use it for an inline
 * "Why?" drawer, an optional details block, or any spot where you want to hide
 * supporting content until the reader asks for it.
 */

import { Collapsible as CollapsibleFactory } from "../../disclosure/collapsible/index.js";
import { content, type ContentProps, type JsxTag } from "../combinators.js";

/**
 * Single open/close region behind one trigger. The `trigger` prop is the
 * clickable label (text or any node); the body is the children. Start expanded
 * with `defaultOpen`, drive it from state with `open`, and react to toggles
 * with `onOpenChange`. Remaining options follow `CollapsibleOptions`.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Collapsible, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const why = East.function([], UIComponentType, _$ => (
 *     <Collapsible trigger={<Text color="link">Why did we recommend this?</Text>}>
 *         <Box padding="3" background="bg.subtle">
 *             <Text color="fg.muted">Stage 1 was delayed ~6h due to setpoint drift.</Text>
 *         </Box>
 *     </Collapsible>
 * ));
 * ```
 *
 * @remarks
 * Carries `Collapsible.Types` — the East data type and style struct. Desugars
 * to `Collapsible.Root(content, options)`.
 */
export const Collapsible: JsxTag<ContentProps<typeof CollapsibleFactory.Root>> & { Types: typeof CollapsibleFactory.Types } =
    Object.assign(content(CollapsibleFactory.Root), { Types: CollapsibleFactory.Types });
