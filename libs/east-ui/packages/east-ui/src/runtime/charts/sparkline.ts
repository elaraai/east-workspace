/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Chart `<Sparkline data={…}>` tag — compact inline trend. Maps to `Sparkline.Root`. */

import { Sparkline as SparklineFactory } from "../../charts/sparkline/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Sparkline data={…}>` — compact inline trend line/area. Maps to `Sparkline.Root`. */
export const Sparkline: JsxTag<ValueProps<typeof SparklineFactory.Root, "data">> =
    leaf(SparklineFactory.Root, "data");
