/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Drawer>` tag — see the export's JSDoc. */

import { Drawer as DrawerFactory } from "../../overlays/drawer/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Imperative `open` + types carried alongside the `<Drawer>` tag. */
type DrawerBuilders = {
    open: typeof DrawerFactory.open;
    Types: typeof DrawerFactory.Types;
};

/**
 * Drawer — a modal panel that slides in from an edge of the screen. Use it for
 * navigation, filters, settings, or a detail view that benefits from more room
 * than a {@link Popover} yet should not take over the page like a centred
 * {@link Dialog}. The body is the children; `placement` chooses the edge it
 * enters from and `size` its extent. An optional title and description form the
 * header; placement, size, and an `onOpenChange` callback are flat props
 * ({@link DrawerOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Button, Drawer, Text, UIComponentType, VStack } from "@elaraai/east-ui";
 *
 * const panel = East.function([], UIComponentType, _$ => (
 *     <Drawer trigger={<Button>Open Drawer</Button>} title="Drawer Title" description="Slide-in panel" placement="end" size="md">
 *         <VStack gap="4">
 *             <Text>This is a drawer panel that slides in from the side.</Text>
 *             <Text color="fg.muted">Great for navigation, settings, or detailed content.</Text>
 *         </VStack>
 *     </Drawer>
 * ));
 * ```
 *
 * @remarks
 * Carries `Drawer.Types` and the imperative `Drawer.open(input)` — a
 * trigger-less programmatic open, called from an `onClick` to raise a drawer
 * built from a `Drawer.Types.OpenInput` value. Desugars to
 * `Drawer.Root(body, options)`.
 */
export const Drawer: JsxTag<ContainerProps<typeof DrawerFactory.Root>> & DrawerBuilders =
    Object.assign(container(DrawerFactory.Root), {
        open: DrawerFactory.open,
        Types: DrawerFactory.Types,
    });
