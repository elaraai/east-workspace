/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Helpers for wrapping east-ui example modules as e3 packages.
 *
 * Each category file in this directory bundles an `@elaraai/east-ui/examples/*`
 * barrel into a UI-task-per-example package. Hand-listing each example name
 * drifts from the upstream barrel; these helpers iterate the barrel instead.
 */

import e3 from '@elaraai/e3';
import { ui } from '@elaraai/e3-ui';

import type { Runner } from '@elaraai/e3';

/** Default runner used for every showcase task. */
export const DEFAULT_RUNNER: Runner = { runtime: 'east-c', platforms: ['east-c-std'] };

/** Root directory for exported zips. Override per call if needed. */
export const DEFAULT_OUT_DIR = '/tmp/east-ui-showcase';

/** An entry in an `examples.*` barrel — only `fn` is required here. */
export interface ExampleLike {
    fn: unknown;
}

/** camelCase → snake_case (e.g. `lineMultiSeries` → `line_multi_series`). */
export function toSnakeCase(name: string): string {
    return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

export interface BuildOptions {
    /** Runner passed to every ui() task. Defaults to DEFAULT_RUNNER. */
    runner?: Runner;
    /** Explicit camelCase → task-name overrides (bypasses toSnakeCase). */
    rename?: Record<string, string>;
    /** Examples to exclude from the package. */
    skip?: readonly string[];
    /** Directory the exported zip is written to. Defaults to DEFAULT_OUT_DIR. */
    outDir?: string;
    /**
     * Extra package members (e3.input, pre-built tasks) prepended to the
     * generated `ui()` calls. Used when a barrel also re-exports inputs.
     */
    extras?: readonly unknown[];
}

function hasFn(x: unknown): x is ExampleLike {
    return typeof x === "object" && x !== null && "fn" in x;
}

/**
 * Turn an examples barrel into an array of `ui()` tasks. Task names come from
 * `opts.rename` if present, otherwise `toSnakeCase(camelName)`. Barrel entries
 * without a `.fn` property (e.g. `e3.input` re-exports) are skipped
 * automatically so callers only pass them via `opts.extras`.
 */
export function tasksFromExamples(
    examples: Record<string, unknown>,
    opts: BuildOptions = {},
) {
    const runner = opts.runner ?? DEFAULT_RUNNER;
    const skip = new Set(opts.skip ?? []);
    return Object.entries(examples)
        .filter(([name, ex]) => !skip.has(name) && hasFn(ex))
        .map(([name, ex]) =>
            ui(opts.rename?.[name] ?? toSnakeCase(name), [], (ex as ExampleLike).fn as never, { runner }),
        );
}

/**
 * Build and export a showcase category package. Returns the package so callers
 * can `export default` it.
 *
 *     const pkg = await buildShowcasePackage('charts', pkgInfo.version, examples);
 *     export default pkg;
 */
export async function buildShowcasePackage(
    category: string,
    version: string,
    examples: Record<string, unknown>,
    opts: BuildOptions = {},
) {
    const outDir = opts.outDir ?? DEFAULT_OUT_DIR;
    const pkg = e3.package(
        `east-ui-showcase-${category}`,
        version,
        ...(opts.extras ?? []) as never[],
        ...tasksFromExamples(examples, opts),
    );
    await e3.export(pkg, `${outDir}/${category}.zip`);
    return pkg;
}
