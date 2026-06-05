/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Internal exports — the `Diff` / `Ontology` **factories** (`Diff.Root(…)`,
 * `Diff.Component`) plus `Data`, manifest helpers and types.
 *
 * @remarks
 * The public `@elaraai/e3-ui` entry exports JSX **tags** (and `ui()`, which
 * pulls in Node-only `@elaraai/e3`). This entry is e3-free and is what the
 * renderer (`e3-ui-components`) and the in-repo specs import — they build /
 * inspect IR directly via the factories and the `*.Component` carriers.
 *
 * @internal
 * @packageDocumentation
 */

export {
    Data,
    DataBindModeType,
    type DataBindModeLiteral,
    DiffBindingType,
    DataBindHandleType,
    type DataBindOptions,
    bindPlatformFn,
} from './data.js';
export { DataManifestType, type DataManifest, encodeManifest, decodeManifest } from './manifest.js';
export { deriveManifest } from './derive.js';
export {
    Diff,
    DiffComponent,
    DiffPayloadType,
    DiffStyleType,
    type DiffOptions,
} from './diff.js';
export {
    Ontology,
    OntologyComponent,
    OntologyPayloadType,
    OntologyStyleType,
    type OntologyOptions,
    NodeKindType,
    LinkKindType,
    NodeType,
    LinkType,
    OntologyMetadataType,
    OntologyType,
} from './ontology.js';
