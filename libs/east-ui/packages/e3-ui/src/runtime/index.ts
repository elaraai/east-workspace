/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * e3-ui JSX tags — every east-ui tag (re-exported) plus the e3-specific
 * `<Diff>` and `<Ontology>` components, so one import from `@elaraai/e3-ui/jsx`
 * wires the whole authoring surface.
 *
 * @packageDocumentation
 */

export * from "@elaraai/east-ui/jsx";
export { Diff } from "./diff.js";
export { Ontology } from "./ontology.js";
