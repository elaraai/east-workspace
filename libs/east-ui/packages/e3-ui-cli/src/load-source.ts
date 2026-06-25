/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Load an East UI function from a TypeScript/TSX source file — without writing
 * any temp files.
 *
 * esbuild transpiles + bundles the entry IN MEMORY, then it is executed via a
 * `data:` URL `import()`. Bare `@elaraai/*` (and other package) imports are
 * resolved from the source file to absolute `file://` URLs and kept external,
 * so the East runtime the source imports is the SAME instance this CLI encodes
 * with (single-instance type identity matters for IR serialization) and nothing
 * is ever written to disk. JSX is forced to the automatic `@elaraai/east-ui`
 * runtime, matching how east-ui components are authored.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as esbuild from 'esbuild';

/** Minimal shape of an East function — anything carrying a `toIR()`. East
 *  functions are callable, so they are `typeof === 'function'`, not 'object'. */
export interface EastFunctionLike {
    toIR(): unknown;
}

/** An exported `example({ fn })` definition wrapping an East function. */
interface ExampleDefLike {
    fn: EastFunctionLike;
}

function hasToIR(x: unknown): x is EastFunctionLike {
    return (typeof x === 'function' || (typeof x === 'object' && x !== null))
        && typeof (x as { toIR?: unknown }).toIR === 'function';
}

function isExampleDef(x: unknown): x is ExampleDefLike {
    return typeof x === 'object' && x !== null && hasToIR((x as { fn?: unknown }).fn);
}

/** Pull the East function out of an export (a bare fn, or an `example()` def). */
function asEastFunction(value: unknown): EastFunctionLike | null {
    if (hasToIR(value)) return value;
    if (isExampleDef(value)) return value.fn;
    return null;
}

/**
 * esbuild plugin: keep every bare (package) import external, resolved from its
 * importer to an absolute `file://` URL so the `data:`-URL bundle can load it
 * with Node's own resolver (preserving a single `@elaraai/east` instance).
 * Relative/absolute source imports are bundled normally.
 */
const externalizeBareImports: esbuild.Plugin = {
    name: 'externalize-bare-imports',
    setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
            if (args.kind === 'entry-point') return null;
            const spec = args.path;
            if (spec.startsWith('node:')) return { path: spec, external: true };
            if (spec.startsWith('.') || path.isAbsolute(spec)) return null; // bundle source files
            // Bare package import → resolve from the importer, externalize.
            try {
                const resolved = createRequire(args.importer).resolve(spec);
                return { path: pathToFileURL(resolved).href, external: true };
            } catch {
                return null; // let esbuild surface the resolution error
            }
        });
    },
};

/**
 * Transpile, execute, and extract an East UI function from a `.ts`/`.tsx` source.
 *
 * @param filePath - Path to the source file
 * @param exportName - Named export to render; when omitted, falls back to the
 *   `default` export, then to the sole renderable export
 * @returns The East function (carrying `toIR()`)
 * @throws If the file produces no renderable export, or `exportName` is absent
 *   or not renderable
 */
export async function loadComponentFromSource(
    filePath: string,
    exportName?: string,
): Promise<EastFunctionLike> {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Source file not found: ${absolutePath}`);
    }

    const result = await esbuild.build({
        entryPoints: [absolutePath],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        jsx: 'automatic',
        jsxImportSource: '@elaraai/east-ui',
        plugins: [externalizeBareImports],
        logLevel: 'silent',
    });

    const code = result.outputFiles?.[0]?.text;
    if (!code) {
        throw new Error(`esbuild produced no output for ${filePath}`);
    }

    let moduleExports: Record<string, unknown>;
    try {
        const dataUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
        moduleExports = await import(dataUrl) as Record<string, unknown>;
    } catch (err) {
        throw new Error(
            `Failed to execute ${path.basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    if (exportName !== undefined) {
        const fn = asEastFunction(moduleExports[exportName]);
        if (!fn) {
            const available = renderableExportNames(moduleExports);
            throw new Error(
                `Export "${exportName}" is not a renderable East UI function in ${path.basename(filePath)}.` +
                (available.length ? ` Available: ${available.join(', ')}` : ' No renderable exports found.'),
            );
        }
        return fn;
    }

    const fromDefault = asEastFunction(moduleExports['default']);
    if (fromDefault) return fromDefault;

    const renderable = Object.entries(moduleExports)
        .map(([name, value]) => [name, asEastFunction(value)] as const)
        .filter((e): e is readonly [string, EastFunctionLike] => e[1] !== null);

    if (renderable.length === 1) return renderable[0]![1];
    if (renderable.length === 0) {
        throw new Error(
            `No renderable East UI function found in ${path.basename(filePath)}. ` +
            `Export a default East function returning a UIComponentType (or an example({ fn })).`,
        );
    }
    throw new Error(
        `Multiple renderable exports in ${path.basename(filePath)} — pass --export <name>. ` +
        `Available: ${renderable.map(([n]) => n).join(', ')}`,
    );
}

function renderableExportNames(moduleExports: Record<string, unknown>): string[] {
    return Object.entries(moduleExports)
        .filter(([, value]) => asEastFunction(value) !== null)
        .map(([name]) => name);
}
