/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<Popover>` tag — floating panel. Body is the children. Maps to `Popover.Root`. */

import { Popover as PopoverFactory } from "../../overlays/popover/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<Popover trigger={Button.Root("Edit")} title="Edit Profile">…body…</Popover>` — floating click panel (body is children). Maps to `Popover.Root`. */
export const Popover: JsxTag<ContainerProps<typeof PopoverFactory.Root>> & { Types: typeof PopoverFactory.Types } =
    Object.assign(container(PopoverFactory.Root), { Types: PopoverFactory.Types });
