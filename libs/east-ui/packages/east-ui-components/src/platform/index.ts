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

// WASM backend (optional)
export {
    EastWasmProvider,
    getWasm,
    getWasmSync,
    decodeBeast2Value,
} from "./wasm.js";

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

// =============================================================================
// StateRuntime Namespace
// =============================================================================

import {
    StateImpl,
    getStore,
    initializeStore,
} from "./state-runtime.js";

export const StateRuntime = {
    Implementation: StateImpl,
    getStore,
    initializeStore,
} as const;
