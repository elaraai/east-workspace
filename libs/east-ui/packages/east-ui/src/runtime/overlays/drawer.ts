/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Drawer>` tag — edge-sliding panel. Body is the children. Maps to `Drawer.Root`. */

import { Drawer as DrawerFactory } from "../../overlays/drawer/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** Imperative `open` + types carried alongside the `<Drawer>` tag. */
type DrawerBuilders = {
    open: typeof DrawerFactory.open;
    Types: typeof DrawerFactory.Types;
};

/**
 * `<Drawer trigger={Button.Root("Open")} title="Navigation" placement="start">…body…</Drawer>`
 * — edge-sliding panel (body is children). Maps to `Drawer.Root`. The imperative
 * `Drawer.open(...)` (no-trigger programmatic open) and `Drawer.Types` are
 * carried through.
 */
export const Drawer: JsxTag<ContainerProps<typeof DrawerFactory.Root>> & DrawerBuilders =
    Object.assign(container(DrawerFactory.Root), {
        open: DrawerFactory.open,
        Types: DrawerFactory.Types,
    });
