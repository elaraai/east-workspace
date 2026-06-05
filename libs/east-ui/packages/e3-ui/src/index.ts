/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/e3-ui — e3 + UI bridge.
 *
 * The public surface is the e3-specific JSX **tags** plus the platform
 * helpers:
 * - `<Diff>` — review pending changes for any combination of bindings.
 * - `<Ontology>` — graph editor over an `OntologyType`-bound dataset.
 * - `Data.bind` — workspace-scoped reactive dataset binding.
 * - `ui()` — declare a first-class UI task.
 *
 * east-ui tags (`<VStack>`, `<Text>`, …) are imported from `@elaraai/east-ui`
 * — this package does not re-export them. The underlying factories
 * (`Diff.Root(…)`) live under `@elaraai/e3-ui/internal` for renderers and tests.
 *
 * @remarks
 * `ui()` pulls in `@elaraai/e3` (Node-only). Browser bundles that only need
 * `Data` / `<Diff>` / `<Ontology>` / types should import from
 * `@elaraai/e3-ui/internal`, which is e3-free.
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
export { ui } from './ui.js';

// e3 `<Diff>` tag + its types
export { Diff } from './runtime/diff.js';
export {
    DiffPayloadType,
    DiffStyleType,
    type DiffOptions,
} from './diff.js';

// e3 `<Ontology>` tag + its types
export { Ontology } from './runtime/ontology.js';
export {
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
