/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge (render-side, browser-safe).
 *
 * Provides:
 * - `Data.bind` — workspace-scoped reactive dataset binding.
 * - `Diff` — review pending changes for any combination of bindings.
 * - `Ontology` — graph editor over an `OntologyType`-bound dataset.
 * - `DataManifestType` — manifest type for reads/writes metadata.
 *
 * The author-side `ui()` factory lives at `@elaraai/e3-ui/ui` because it
 * pulls in `@elaraai/e3` (which depends on Node-only modules like yazl).
 * Separating it keeps this entry tree-shakeable for browser bundles.
 *
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
