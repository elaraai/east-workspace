/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The store — a reducer over {@link TuiState} with subscriptions, plus the
 * React binding (`useStore(selector)` via `useSyncExternalStore`).
 *
 * @packageDocumentation
 */

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Action, TuiState } from './actions.js';
import { reduce } from './reducer.js';

/** The store. */
export interface Store {
    getState(): TuiState;
    dispatch(action: Action): void;
    subscribe(listener: () => void): () => void;
}

/**
 * Creates a store.
 *
 * @param initial - The initial state
 * @param reducer - The reducer (default: {@link reduce})
 * @returns The store
 */
export function createStore(initial: TuiState, reducer: (state: TuiState, action: Action) => TuiState = reduce): Store {
    let state = initial;
    const listeners = new Set<() => void>();
    let notifying = false;
    let pending = false;
    const notify = (): void => {
        // Re-entrant dispatches (a listener dispatching) collapse into one
        // trailing notification so every listener sees the final state.
        if (notifying) {
            pending = true;
            return;
        }
        notifying = true;
        try {
            do {
                pending = false;
                for (const listener of [...listeners]) listener();
            } while (pending);
        } finally {
            notifying = false;
        }
    };
    return {
        getState: () => state,
        dispatch(action) {
            const next = reducer(state, action);
            if (next === state) return;
            state = next;
            notify();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}

/** The store context. */
export const StoreContext = createContext<Store | null>(null);

/**
 * Reads the store.
 *
 * @returns The store from context
 * @throws {Error} Outside a `StoreContext.Provider`
 */
export function useStoreInstance(): Store {
    const store = useContext(StoreContext);
    if (store === null) throw new Error('useStore: no StoreContext.Provider above this component');
    return store;
}

/**
 * Subscribes to a slice of the state.
 *
 * @typeParam T - The selected value (compared by identity)
 * @param selector - Selects the value from the state
 * @returns The selected value
 */
export function useStore<T>(selector: (state: TuiState) => T): T {
    const store = useStoreInstance();
    return useSyncExternalStore(store.subscribe, () => selector(store.getState()), () => selector(store.getState()));
}
