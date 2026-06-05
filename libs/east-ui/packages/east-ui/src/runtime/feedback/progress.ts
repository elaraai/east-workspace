/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `<Progress>` tag — see the export's JSDoc.
 */

import { Progress as ProgressFactory } from "../../feedback/progress/index.js";
import { leaf, type ValueProps, type JsxTag } from "../combinators.js";

/**
 * Linear progress bar — communicates how far along a long-running operation
 * is, or that one is running at all. Pass `value` (within `min`/`max`) for a
 * determinate bar, or `indeterminate` when the completion fraction is unknown.
 * Supports a label, value text, semantic tones, sizes, striped/animated fills,
 * and an ETA derived from `estimatedDuration` + `startedAt`. The progress
 * value is the `value` prop; every other option is a flat prop
 * ({@link ProgressOptions}).
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/east-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Progress, UIComponentType } from "@elaraai/east-ui";
 *
 * const upload = East.function([], UIComponentType, _$ => (
 *     <Progress value={75.0} label="Upload progress" valueText="75%" tone="pos" />
 * ));
 * ```
 *
 * @remarks
 * Carries `Progress.Types` — the East data type, the style struct, and the
 * visual-preset variant enum. Desugars to `Progress.Root({ value, ...options })`.
 */
export const Progress: JsxTag<ValueProps<typeof ProgressFactory.Root, "value">> & { Types: typeof ProgressFactory.Types } =
    Object.assign(leaf(ProgressFactory.Root, "value"), { Types: ProgressFactory.Types });
