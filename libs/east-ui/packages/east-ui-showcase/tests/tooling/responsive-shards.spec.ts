/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listTests, readTestList, selectShard } from "../../scripts/responsive-shards.js";

test("responsive CI lists execute the entire real suite exactly once across 16 balanced shards", () => {
    const tests = listTests();
    assert.ok(tests.length > 0);
    const temporary = mkdtempSync(join(tmpdir(), "east-ui-shards-test-"));
    try {
        const executed: string[] = [];
        const sizes: number[] = [];
        for (let n = 1; n <= 16; n++) {
            const selected = selectShard(tests, `${n}/16`);
            const file = join(temporary, `${n}.txt`);
            writeFileSync(file, selected.join("\n") + "\n");
            // Ask Playwright what it would RUN, so a format/parser mismatch
            // cannot silently omit a test or select an entire describe block.
            const actual = listTests([`--test-list=${file}`]);
            assert.deepEqual(actual, selected);
            executed.push(...actual);
            sizes.push(actual.length);
            // Expensive adjacent Plan cases must not accumulate in one job.
            const plan = tests.filter(t => t.includes("plan-geometry.spec.ts:"));
            const shardPlan = actual.filter(t => t.includes("plan-geometry.spec.ts:"));
            assert.ok(shardPlan.length >= Math.floor(plan.length / 16) - 1);
            assert.ok(shardPlan.length <= Math.ceil(plan.length / 16) + 1);
        }
        assert.deepEqual(executed.sort(), [...tests].sort());
        assert.equal(new Set(executed).size, tests.length);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("invalid shards and incomplete discovery fail closed", () => {
    for (const shard of ["0/8", "9/8", "1/0", "1", "1/8x", "1/9007199254740992"]) {
        assert.throws(() => selectShard([], shard), /Invalid responsive shard/);
    }
    assert.throws(() => readTestList("Total: 2 tests in 1 file\n"), /incomplete/);
    assert.throws(() => readTestList("Listing tests:\n"), /incomplete/);
});
