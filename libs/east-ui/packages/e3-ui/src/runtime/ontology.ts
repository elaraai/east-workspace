/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** `<Ontology>` tag — see the export's JSDoc. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { Ontology as OntologyFactory } from "../ontology.js";

/**
 * Economic-ontology editor — renders an `OntologyType`-bound dataset as a
 * graph canvas with node/link mutation surfaces wired through the binding.
 * `readonly` hides the mutation affordances; `density` tightens the layout.
 *
 * @example
 * ```tsx
 * // .tsx file with the `@jsxImportSource @elaraai/e3-ui` pragma
 * import { East } from "@elaraai/east";
 * import { Reactive, UIComponentType } from "@elaraai/east-ui";
 * import { Data, Ontology, OntologyType } from "@elaraai/e3-ui";
 *
 * const editor = East.function([], UIComponentType, _$ => (
 *     <Reactive>{$ => {
 *         const view = $.let(Data.bind(ontologyInput));
 *         return <Ontology value={view} />;
 *     }}</Reactive>
 * ));
 * ```
 *
 * @remarks
 * Carries `Ontology.Types` (the graph value, node/link structs, kind enums,
 * payload + style types). Desugars to `Ontology.Root(options)`. The renderer
 * registers against `Ontology.Component` (from `@elaraai/e3-ui/internal`).
 */
export const Ontology: JsxTag<OptionsProps<typeof OntologyFactory.Root>> & { Types: typeof OntologyFactory.Types } =
    Object.assign(optionsTag(OntologyFactory.Root), { Types: OntologyFactory.Types });
