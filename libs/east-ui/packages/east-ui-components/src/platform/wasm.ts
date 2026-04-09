/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * WASM backend for beast2 decoding.
 *
 * @remarks
 * Provides optional east-c-wasm integration for faster beast2 decoding.
 * Falls back to the TypeScript decoder if the WASM module is unavailable.
 *
 * @packageDocumentation
 */

import { useEffect, type ReactNode } from "react";
import {
    type EastTypeValue,
    decodeBeast2For,
} from "@elaraai/east";
import type { PlatformFunction } from "@elaraai/east/internal";

// Use a type-only import — the actual module is loaded dynamically
type EastWasm = import("@elaraai/east-c-wasm/common").EastWasm;

let instance: EastWasm | null = null;
let initPromise: Promise<EastWasm | null> | null = null;
let failed = false;

/**
 * Get the WASM decoder instance, initializing on first call.
 *
 * @remarks
 * Returns `null` if `@elaraai/east-c-wasm` is not installed or fails to load.
 * The result is cached — subsequent calls return immediately.
 */
export async function getWasm(): Promise<EastWasm | null> {
    if (failed) return null;
    if (instance) return instance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const url = getWasmUrl();
            console.log("[east-wasm] loading from", url);
            const t0 = performance.now();
            const { createEastWasmBrowser } = await import("@elaraai/east-c-wasm/browser");
            instance = await createEastWasmBrowser({ wasmUrl: url });
            console.log(`[east-wasm] ready in ${(performance.now() - t0).toFixed(0)}ms`);
            return instance;
        } catch (e) {
            failed = true;
            console.log("[east-wasm] unavailable, using TypeScript decoder", e instanceof Error ? e.message : e);
            return null;
        }
    })();

    return initPromise;
}

/**
 * Get the WASM decoder instance synchronously.
 *
 * @returns The cached instance, or `null` if not yet initialized or unavailable.
 */
export function getWasmSync(): EastWasm | null {
    return instance;
}

/**
 * Decode a beast2 data value, using the WASM decoder if available.
 *
 * @param wasm - The WASM instance (or null for TS fallback)
 * @param bytes - Beast2-encoded bytes
 * @param type - The East type (used only for TS fallback)
 * @param options - Options for the TS fallback decoder
 * @returns The decoded JS value
 */
export function decodeBeast2Value(
    wasm: EastWasm | null,
    bytes: Uint8Array,
    type: EastTypeValue,
    options?: { platform?: PlatformFunction[] },
): unknown {
    const backend = wasm ? "wasm" : "ts";
    const t0 = performance.now();
    try {
        const result = wasm
            ? wasm.decodeBeast2(bytes, options?.platform)
            : decodeBeast2For(type, options)(bytes);
        const ms = performance.now() - t0;
        console.log(`[east-decode] ${backend} ${(bytes.length / 1024).toFixed(1)}KB in ${ms.toFixed(1)}ms`);
        return result;
    } catch (e) {
        try {
            const msg = e instanceof Error ? e.message : String(e);
            const typeStr = JSON.stringify(type, (_k, v) => typeof v === "bigint" ? `${v}n` : v);
            const header = bytes ? Array.from(bytes.subarray(0, Math.min(16, bytes.length))).map(b => b.toString(16).padStart(2, "0")).join(" ") : "n/a";
            console.error(`[east-decode] ${backend} decode failed: ${msg}\n  type: ${typeStr}\n  bytes: ${bytes?.length ?? "?"}\n  header: [${header}]`);
        } catch { /* don't mask the original error */ }
        throw e;
    }
}

/**
 * Provider that initializes the WASM backend on mount.
 *
 * @remarks
 * Wrap your app in this provider to enable WASM-accelerated beast2 decoding.
 * All decode sites automatically pick up the WASM instance via `getWasmSync()`.
 * If WASM is unavailable, decoding transparently falls back to TypeScript.
 *
 * @example
 * ```tsx
 * <EastWasmProvider>
 *     <App />
 * </EastWasmProvider>
 * ```
 */
export function EastWasmProvider({ children }: { children: ReactNode }): ReactNode {
    useEffect(() => void getWasm(), []);
    return children;
}

function getWasmUrl(): string {
    // Extension webview: served as extension asset via webviewUri
    // Standalone app: served from public/ or CDN
    return (globalThis as any).__EAST_WASM_URL__ ?? "./east-c.wasm";
}
