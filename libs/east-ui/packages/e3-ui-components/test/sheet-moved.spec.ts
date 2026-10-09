/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Sheet moved to e3 (#1179): its IR is e3-ui's (`src/sheet/`) and its
 * renderer this package's (`src/sheet/`), and east-ui and east-ui-components
 * keep nothing of it — only its slot recipe, which stays in the theme. This
 * reads every declaration file east-ui and east-ui-components build — what
 * they publish — and finds no name the Sheet's own modules export that names
 * the Sheet, and no `Sheet` arm in `UIComponentType`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { PACKAGES, code, declarations, exported, files } from './moved.js';

/** Every name the Sheet's own modules export that names the Sheet — e3-ui's IR, and this package's renderer. */
const SHEET_NAMES = new Set([
    ...files(join(PACKAGES, 'e3-ui/src/sheet'), (name) => name.endsWith('.ts')),
    ...files(join(PACKAGES, 'e3-ui-components/src/sheet'), (name) => /\.tsx?$/u.test(name) && !/\.(test|spec)\.|test-utils/u.test(name)),
].flatMap((path) => [...exported(code(readFileSync(path, 'utf8')))].filter((name) => /sheet/iu.test(name))));

test('what the Sheet exports is read whole — its IR\'s names and its renderer\'s', () => {
    for (const name of ['Sheet', 'SheetRootType', 'SheetPayloadType', 'SheetComponent', 'EastChakraSheet', 'SheetValue', 'SheetRootValue', 'SheetMessagesProvider', 'sheetMessages']) {
        assert.ok(SHEET_NAMES.has(name), `the Sheet's ${name} is read`);
    }
});

for (const pkg of ['east-ui', 'east-ui-components']) {
    test(`${pkg}'s declarations declare nothing the Sheet exports (#1179)`, () => {
        const dts = declarations(pkg);
        assert.ok(dts.length > 100, `${pkg} is built — its dist holds its declarations`);
        const found: string[] = [];
        for (const path of dts) {
            for (const name of exported(code(readFileSync(path, 'utf8')))) {
                if (SHEET_NAMES.has(name)) found.push(`${relative(PACKAGES, path)}: ${name}`);
            }
        }
        assert.deepEqual(found, []);
    });
}

test('east-ui\'s UIComponentType has no Sheet arm (#1179)', () => {
    const src = code(readFileSync(join(PACKAGES, 'east-ui/dist/src/component.d.ts'), 'utf8'));
    assert.ok(/\bUIComponentType\b/u.test(src), 'the component type\'s declaration is the one read');
    assert.ok(/[{,;\s]Table\??\s*:/u.test(src), 'an arm reads as a key of the variant');
    assert.equal(/[{,;\s]Sheet\??\s*:/u.test(src), false);
});
