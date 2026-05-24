/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `@elaraai/east-ui-components/platform` — the side-effect-free registry +
 * reactive-tracker plumbing, split out of the main barrel.
 *
 * Pure-logic consumers (e.g. the e3 `Data.bind` runtime) register platform
 * implementations and reactive trackers without pulling in the full component
 * library — which drags in Chakra, overlays, and `react-markdown` (whose
 * transitive `decode-named-character-reference` touches `document` at import).
 * Kept out of the main entry so Node test runners can import it transitively,
 * mirroring the `./fonts` split.
 *
 * @packageDocumentation
 */

export {
    registerPlatformImplementation,
    getRegisteredPlatformImplementations,
} from "./platform/registry.js";

export {
    registerReactiveTracker,
    subscribeTrackers,
    getReactiveTrackers,
    getTrackersVersion,
    type ReactiveTracker,
    type ReactiveTrackerStore,
} from "./reactive/tracker.js";
