/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * One emotion cache for every renderer: `@emotion/react` is one module the renderer packages and Chakra share, never a
 * copy each bundles. Bundled, a package holds a cache context of its own, so the class it makes ahead of a gesture
 * (`useSlotClass`, #1594) is inserted in a cache Chakra's elements never read, and the first element drawn with those
 * styles inserts the rule again, in the frame the drag began. This reads what east-ui-components and this package build
 * — what they publish: each imports `@emotion/react`, and neither holds emotion's own code for the context.
 * (The showcase's `builder-first-drag.spec.ts` holds what that gives a page.)
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/** Where the UI packages sit, side by side. */
const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

/** The ES modules a package builds, by name. */
function built(pkg: string): { name: string; src: string }[] {
    const dist = join(PACKAGES, pkg, 'dist');
    return readdirSync(dist).filter((name) => name.endsWith('.js'))
        .map((name) => ({ name, src: readFileSync(join(dist, name), 'utf8') }));
}

/** An import of emotion's module — the one every package shares. */
const IMPORTS_EMOTION = /\bfrom\s*["']@emotion\/react["']/u;
/** Emotion's own code for the context: where it is defined, bundled. */
const DEFINES_CONTEXT = /\bEmotionCacheContext\b/u;

for (const pkg of ['east-ui-components', 'e3-ui-components']) {
    test(`${pkg} imports emotion's cache context, and bundles no copy of it`, () => {
        const modules = built(pkg);
        assert.ok(modules.length > 0, `${pkg} is built — its dist holds its modules`);
        assert.ok(modules.some((m) => IMPORTS_EMOTION.test(m.src)), `${pkg} reads the cache through @emotion/react`);
        assert.deepEqual(modules.filter((m) => DEFINES_CONTEXT.test(m.src)).map((m) => m.name), []);
    });
}

test('the reader tells an import of the module from its bundled code', () => {
    assert.ok(IMPORTS_EMOTION.test('import { __unsafe_useEmotionCache } from "@emotion/react";'));
    assert.ok(IMPORTS_EMOTION.test("import{Global}from'@emotion/react'"));
    assert.equal(IMPORTS_EMOTION.test('// see @emotion/react'), false);
    assert.ok(DEFINES_CONTEXT.test('var EmotionCacheContext = /* @__PURE__ */ React.createContext(null);'));
    assert.equal(DEFINES_CONTEXT.test('const useEmotionCacheContextual = 1;'), false);
});
