/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<Meter value={…}>` tag — value meter. Maps to `Meter.Root`. */

import { Meter as MeterFactory } from "../../display/meter/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Meter value={…}>` — value meter (set `max`/`tone`/`thickness`). Maps to `Meter.Root`. */
export const Meter: JsxTag<ValueProps<typeof MeterFactory.Root, "value">> & { Types: typeof MeterFactory.Types } =
    Object.assign(leaf(MeterFactory.Root, "value"), { Types: MeterFactory.Types });
