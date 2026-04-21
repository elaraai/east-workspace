/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Platform implementation registry — pluggable platform functions for IR compilation.
 *
 * Each platform module (State, Data, Overlay, etc.) registers its implementations.
 * EastFunction uses all registered implementations when compiling IR.
 *
 * @packageDocumentation
 */

import type { PlatformFunction } from "@elaraai/east/internal";

let platformFunctions: PlatformFunction[] = [];

/**
 * Register platform function implementations.
 * Returns an unregister function.
 */
export function registerPlatformImplementation(impls: PlatformFunction[]): () => void {
    platformFunctions = [...platformFunctions, ...impls];
    // eslint-disable-next-line no-console
    console.log('[registry.register]', impls.map(i => i.name), 'total:', platformFunctions.map(p => p.name));
    return () => {
        platformFunctions = platformFunctions.filter(f => !impls.includes(f));
    };
}

/**
 * Get all registered platform implementations for IR compilation.
 */
export function getRegisteredPlatformImplementations(): PlatformFunction[] {
    // eslint-disable-next-line no-console
    console.log('[registry.read]', platformFunctions.map(p => p.name));
    return platformFunctions;
}
