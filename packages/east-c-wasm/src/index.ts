/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * @elaraai/east-c-wasm
 *
 * WASM backend for executing East IR. Compile IR to callable functions
 * with native JS values in and out.
 *
 * This is the Node.js entry point. For browser usage, import from
 * `@elaraai/east-c-wasm/browser`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    type EastWasmModule,
    type EastWasm,
    type EastWasmOptions,
    createEastWasmFromModule,
    createPlatformBridge,
    setHandleResolver,
} from './common.js';

export type { CompiledFunction, EastWasm, EastWasmOptions, EastWasmModule } from './common.js';
export { createEastWasmFromModule } from './common.js';

/**
 * Load and initialize the WASM module (Node.js).
 */
export async function createEastWasm(options?: EastWasmOptions): Promise<EastWasm> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const wasmDir = join(__dirname, '..', 'wasm');

    const gluePath = options?.glueUrl ?? join(wasmDir, 'east-c.js');
    const glueModule = await import(gluePath);
    const createModule = glueModule.default as (opts?: Record<string, unknown>) => Promise<EastWasmModule>;

    const wasmPath = options?.wasmUrl ?? join(wasmDir, 'east-c.wasm');

    // Internal platform registry — shared between bridge and API
    const platformFns = new Map();
    const genericCache = new Map();

    let mod: EastWasmModule;

    const bridge = createPlatformBridge(platformFns, genericCache, () => mod);

    const moduleOpts: Record<string, unknown> = {
        locateFile(path: string) {
            if (path.endsWith('.wasm')) return wasmPath;
            return path;
        },
        js_platform_call: bridge,
    };

    mod = await createModule(moduleOpts);

    setHandleResolver(mod);

    return createEastWasmFromModule(mod, { platformFns, genericCache });
}

export default createEastWasm;
