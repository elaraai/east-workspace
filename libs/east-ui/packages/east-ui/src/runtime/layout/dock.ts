/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Dock>` tag — see the export's JSDoc.
 */

import { Dock as DockFactory } from "../../layout/dock/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/**
 * An inline panel that collapses along one axis to a compact icon rail and
 * expands back to its children, without leaving the document flow — siblings
 * reflow to reclaim the freed space; it never overlays. The in-flow,
 * collapse-to-rail sibling of `<Expandable>` (which instead fills the app
 * container). Reach for it when a source panel should tuck away beside the
 * thing it feeds — a `<Library>` drag-source beside a `<Plan>` drop-target,
 * a filter rail beside a board — so the board grows while the panel is stowed
 * and the drop-target is never covered.
 *
 * Collapsed, it shrinks to `railSize` and shows the `icon`, a chevron toggle
 * (pointing away from `side`), and any `badge`; `label` becomes the rail's
 * accessible name. Expanded, it is `expandedSize` along the axis with a header
 * (`icon` + `label` + `badge` + collapse chevron) above the children. Drive it
 * from state with `collapsed` + `onCollapsedChange`, or omit both for
 * uncontrolled toggling — optionally `persist`ed across reloads. It is an
 * ordinary flex child: place it in a `<Flex>` / `<HStack>` (horizontal) or
 * `<VStack>` (vertical) whose sibling is `flex="1" minWidth="0"`. Arbitrarily
 * nestable. Esc does NOT collapse it (it's inline content, not a modal).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Box, Dock, HStack, Text, UIComponentType } from "@elaraai/east-ui";
 *
 * const board = East.function([], UIComponentType, _$ => (
 *     <HStack gap="4" width="100%">
 *         <Dock icon="book" label="Bookings" expandedSize="25%">
 *             <Box padding="3" background="bg.surface"><Text>Drag source…</Text></Box>
 *         </Dock>
 *         <Box flex="1" minWidth="0"><Text>Board / drop target…</Text></Box>
 *     </HStack>
 * ));
 * ```
 *
 * @remarks
 * Carries `Dock.Types` — the East data type and config struct. Desugars to
 * `Dock.Root(children, options)`.
 */
export const Dock: JsxTag<ContainerProps<typeof DockFactory.Root>> & { Types: typeof DockFactory.Types } =
    Object.assign(container(DockFactory.Root), { Types: DockFactory.Types });
