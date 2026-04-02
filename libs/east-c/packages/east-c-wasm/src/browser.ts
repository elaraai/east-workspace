/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/east-c-wasm/browser
 *
 * Browser-compatible loader for east-c-wasm. Uses fetch + dynamic import
 * instead of Node.js APIs.
 */

import {
    type EastWasmModule,
    type EastWasm,
    type EastWasmOptions,
    createEastWasmFromModule,
    createPlatformBridge,
    setHandleResolver,
} from './common.js';

export type { EastWasm, EastWasmOptions, CompiledFunction, EastWasmModule } from './common.js';

/**
 * Load and initialize the WASM module in a browser environment.
 *
 * @param options - Must provide `wasmUrl`. Optionally provide `glueUrl`.
 */
export async function createEastWasmBrowser(options: EastWasmOptions & { wasmUrl: string }): Promise<EastWasm> {
    const wasmUrl = options.wasmUrl;
    const glueUrl = options.glueUrl ?? wasmUrl.replace(/\.wasm$/, '.js');

    const platformFns = new Map();
    const genericCache = new Map();

    let mod: EastWasmModule;

    const bridge = createPlatformBridge(platformFns, genericCache, () => mod);

    const glueModule = await import(/* @vite-ignore */ glueUrl);
    const createModule: (opts?: Record<string, unknown>) => Promise<EastWasmModule> = glueModule.default;

    const moduleOpts: Record<string, unknown> = {
        locateFile(path: string) {
            if (path.endsWith('.wasm')) return wasmUrl;
            return path;
        },
        js_platform_call: bridge,
    };

    mod = await createModule(moduleOpts);

    setHandleResolver(mod);

    return createEastWasmFromModule(mod, { platformFns, genericCache });
}

export default createEastWasmBrowser;
