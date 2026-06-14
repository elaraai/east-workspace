/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Diff>` tag — see the export's JSDoc. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { Diff as DiffFactory } from "../diff/index.js";

/**
 * Change-review panel — surfaces every bound dataset's in-flight change in a
 * single card with per-leaf accept / reject and a footer Apply. Pass the
 * bindings to review; `hideUnchanged` collapses leaves with no pending change.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East, FloatType, some } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Diff } from "@elaraai/e3-ui";
 *
 * const review = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const view = $.let(Data.bind(maxHoursInput));
 *         return <Diff bindings={[view.binding]} hideUnchanged={some(true)} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Diff.Types` (the payload + style East types). Desugars to
 * `Diff.Root(options)`. The renderer registers against `Diff.Component`
 * (available from `@elaraai/e3-ui/internal`).
 */
export const Diff: JsxTag<OptionsProps<typeof DiffFactory.Root>> & { Types: typeof DiffFactory.Types } =
    Object.assign(optionsTag(DiffFactory.Root), { Types: DiffFactory.Types });
