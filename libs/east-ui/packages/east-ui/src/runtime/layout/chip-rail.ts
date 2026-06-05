/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Layout `<ChipRail>` tag — a horizontal rail of chips. Maps to `ChipRail.Root`. */

import { ChipRail as ChipRailFactory, type ChipRailOptions } from "../../layout/chip-rail/index.js";
import { container, type JsxTag } from "../combinators.js";
import type { ContainerChildrenType } from "../children.js";

/** `<ChipRail separator="dot">…chips…</ChipRail>` — horizontal chip rail. Maps to `ChipRail.Root`. */
export const ChipRail: JsxTag<ChipRailOptions & { children?: ContainerChildrenType }> & { Types: typeof ChipRailFactory.Types } =
    Object.assign(container(ChipRailFactory.Root), { Types: ChipRailFactory.Types });
