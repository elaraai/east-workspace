/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// dist/fonts.spec.js -> package root.
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Distinct `@fontsource-variable/<name>` specifiers referenced in `src`. */
function fontSpecs(src: string): string[] {
    return [...new Set([...src.matchAll(/@fontsource-variable\/[a-z0-9-]+/g)].map(m => m[0]))].sort();
}

// app/main.tsx imports @fontsource directly (the east-ui-components/fonts barrel
// is dropped by the production bundle). Guard against the two lists drifting:
// a mismatch silently renders with fallback fonts.
test('app/main.tsx imports the same brand fonts as east-ui-components/fonts.ts', async () => {
    const canonical = fontSpecs(await readFile(resolve(PKG, '../east-ui-components/src/fonts.ts'), 'utf8'));
    const app = fontSpecs(await readFile(resolve(PKG, 'app/main.tsx'), 'utf8'));
    assert.ok(canonical.length >= 3, 'expected at least 3 brand fonts in east-ui-components/fonts.ts');
    assert.deepEqual(app, canonical);
});

test('package.json devDependencies cover every imported brand font', async () => {
    const app = fontSpecs(await readFile(resolve(PKG, 'app/main.tsx'), 'utf8'));
    const pkg = JSON.parse(await readFile(resolve(PKG, 'package.json'), 'utf8')) as {
        devDependencies?: Record<string, string>;
    };
    const deps = pkg.devDependencies ?? {};
    for (const spec of app) assert.ok(deps[spec], `package.json devDependencies missing "${spec}"`);
});
