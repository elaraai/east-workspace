/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Experiment>` tag — see the export's JSDoc. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { Experiment as ExperimentFactory } from "../experiment.js";

/**
 * Causal-experiment surface — renders bound result datasets (effect / refute /
 * dose) as a picture-and-colour answer to *"did {treatment} change {outcome}?"*.
 *
 * The result side is derived, not authored: status words and the sign-flip
 * banner are computed from the bound numbers; only the column names the user
 * picked appear as text.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Experiment } from "@elaraai/e3-ui";
 *
 * const surface = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const spec   = $.let(Data.bind(specInput, { mode: "staged" }));
 *         const answer = $.let(Data.bind(answerInput));
 *         return <Experiment spec={spec} answer={answer} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Experiment.Types` (the spec / answer / refute / dose / journal value
 * types). Desugars to `Experiment.Root(options)`. The renderer registers
 * against `Experiment.Component` (from `@elaraai/e3-ui/internal`).
 */
export const Experiment: JsxTag<OptionsProps<typeof ExperimentFactory.Root>> & { Types: typeof ExperimentFactory.Types } =
    Object.assign(optionsTag(ExperimentFactory.Root), { Types: ExperimentFactory.Types });
