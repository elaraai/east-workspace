/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** Feedback `<Progress value={…}>` tag — progress bar. Maps to `Progress.Root`. */

import { Progress as ProgressFactory } from "../../feedback/progress/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/** `<Progress value={…}>` — determinate/indeterminate progress bar. Maps to `Progress.Root`. */
export const Progress: JsxTag<ValueProps<typeof ProgressFactory.Root, "value">> & { Types: typeof ProgressFactory.Types } =
    Object.assign(leaf(ProgressFactory.Root, "value"), { Types: ProgressFactory.Types });
