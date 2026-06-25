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

// Node-safe platform utilities (DOM-free), exposed here so pure-logic handle
// runtimes — the e3 `Data.bind` / `Decision.bind` runtimes — can register and use
// them WITHOUT importing the main component barrel (which touches `document` at
// import via Chakra / overlays / react-markdown). The `./platform/index.js` graph
// is impl + store only; clipboard / download / share touch the DOM only inside
// their call-time impl bodies, never at module load.
export {
    StateImpl,
    StateRuntime,
    NavImpl,
    SliceImpl,
    SliceApplyImpl,
    buildSliceHandle,
    DEFAULT_SLICE_STATE,
} from "./platform/index.js";
export {
    UIStore,
    createUIStore,
    type UIStoreInterface,
} from "./platform/state-store.js";
export { getSomeorUndefined } from "./utils.js";
