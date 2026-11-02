/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listingTransformCache, listTests, readTestList, selectShard, splitShards, testFile, testIdentity, testTimes } from "../../scripts/responsive-shards.js";

test("a listed test is its project, file and title path: the position Playwright prints is not part of it", () => {
    const listed = "[desktop] › flowchart-flows.spec.ts:285:9 › Flowchart flows › pinned open beside the canvas";
    // The same test, listed before Playwright's main thread had the file's source map.
    const unmapped = "[desktop] › flowchart-flows.spec.ts:314:5 › Flowchart flows › pinned open beside the canvas";
    assert.equal(testIdentity(listed), "[desktop] › flowchart-flows.spec.ts › Flowchart flows › pinned open beside the canvas");
    assert.equal(testIdentity(unmapped), testIdentity(listed));
    assert.notEqual(testIdentity(listed.replace("[desktop]", "[mobile]")), testIdentity(listed));
    assert.throws(() => readTestList(`${listed}\n${unmapped}\nTotal: 2 tests in 1 file\n`), /duplicate/);
});

test("jobs split by recorded time, a spec file's tests at a project together: longest file first, each to the job with the least so far, a test none was recorded for as the median, each job in listed order", () => {
    const at = (file: string, name: string, project = "desktop") => `[${project}] › ${file}.spec.ts:1:1 › ${name}`;
    const timings = Object.fromEntries([
        ["a", "a1", 5], ["a", "a2", 4], ["b", "b1", 4], ["b", "b2", 3], ["b", "b3", 2], ["c", "c1", 6], ["d", "skipped", 0],
    ].map(([file, name, ms]) => [testIdentity(at(file as string, name as string)), ms as number]));
    const tests = [at("a", "a1"), at("b", "b1"), at("a", "a2"), at("c", "c1"), at("b", "b2"), at("d", "new"), at("b", "b3"), at("d", "skipped")];
    assert.equal(testFile(tests[0]!), "[desktop] › a.spec.ts");
    assert.notEqual(testFile(at("a", "a1", "mobile")), testFile(tests[0]!), "a file at another project is another run");
    // `new` counts as the median of those that ran, 4: a 9 to the first job, b 9 the second, c 6 the first, d 4 the second.
    assert.deepEqual(splitShards(tests, 2, timings), [
        [at("a", "a1"), at("a", "a2"), at("c", "c1")],
        [at("b", "b1"), at("b", "b2"), at("d", "new"), at("b", "b3"), at("d", "skipped")],
    ]);
    assert.deepEqual([1, 2].map(n => selectShard(tests, `${n}/2`, timings)), splitShards(tests, 2, timings));
    assert.equal(testTimes(timings)(at("d", "new")), 4);
    assert.deepEqual(splitShards(tests, 1, timings), [tests], "one job keeps every test, in listed order");
});

test("a file of more than a job's share is cut into runs of consecutive tests, and runs are cut while there are fewer than jobs", () => {
    const at = (file: string, name: string) => `[desktop] › ${file}.spec.ts:1:1 › ${name}`;
    const timings = Object.fromEntries([["big", "x1", 6], ["big", "x2", 6], ["big", "x3", 6], ["big", "x4", 6], ["small", "y1", 4]]
        .map(([file, name, ms]) => [testIdentity(at(file as string, name as string)), ms as number]));
    const tests = [at("big", "x1"), at("big", "x2"), at("big", "x3"), at("big", "x4"), at("small", "y1")];
    // A share is 14: big's 24 is cut in two runs of 12, each a job's, and small's 4 goes to the first, the jobs level.
    assert.deepEqual(splitShards(tests, 2, timings), [[at("big", "x1"), at("big", "x2"), at("small", "y1")], [at("big", "x3"), at("big", "x4")]]);
    // Three jobs over two files: the longest run is cut, so no job is empty.
    const three = splitShards([at("big", "x1"), at("big", "x2"), at("small", "y1")], 3, timings);
    assert.deepEqual(three.map(job => job.length), [1, 1, 1]);
});

test("responsive CI splits the real suite into 24 jobs of equal recorded time, each test in one and each file of no more than a job's share in one job, and Playwright runs a job's list as it is", () => {
    const tests = listTests();
    assert.ok(tests.length > 0);
    const jobs = Array.from({ length: 24 }, (_, n) => selectShard(tests, `${n + 1}/24`));
    const placed = jobs.flat().map(testIdentity);
    assert.deepEqual([...placed].sort(), tests.map(testIdentity).sort());
    assert.equal(new Set(placed).size, tests.length);
    // Each file's tests in one job, where the file is no more than a job's share.
    const timeOf = testTimes();
    const share = tests.reduce((sum, test) => sum + timeOf(test), 0) / 24;
    const fileTimes = new Map<string, number>();
    for (const test of tests) fileTimes.set(testFile(test), (fileTimes.get(testFile(test)) ?? 0) + timeOf(test));
    for (const [file, ms] of fileTimes) {
        if (ms <= share) assert.equal(jobs.filter(job => job.some(test => testFile(test) === file)).length, 1, `${file}, ${ms} ms, in one job`);
    }
    // Longest first to the least loaded: no job more than a share and the longest test past another.
    const times = jobs.map(job => job.reduce((sum, test) => sum + timeOf(test), 0));
    assert.ok(Math.max(...times) - Math.min(...times) <= share + Math.max(...tests.map(timeOf)), `jobs of ${Math.min(...times)} to ${Math.max(...times)} ms`);
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
