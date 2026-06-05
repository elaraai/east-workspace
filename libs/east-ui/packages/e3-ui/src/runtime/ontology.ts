/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/** e3 `<Ontology>` tag — economic-ontology editor. Maps to `Ontology.Root`. */

import { optionsTag, type OptionsProps, type JsxTag } from "@elaraai/east-ui";
import { Ontology as OntologyFactory } from "../ontology.js";

/** `<Ontology binding={view.binding} />` — economic-ontology editor. Maps to `Ontology.Root`. */
export const Ontology: JsxTag<OptionsProps<typeof OntologyFactory.Root>> & { Types: typeof OntologyFactory.Types } =
    Object.assign(optionsTag(OntologyFactory.Root), { Types: OntologyFactory.Types });
