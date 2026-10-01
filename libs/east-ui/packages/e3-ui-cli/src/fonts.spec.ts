/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The shot app registers the brand faces the way every app does — one import
 * of `@elaraai/east-ui-components/fonts` — and its build ships them (#1090).
 * Read after `npm run build`, which the test script runs first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// dist/fonts.spec.js -> package root.
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every face the entry registers, as `<family> <style>`. */
const FACES = [
    'DM Sans Variable normal',
    'Inter Tight Variable normal',
    'JetBrains Mono Variable italic',
    'JetBrains Mono Variable normal',
];

/** The family and style of each `@font-face` rule in `css` — distinct, sorted. */
function fontFaces(css: string): string[] {
    const faces = new Set<string>();
    for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const family = /font-family:\s*([^;]+)/.exec(body!)?.[1]?.trim().replace(/^["']|["']$/g, '');
        const style = /font-style:\s*([^;]+)/.exec(body!)?.[1]?.trim() ?? 'normal';
        if (family !== undefined) faces.add(`${family} ${style}`);
    }
    return [...faces].sort();
}

test('app/main.tsx registers the brand faces through @elaraai/east-ui-components/fonts, importing no fontsource package itself', async () => {
    const src = await readFile(resolve(PKG, 'app/main.tsx'), 'utf8');
    assert.match(src, /^import ['"]@elaraai\/east-ui-components\/fonts['"];$/m);
    assert.deepEqual([...src.matchAll(/@fontsource-variable\/[a-z0-9-]+/g)].map(m => m[0]), []);
});

test('the built app\'s CSS holds every brand face', async () => {
    const assets = resolve(PKG, 'dist/app/assets');
    const sheets = (await readdir(assets)).filter(f => f.endsWith('.css'));
    const css = await Promise.all(sheets.map(f => readFile(join(assets, f), 'utf8')));
    assert.deepEqual(fontFaces(css.join('\n')), FACES, `dist/app/assets (${sheets.join(', ')}) holds these faces`);
});
