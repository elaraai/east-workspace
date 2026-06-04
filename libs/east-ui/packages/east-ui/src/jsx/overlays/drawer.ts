/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Drawer>` tag — edge-sliding panel. Body is the children. Maps to `Drawer.Root`. */

import { Drawer as DrawerFactory } from "../../overlays/drawer/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<Drawer trigger={Button.Root("Open")} title="Navigation" placement="start">…body…</Drawer>` — edge-sliding panel (body is children). Maps to `Drawer.Root`. */
export const Drawer: JsxTag<ContainerProps<typeof DrawerFactory.Root>> = container(DrawerFactory.Root);
