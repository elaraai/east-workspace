/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listingTransformCache, listTests, readTestList, selectShard, testIdentity } from "../../scripts/responsive-shards.js";

test("a listed test is its project, file and title path: the position Playwright prints is not part of it", () => {
    const listed = "[desktop] › flowchart-flows.spec.ts:285:9 › Flowchart flows › pinned open beside the canvas";
    // The same test, listed before Playwright's main thread had the file's source map.
    const unmapped = "[desktop] › flowchart-flows.spec.ts:314:5 › Flowchart flows › pinned open beside the canvas";
    assert.equal(testIdentity(listed), "[desktop] › flowchart-flows.spec.ts › Flowchart flows › pinned open beside the canvas");
    assert.equal(testIdentity(unmapped), testIdentity(listed));
    assert.notEqual(testIdentity(listed.replace("[desktop]", "[mobile]")), testIdentity(listed));
    assert.throws(() => readTestList(`${listed}\n${unmapped}\nTotal: 2 tests in 1 file\n`), /duplicate/);
});

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
            assert.deepEqual(actual.map(testIdentity), selected.map(testIdentity));
            executed.push(...actual.map(testIdentity));
            sizes.push(actual.length);
            // Expensive adjacent Plan cases must not accumulate in one job.
            const plan = tests.filter(t => t.includes("plan-geometry.spec.ts:"));
            const shardPlan = actual.filter(t => t.includes("plan-geometry.spec.ts:"));
            assert.ok(shardPlan.length >= Math.floor(plan.length / 16) - 1);
            assert.ok(shardPlan.length <= Math.ceil(plan.length / 16) + 1);
        }
        assert.deepEqual(executed.sort(), tests.map(testIdentity).sort());
        assert.equal(new Set(executed).size, tests.length);
        assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("a listing keeps Playwright's transformed files in its own process's directory, never the one every Playwright process shares", () => {
    // Shared, a listing beside another can read a file the other is still
    // writing, and fail on a module with none of its exports.
    assert.ok(listTests().length > 0);
    assert.ok(listingTransformCache().startsWith(join(tmpdir(), "east-ui-playwright-cache-")));
    assert.ok(readdirSync(listingTransformCache()).length > 0, "Playwright wrote its transformed files to the listing's own directory");
});

test("invalid shards and incomplete discovery fail closed", () => {
    for (const shard of ["0/8", "9/8", "1/0", "1", "1/8x", "1/9007199254740992"]) {
        assert.throws(() => selectShard([], shard), /Invalid responsive shard/);
    }
    assert.throws(() => readTestList("Total: 2 tests in 1 file\n"), /incomplete/);
    assert.throws(() => readTestList("Listing tests:\n"), /incomplete/);
});
