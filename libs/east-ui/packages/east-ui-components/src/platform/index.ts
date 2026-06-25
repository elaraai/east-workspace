/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * East UI Platform — State management runtime for East UI applications.
 *
 * @packageDocumentation
 */

// Store types and classes
export {
    UIStore,
    createUIStore,
    type UIStoreInterface,
    type UIStoreOptions,
    PersistentUIStore,
    createPersistentUIStore,
} from "./state-store.js";

// State runtime implementations
export {
    StateImpl,
    getStore,
    initializeStore,
    enableTracking,
    disableTracking,
    isTracking,
    trackKey,
} from "./state-runtime.js";

// Navigation (nav_bind) runtime implementation — registers on load.
export { NavImpl } from "./nav/index.js";

// React hooks and components for State
export {
    UIStoreProvider,
    type UIStoreProviderProps,
    useUIStore,
    useUIStoreSubscription,
    useUIState,
    useUIKey,
    useUIWrite,
    useUIBatch,
    EastComponent,
    type EastComponentProps,
    EastFunction,
    type EastFunctionProps,
} from "./state-hooks.js";
export {
    EncodedEastFunction,
    type EncodedEastFunctionProps,
} from "./encoded-east-function.js";

// Hotkey — invisible keydown listener primitive
export {
    EastChakraHotkey,
    type HotkeyValue,
    type EastChakraHotkeyProps,
} from "./hotkey/index.js";

// Clipboard — fire-and-forget text copy
export { ClipboardImpl } from "./clipboard/index.js";

// Download — browser file downloads
export { DownloadImpl } from "./download/index.js";

// Share — OS share sheet with clipboard fallback
export { ShareImpl } from "./share/index.js";

// Slice — stateful narrowing platform (bind) + pure apply engine
export { SliceImpl, SliceApplyImpl, buildSliceHandle, DEFAULT_SLICE_STATE, boundRangeDomain } from "./slice/index.js";

// =============================================================================
// StateRuntime Namespace
// =============================================================================

import {
    StateImpl,
    getStore,
    initializeStore,
    trackKey,
} from "./state-runtime.js";

export const StateRuntime = {
    Implementation: StateImpl,
    getStore,
    initializeStore,
    trackKey,
} as const;
