/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Experiment>` tag — see the export's JSDoc. */

import { type StructType } from "@elaraai/east";
import { optionsTag, type UIElement } from "@elaraai/east-ui";
import { Experiment as ExperimentFactory, type ExperimentOptions } from "../experiment/index.js";

/**
 * Interactive causal-experiment surface — binds an input dataset + a staged spec
 * + estimator functions and renders a picture-and-colour answer to *"did
 * {treatment} change {outcome}?"*.
 *
 * Generic over the bound dataset's row struct (like `<Table>`): `Row` is
 * inferred from `data`, which types the `estimate` / `refute` / `dose` function
 * signatures. The result side is derived, not authored — status words, the
 * sign-flip banner and the bars are computed from the bound numbers; only the
 * column names the user picked appear as text.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Experiment, Func } from "@elaraai/e3-ui";
 *
 * const surface = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const data     = $.let(Data.bind(batchesInput));
 *         const spec     = $.let(Data.bind(specInput, { mode: "staged" }));
 *         const estimate = $.let(Func.bind(estimateFn));
 *         return <Experiment data={data} spec={spec} estimate={estimate} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Experiment.Types` (the spec / result / refute / dose / journal value
 * types). Desugars to `Experiment.Root(options)`. The renderer registers against
 * `Experiment.Component` (from `@elaraai/e3-ui/internal`).
 */
/** The generic `<Experiment>` tag: `Row` is inferred from the `data` prop. */
export type ExperimentTag = {
    <Row extends StructType>(props: ExperimentOptions<Row>): UIElement;
    Types: typeof ExperimentFactory.Types;
};

export const Experiment: ExperimentTag = Object.assign(
    optionsTag(ExperimentFactory.Root as (options: ExperimentOptions<StructType>) => UIElement),
    { Types: ExperimentFactory.Types },
) as unknown as ExperimentTag;
