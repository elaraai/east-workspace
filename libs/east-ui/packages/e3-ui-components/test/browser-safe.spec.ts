/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Browser-safety regression guard (issue #99).
 *
 * Two browser-reachable surfaces must never pull the Node-only `@elaraai/e3` SDK
 * (whose `sha256` / `export` modules import `node:fs` / `node:crypto` / `yazl`)
 * into a browser bundle:
 *
 *   1. `@elaraai/e3-ui-components` — the React renderer. The leak that motivated
 *      this guard was a single renderer module importing the bare `@elaraai/e3-ui`
 *      barrel (which re-exports `ui()`) instead of the e3-free
 *      `@elaraai/e3-ui/internal` entry.
 *   2. The `@elaraai/e3-ui` **main barrel** itself. It legitimately exports `ui()`
 *      (an authoring builder that calls `task()`); `ui.ts` imports `task` from the
 *      browser-safe `@elaraai/e3/browser` subpath, NOT the main `@elaraai/e3`
 *      barrel, so reaching `ui()` must not drag `node:fs` in.
 *
 * Each case is esbuild-bundled for `platform: 'browser'` and fails if the resolved
 * graph reaches the bare `@elaraai/e3` package (or `yazl`, which only ships inside
 * its Node IO). The companion eslint `no-restricted-imports` rule blocks the
 * specific renderer mistake at author time; this guard catches ANY path that
 * re-introduces the Node taint into a browser bundle, regardless of how.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const rel = (p: string) => (p ? path.relative(PKG_DIR, p) || p : '<entry>');

/**
 * Bundle for the browser and return the list of Node-taint resolutions reached
 * (`@elaraai/e3` bare, or `yazl`). All Node builtins + non-JS assets are stubbed
 * so an unrelated isomorphic dependency or CSS import can't hard-error the build —
 * we assert only on the `@elaraai/e3` / `yazl` taint.
 */
async function nodeLeaksOf(entry: esbuild.BuildOptions): Promise<string[]> {
    const leaks: string[] = [];
    const stub = (args: esbuild.OnResolveArgs) => ({ path: args.path, external: true });
    await esbuild.build({
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        logLevel: 'silent',
        ...entry,
        plugins: [{
            name: 'e3-99-node-taint-guard',
            setup(build) {
                // The Node-flavored SDK itself — its '.' entry re-exports sha256/export.
                build.onResolve({ filter: /^@elaraai\/e3$/ }, (args) => {
                    leaks.push(`@elaraai/e3  <-  ${rel(args.importer)}`);
                    return stub(args);
                });
                // yazl ships only inside @elaraai/e3's Node IO, so reaching it is the taint too.
                build.onResolve({ filter: /^yazl$/ }, (args) => {
                    leaks.push(`yazl  <-  ${rel(args.importer)}`);
                    return stub(args);
                });
                // Stub every Node builtin so an unrelated isomorphic dependency can't
                // hard-error the browser build — we assert only on the taint recorded above.
                build.onResolve({ filter: /^node:/ }, stub);
                build.onResolve({
                    filter: /^(fs|fs\/promises|path|os|crypto|stream|stream\/promises|util|events|zlib|buffer|child_process|assert|tty|net|http|https|url|module|worker_threads)$/,
                }, stub);
                // Neutralize non-JS asset imports (CSS, vite `?inline`/`?url`/`?raw`
                // queries, images) — irrelevant to the node-taint resolution graph and
                // otherwise un-bundleable here without an output path/loader.
                build.onResolve({ filter: /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?)(\?.*)?$/ }, stub);
                build.onResolve({ filter: /\?(inline|url|raw)$/ }, stub);
            },
        }],
    });
    return leaks;
}

test('@elaraai/e3-ui-components bundles for the browser without pulling Node-only @elaraai/e3 (issue #99)', async () => {
    const leaks = await nodeLeaksOf({ entryPoints: [path.join(PKG_DIR, 'src', 'index.ts')] });
    assert.deepEqual(
        leaks,
        [],
        `Browser bundle of @elaraai/e3-ui-components reached Node-only modules:\n  ${leaks.join('\n  ')}\n` +
        `Import the e3-free '@elaraai/e3-ui/internal' entry from renderers, never the bare '@elaraai/e3-ui' barrel.`,
    );
});

test('the @elaraai/e3-ui main barrel is browser-safe — ui() must not drag in @elaraai/e3 node IO (issue #99)', async () => {
    const leaks = await nodeLeaksOf({
        stdin: { contents: 'export * from "@elaraai/e3-ui";', resolveDir: PKG_DIR, loader: 'ts' },
    });
    assert.deepEqual(
        leaks,
        [],
        `Browser bundle of the @elaraai/e3-ui main barrel reached Node-only modules:\n  ${leaks.join('\n  ')}\n` +
        `ui() must import 'task' from the browser-safe '@elaraai/e3/browser' subpath, not the bare '@elaraai/e3' barrel.`,
    );
});
