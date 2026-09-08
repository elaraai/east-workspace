/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { breakpoint, columnPlan, labelWidth, scrollIntoView, scrollbar, shellLayout } from './layout.js';

describe('layout', () => {
    test('breakpoints: ≥100 wide, 80–99 medium, 60–79 narrow, below 60×16 refuse', () => {
        assert.equal(breakpoint({ columns: 120, rows: 36 }), 'wide');
        assert.equal(breakpoint({ columns: 100, rows: 16 }), 'wide');
        assert.equal(breakpoint({ columns: 99, rows: 36 }), 'medium');
        assert.equal(breakpoint({ columns: 80, rows: 36 }), 'medium');
        assert.equal(breakpoint({ columns: 79, rows: 36 }), 'narrow');
        assert.equal(breakpoint({ columns: 60, rows: 16 }), 'narrow');
        assert.equal(breakpoint({ columns: 59, rows: 36 }), 'refuse');
        assert.equal(breakpoint({ columns: 120, rows: 15 }), 'refuse');
    });

    test('shellLayout gives the body the remainder of a 120×36 frame', () => {
        const plain = shellLayout({ columns: 120, rows: 36 }, { commit: false, completion: 0 });
        assert.deepEqual(plain, { columns: 120, rows: 36, bodyTop: 2, bodyRows: 30, commitRows: 0, completionRows: 0, commandTop: 32, hintRow: 35 });
        const withExtras = shellLayout({ columns: 120, rows: 36 }, { commit: true, completion: 4 });
        assert.equal(withExtras.bodyRows, 24);
        assert.equal(withExtras.commitRows, 2);
        assert.equal(withExtras.completionRows, 4);
        assert.equal(withExtras.commandTop, 32);
        assert.equal(shellLayout({ columns: 120, rows: 36 }, { commit: false, completion: 20 }).completionRows, 8);
        assert.equal(shellLayout({ columns: 60, rows: 5 }, { commit: true, completion: 8 }).bodyRows, 0);
    });

    test('scrollbar thumb size and position follow the design formula', () => {
        assert.equal(scrollbar(10, 5, 10, 0), null);
        assert.deepEqual(scrollbar(24, 1_240_008, 26, 12_000), { thumb: 1, pos: 0 });
        assert.deepEqual(scrollbar(23, 1215, 25, 1190), { thumb: 1, pos: 22 });
        assert.deepEqual(scrollbar(10, 40, 20, 0), { thumb: 5, pos: 0 });
        assert.deepEqual(scrollbar(10, 40, 20, 10), { thumb: 5, pos: 3 });
        assert.deepEqual(scrollbar(10, 40, 20, 20), { thumb: 5, pos: 5 });
        assert.deepEqual(scrollbar(10, 40, 20, 999), { thumb: 5, pos: 5 });
    });

    test('column plans drop secondary columns as the terminal narrows', () => {
        assert.deepEqual(columnPlan('tasks', 'wide').map(c => c.key), ['name', 'status', 'dependsOn', 'inputs', 'output', 'size']);
        assert.deepEqual(columnPlan('tasks', 'medium').map(c => c.key), ['name', 'status', 'dependsOn', 'output', 'size']);
        assert.deepEqual(columnPlan('tasks', 'narrow').map(c => c.key), ['name', 'status', 'output', 'size']);
        assert.deepEqual(columnPlan('inputs', 'narrow').map(c => c.key), ['name', 'status', 'type', 'size']);
        assert.deepEqual(columnPlan('workspaces', 'wide').map(c => c.key), ['name', 'state', 'package', 'tasks', 'lastRun']);
        assert.deepEqual(columnPlan('repos', 'narrow').map(c => c.key), ['name', 'workspaces', 'packages', 'lastDeploy']);
        for (const table of ['tasks', 'inputs', 'workspaces', 'repos', 'runs', 'completion', 'jump'] as const) {
            for (const bp of ['wide', 'medium', 'narrow'] as const) {
                const plan = columnPlan(table, bp);
                assert.equal(plan.filter(c => c.width === 0).length, 1, `${table}/${bp} has one remainder column`);
                assert.equal(plan[plan.length - 1]!.width, 0, `${table}/${bp} remainder is last`);
            }
        }
    });

    test('labelWidth is the design width at 120 columns and bounded elsewhere', () => {
        assert.equal(labelWidth(120), 44);
        assert.equal(labelWidth(80), 26);
        assert.equal(labelWidth(60), 17);
        assert.equal(labelWidth(200), 44);
    });

    test('scrollIntoView keeps the selection inside the window with minimal movement', () => {
        assert.equal(scrollIntoView(0, 5, 10, 100), 0);
        assert.equal(scrollIntoView(0, 12, 10, 100), 3);
        assert.equal(scrollIntoView(50, 40, 10, 100), 40);
        assert.equal(scrollIntoView(95, 99, 10, 100), 90);
        assert.equal(scrollIntoView(0, 0, 10, 5), 0);
        assert.equal(scrollIntoView(3, 4, 0, 10), 3);
    });
});
