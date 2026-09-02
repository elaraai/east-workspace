/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `east-node export-functions` (#628): a module's `eastFunctions` export
 * written as a function manifest that other packages — in TypeScript or
 * python — import with `East.importFunction` / `East.import_function`.
 * The twin of `east-py export-functions`.
 *
 * Every platform function the exported functions call must be implemented
 * by one of the `-p` platform packages, which is recorded as the
 * dependency's provider; a dependency no package provides is an error
 * naming it, so an importer's runner can be checked at its own build.
 */

import { basename, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { East, type FunctionManifest } from '@elaraai/east';
import { loadPlatform } from './loader.js';

/** Options for {@link exportFunctionsFromModule}. */
export interface ExportFunctionsOptions {
    /** The package name importers use (default: the module file's stem). */
    name?: string;
    /** The version recorded in the manifest (default `0.0.0`). */
    version?: string;
    /** Platform packages implementing the functions' platform calls. */
    packages?: string[];
}

/**
 * Loads a module and builds the manifest of its `eastFunctions` export
 * (name → `East.function` result).
 *
 * @param modulePath - Path to the module (a built `.js` / `.mjs`)
 * @param options - Package name, version, and the providing platform packages
 * @returns The manifest value
 * @throws When the module has no `eastFunctions` object, a function is not a
 *   closed value, or a platform dependency has no providing package
 */
export async function exportFunctionsFromModule(modulePath: string, options: ExportFunctionsOptions = {}): Promise<FunctionManifest> {
    const path = resolve(modulePath);
    const mod = await import(pathToFileURL(path).href);
    const functions = mod.eastFunctions;
    if (functions === null || typeof functions !== 'object') {
        throw new Error(`${modulePath} exports no \`eastFunctions\` object (name -> East.function result)`);
    }
    const providers: Record<string, string> = {};
    for (const pkg of options.packages ?? []) {
        for (const fn of await loadPlatform(pkg)) {
            if (!(fn.name in providers)) providers[fn.name] = pkg;
        }
    }
    const missing = new Set<string>();
    for (const fn of Object.values(functions)) {
        for (const dep of East.platformDependencies(fn)) {
            if (!(dep.name in providers)) missing.add(dep.name);
        }
    }
    if (missing.size > 0) {
        throw new Error(
            `platform function(s) no -p package provides: ${[...missing].sort().join(', ')} — ` +
            'pass the implementing package with -p');
    }
    const name = options.name ?? basename(path, extname(path));
    return East.exportFunctions(name, options.version ?? '0.0.0', functions, { providers });
}
