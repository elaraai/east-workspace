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
 * thing it feeds — a `<Library>` drag-source beside a drop target (a Board, or
 * e3-ui's `<Plan.View>`),
 * a filter rail beside a board — so the board grows while the panel is stowed
 * and the drop-target is never covered.
 *
 * Expanded, it is `expandedSize` along the axis and has no header strip: its
 * one row is a tab row — its `tabs`, each with its own body, or the `label` as
 * the only tab over the children — with the collapse control at its end.
 * Collapsed, it shrinks to `railSize`: the expand control, then the `icon` in
 * its tile, any `badge`, the `label` and any `detail` — what the pane shows
 * now, such as an inspector's selected tile; while the pane is `active` the
 * tile and the badge are brand, else the detail reads muted. `surface="shell"` drops its own
 * panel for the rule along its inner edge, for a pane inside a host's frame.
 * Drive it from state with `collapsed` + `onCollapsedChange`, or omit both for
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
 *         <Dock icon="book" label="Bookings" badge="3" expandedSize="25%" tabs={[
 *             { key: "open", label: "Open", body: [<Box padding="3"><Text>Drag source…</Text></Box>] },
 *             { key: "done", label: "Done", body: [<Box padding="3"><Text>Booked</Text></Box>] },
 *         ]} />
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
