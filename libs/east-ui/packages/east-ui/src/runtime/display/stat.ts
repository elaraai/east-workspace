/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Stat>` tag — key-metric tile (no children). Maps to `Stat.Root`. */

import { Stat as StatFactory, type StatStyle } from "../../display/stat/index.js";
import { optionsTag, type JsxTag } from "../combinators.js";

/** `<Stat label="Revenue" value="$45,231" indicator={{ direction: "up", sentiment: "positive" }} />` — metric tile. Maps to `Stat.Root`. */
export const Stat: JsxTag<StatStyle> & { Types: typeof StatFactory.Types } =
    Object.assign(optionsTag(StatFactory.Root), { Types: StatFactory.Types });
