/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listingTransformCache, listTests, readTestList, selectShard, splitShards, testIdentity, testTimes } from "../../scripts/responsive-shards.js";

test("a listed test is its project, file and title path: the position Playwright prints is not part of it", () => {
    const listed = "[desktop] › flowchart-flows.spec.ts:285:9 › Flowchart flows › pinned open beside the canvas";
    // The same test, listed before Playwright's main thread had the file's source map.
    const unmapped = "[desktop] › flowchart-flows.spec.ts:314:5 › Flowchart flows › pinned open beside the canvas";
    assert.equal(testIdentity(listed), "[desktop] › flowchart-flows.spec.ts › Flowchart flows › pinned open beside the canvas");
    assert.equal(testIdentity(unmapped), testIdentity(listed));
    assert.notEqual(testIdentity(listed.replace("[desktop]", "[mobile]")), testIdentity(listed));
    assert.throws(() => readTestList(`${listed}\n${unmapped}\nTotal: 2 tests in 1 file\n`), /duplicate/);
});

test("jobs split by recorded time: longest first, each to the job with the least so far, a test none was recorded for as the median, each job in listed order", () => {
    const at = (name: string) => `[desktop] › timing.spec.ts:1:1 › ${name}`;
    const timings = Object.fromEntries([["a", 10], ["b", 9], ["c", 4], ["d", 3], ["e", 2], ["skipped", 0]].map(([name, ms]) => [testIdentity(at(name as string)), ms as number]));
    const tests = ["e", "new", "d", "c", "skipped", "b", "a"].map(at);
    // `new` counts as the median of those that ran, 4, and follows c, its tie, by identity: a 10 to the first job,
    // b 9 the second, c the second, `new` the first, d the second, e the first, and the skipped, the jobs level, the first.
    assert.deepEqual(splitShards(tests, 2, timings), [["e", "new", "skipped", "a"].map(at), ["d", "c", "b"].map(at)]);
    assert.deepEqual([1, 2].map(n => selectShard(tests, `${n}/2`, timings)), splitShards(tests, 2, timings));
    assert.equal(testTimes(timings)(at("new")), 4);
    assert.deepEqual(splitShards(tests, 1, timings), [tests], "one job keeps every test, in listed order");
});

test("responsive CI splits the real suite into 24 jobs of equal recorded time, each test in one, and Playwright runs a job's list as it is", () => {
    const tests = listTests();
    assert.ok(tests.length > 0);
    const jobs = Array.from({ length: 24 }, (_, n) => selectShard(tests, `${n + 1}/24`));
    const placed = jobs.flat().map(testIdentity);
    assert.deepEqual([...placed].sort(), tests.map(testIdentity).sort());
    assert.equal(new Set(placed).size, tests.length);
    // Longest first to the least loaded: no job more than the longest test past another.
    const timeOf = testTimes();
    const times = jobs.map(job => job.reduce((sum, test) => sum + timeOf(test), 0));
    assert.ok(Math.max(...times) - Math.min(...times) <= Math.max(...tests.map(timeOf)), `jobs of ${Math.min(...times)} to ${Math.max(...times)} ms`);
    const listed = new Map(tests.map((test, index) => [test, index]));
    for (const job of jobs) assert.deepEqual(job.map(test => listed.get(test)), job.map(test => listed.get(test)).sort((a, b) => a! - b!));
    // Ask Playwright what it would RUN, so a format/parser mismatch cannot
    // silently omit a test or select an entire describe block: every line,
    // listed whole, selects its test, and one job's lines select their tests alone.
    const temporary = mkdtempSync(join(tmpdir(), "east-ui-shards-test-"));
    try {
        const file = join(temporary, "tests.txt");
        writeFileSync(file, tests.join("\n") + "\n");
        assert.deepEqual(listTests([`--test-list=${file}`]).map(testIdentity), tests.map(testIdentity));
        writeFileSync(file, jobs[0]!.join("\n") + "\n");
        assert.deepEqual(listTests([`--test-list=${file}`]).map(testIdentity), jobs[0]!.map(testIdentity));
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
