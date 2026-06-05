/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Overlay `<HoverCard>` tag — rich hover preview. Body is the children. Maps to `HoverCard.Root`. */

import { HoverCard as HoverCardFactory } from "../../overlays/hover-card/index.js";
import { container, type ContainerProps, type JsxTag } from "../combinators.js";

/** `<HoverCard trigger={Text.Root("@user")} openDelay={200n}>…preview…</HoverCard>` — hover preview panel (body is children). Maps to `HoverCard.Root`. */
export const HoverCard: JsxTag<ContainerProps<typeof HoverCardFactory.Root>> & { Types: typeof HoverCardFactory.Types } =
    Object.assign(container(HoverCardFactory.Root), { Types: HoverCardFactory.Types });
