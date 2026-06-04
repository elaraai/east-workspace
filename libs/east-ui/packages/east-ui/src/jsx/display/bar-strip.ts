/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Display `<BarStrip>` tag — compact horizontal bar strip. Maps to `BarStrip.Root`. */

import { BarStrip as BarStripFactory, type BarStripOptions } from "../../display/bar-strip/index.js";
import { leaf, type JsxTag } from "../combinators.js";

/** `<BarStrip items={[…]} orientation="horizontal" />` — bar strip (config-array prop). Maps to `BarStrip.Root`. */
export const BarStrip: JsxTag<BarStripOptions & { items: Parameters<typeof BarStripFactory.Root>[0] }> =
    leaf(BarStripFactory.Root, "items");
