/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic moved to e3 (#1384): its IR is e3-ui's (`src/schematic/`) and
 * its renderer this package's (`src/schematic/`), and east-ui and
 * east-ui-components keep nothing of it — only its slot recipe, which stays in
 * the theme. This reads every declaration file east-ui and east-ui-components
 * build — what they publish — and finds no name the Schematic's own modules
 * export, no name of the Schematic's but its recipe's, and no `Schematic` arm
 * in `UIComponentType`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { PACKAGES, code, declarations, exported, files } from './moved.js';

/** Every name the Schematic's own modules export that names the Schematic — e3-ui's IR, and this package's renderer. */
const SCHEMATIC_NAMES = new Set([
    ...files(join(PACKAGES, 'e3-ui/src/schematic'), (name) => name.endsWith('.ts')),
    ...files(join(PACKAGES, 'e3-ui-components/src/schematic'), (name) => /\.tsx?$/u.test(name) && !/\.(test|spec)\.|test-utils/u.test(name)),
].flatMap((path) => [...exported(code(readFileSync(path, 'utf8')))].filter((name) => /schematic/iu.test(name))));

/** What the theme keeps of the Schematic: its slot recipe, by the file it is declared in. */
const THEME_KEEPS = ['east-ui-components/dist/theme/slot-recipes/schematic.d.ts: schematicSlotRecipe'];

test('what the Schematic exports is read whole — its IR\'s names and its renderer\'s', () => {
    for (const name of ['Schematic', 'SchematicPayloadType', 'SchematicComponent', 'SchematicTag', 'SchematicTypes', 'SchematicShapes',
        'SchematicProps', 'SchematicItemType', 'SchematicLinkType', 'SchematicNetType', 'SchematicNarrowedType', 'SchematicDrawnItemType',
        'SchematicDataReader', 'EastChakraSchematic', 'EastChakraSchematicProps', 'SchematicValue', 'SchematicPalette', 'SchematicProbe',
        'SchematicCanvas', 'SchematicFooter', 'useSchematicToolbarItems', 'SchematicMessages']) {
        assert.ok(SCHEMATIC_NAMES.has(name), `the Schematic's ${name} is read`);
    }
});

for (const pkg of ['east-ui', 'east-ui-components']) {
    test(`${pkg}'s declarations declare nothing the Schematic exports (#1384)`, () => {
        const dts = declarations(pkg);
        assert.ok(dts.length > 100, `${pkg} is built — its dist holds its declarations`);
        const found: string[] = [];
        for (const path of dts) {
            for (const name of exported(code(readFileSync(path, 'utf8')))) {
                if (SCHEMATIC_NAMES.has(name)) found.push(`${relative(PACKAGES, path)}: ${name}`);
            }
        }
        assert.deepEqual(found, []);
    });
}

test('east-ui and east-ui-components export nothing of the Schematic but its slot recipe (#1384)', () => {
    const named = (pkg: string): string[] => declarations(pkg).flatMap((path) =>
        [...exported(code(readFileSync(path, 'utf8')))].filter((name) => /schematic/iu.test(name)).map((name) => `${relative(PACKAGES, path)}: ${name}`));
    assert.deepEqual(named('east-ui'), []);
    // The recipe is the theme's, beside every other component's — and only it.
    assert.deepEqual(named('east-ui-components').sort(), [...THEME_KEEPS].sort());
});

test('east-ui\'s UIComponentType has no Schematic arm (#1384)', () => {
    const src = code(readFileSync(join(PACKAGES, 'east-ui/dist/src/component.d.ts'), 'utf8'));
    assert.ok(/\bUIComponentType\b/u.test(src), 'the component type\'s declaration is the one read');
    assert.ok(/[{,;\s]Table\??\s*:/u.test(src), 'an arm reads as a key of the variant');
    assert.equal(/[{,;\s]Schematic\??\s*:/u.test(src), false);
});
