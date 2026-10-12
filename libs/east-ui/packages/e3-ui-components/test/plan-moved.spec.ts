/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Plan moved to e3 (#1177): its IR is e3-ui's (`src/plan/`) and its
 * renderer this package's (`src/plan/`), and east-ui and east-ui-components
 * keep nothing of it — only its slot recipes, which stay in the theme. This
 * reads every declaration file east-ui and east-ui-components build — what
 * they publish — and finds no name the Plan's own modules export that names
 * the Plan, and no `Plan` arm in `UIComponentType`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { PACKAGES, code, declarations, exported, files } from './moved.js';

/** Every name the Plan's own modules export that names the Plan — e3-ui's IR, and this package's renderer. */
const PLAN_NAMES = new Set([
    ...files(join(PACKAGES, 'e3-ui/src/plan'), (name) => name.endsWith('.ts')),
    ...files(join(PACKAGES, 'e3-ui-components/src/plan'), (name) => /\.tsx?$/u.test(name) && !/\.(test|spec)\.|test-utils/u.test(name)),
].flatMap((path) => [...exported(code(readFileSync(path, 'utf8')))].filter((name) => /plan/iu.test(name))));

test('what the Plan exports is read whole — its IR\'s names and its renderer\'s', () => {
    for (const name of ['Plan', 'PlanRootType', 'PlanPayloadType', 'PlanComponent', 'PlanTag', 'EastChakraPlan', 'EastChakraPlanPayload',
        'PlanRootValue', 'PlanValue', 'PlanMessagesProvider', 'planMessages']) {
        assert.ok(PLAN_NAMES.has(name), `the Plan's ${name} is read`);
    }
});

for (const pkg of ['east-ui', 'east-ui-components']) {
    test(`${pkg}'s declarations declare nothing the Plan exports (#1177)`, () => {
        const dts = declarations(pkg);
        assert.ok(dts.length > 100, `${pkg} is built — its dist holds its declarations`);
        const found: string[] = [];
        for (const path of dts) {
            for (const name of exported(code(readFileSync(path, 'utf8')))) {
                if (PLAN_NAMES.has(name)) found.push(`${relative(PACKAGES, path)}: ${name}`);
            }
        }
        assert.deepEqual(found, []);
    });
}

test('east-ui\'s UIComponentType has no Plan arm (#1177)', () => {
    const src = code(readFileSync(join(PACKAGES, 'east-ui/dist/src/component.d.ts'), 'utf8'));
    assert.ok(/\bUIComponentType\b/u.test(src), 'the component type\'s declaration is the one read');
    assert.ok(/[{,;\s]Table\??\s*:/u.test(src), 'an arm reads as a key of the variant');
    assert.equal(/[{,;\s]Plan\??\s*:/u.test(src), false);
});

test('the reader sees an exported declaration and an export list, and nothing in a comment', () => {
    const names = exported(code([
        'export declare const PlanThing: number;',
        'export interface PlanShape { a: string }',
        'declare function planHelper(): void;',
        'export { planHelper, type PlanAlias as PlanRenamed };',
        '/** export declare const PlanInProse: number; */',
        '// export type PlanInALineComment = string;',
    ].join('\n')));
    assert.deepEqual([...names].sort(), ['PlanRenamed', 'PlanShape', 'PlanThing', 'planHelper']);
});
