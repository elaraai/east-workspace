/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Playwright's contiguous shards put neighboring expensive builder cases in
 * the same job, and shards of equal counts are not of equal time: one took 10
 * minutes where another took 18 (#1466). Split its discovered tests by the
 * times CI recorded instead (`responsive.timings.json`), preserving project
 * filters and using the public --test-list format for execution. A spec file's
 * tests, at a project, go to one job together where they fit: a job's kept page
 * (`tests/responsive/kept-page.ts`) serves them one after another, and loads the
 * showcase once a file. Tests remain independent (fullyParallel); read-only
 * fixture batches stay inside one test.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");

/**
 * A listed test's identity: its project, file and title path, all Playwright
 * matches a --test-list line on. The line and column are no part of it: a
 * list's are ignored, and a listing's can be the transformed file's. Playwright's
 * ESM loader sends each file's source map to the main thread over a port, and a
 * file that runs before it arrives lists every test at an unmapped position.
 */
export function testIdentity(test: string): string {
    return test.replace(/^(\[[^\]]+\] › .+?):\d+:\d+ › /, "$1 › ");
}

/** Read the documented Playwright list format, refusing incomplete discovery. */
export function readTestList(output: string): string[] {
    const plain = stripVTControlCharacters(output);
    const tests = plain.split("\n").map(line => line.trim()).filter(line => /^\[[^\]]+\] › /.test(line));
    const total = /^Total: (\d+) tests? in \d+ files?$/m.exec(plain);
    if (!total || Number(total[1]) !== tests.length || new Set(tests.map(testIdentity)).size !== tests.length) {
        throw new Error("Responsive test discovery was incomplete or contained duplicate tests");
    }
    return tests;
}

let transformCache: string | undefined;

/**
 * The directory this process's listings keep Playwright's transformed files in,
 * removed as the process exits. Every Playwright process otherwise shares one
 * under the system's temporary directory, and Playwright writes each file there
 * in place rather than by a rename: a listing beside another, as the tooling
 * specs' are, can read a file the other has only begun to write, and fail on a
 * module with none of its exports. `PWTEST_CACHE_DIR` is the directory
 * Playwright's compilation cache reads.
 */
export function listingTransformCache(): string {
    if (transformCache === undefined) {
        const directory = mkdtempSync(join(tmpdir(), "east-ui-playwright-cache-"));
        process.once("exit", () => rmSync(directory, { recursive: true, force: true }));
        transformCache = directory;
    }
    return transformCache;
}

/** Discover the actual project-filtered suite without launching a browser. */
export function listTests(args: string[] = []): string[] {
    return readTestList(execFileSync(process.execPath, [cli, "test", ...args, "--list", "--reporter=list"], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, FORCE_COLOR: "0", PLAYWRIGHT_FORCE_TTY: "0", PWTEST_CACHE_DIR: listingTransformCache() },
    }));
}

/**
 * The responsive tests' recorded times, in ms, by their identity
 * ({@link testIdentity}): `responsive.timings.json`, which
 * `scripts/responsive-timings.ts` writes from the reports of a CI run.
 */
const TIMINGS: Readonly<Record<string, number>> = JSON.parse(readFileSync(new URL("../responsive.timings.json", import.meta.url), "utf8")) as Record<string, number>;

/**
 * Each test's share of a job, in ms: its recorded time, or, for a test none
 * was recorded for (a new or a renamed one), the median of those that ran.
 */
export function testTimes(timings: Readonly<Record<string, number>> = TIMINGS): (test: string) => number {
    const ran = Object.values(timings).filter(ms => ms > 0).sort((a, b) => a - b);
    const median = ran.length ? ran[Math.floor(ran.length / 2)]! : 1;
    return test => timings[testIdentity(test)] ?? median;
}

/** A listed test's spec file at its project: the tests a worker's kept page serves one after another. */
export function testFile(test: string): string {
    return /^(\[[^\]]+\] › [^:]+):\d+:\d+ › /.exec(test)?.[1] ?? testIdentity(test);
}

/** A listed test, where it was listed, and its share of a job. */
interface Timed {
    readonly test: string;
    readonly index: number;
    readonly ms: number;
}

/** A run of tests' time. */
const timeOfRun = (run: readonly Timed[]): number => run.reduce((sum, entry) => sum + entry.ms, 0);

/**
 * A run of consecutive tests cut into `parts` runs at most, each ending where
 * the time so far is nearest its share of the whole, none empty.
 */
function cutRun(run: readonly Timed[], parts: number): Timed[][] {
    if (parts <= 1 || run.length <= 1) return [[...run]];
    const whole = timeOfRun(run);
    const runs: Timed[][] = [];
    let current: Timed[] = [];
    let sofar = 0;
    for (const entry of run) {
        const boundary = (whole * (runs.length + 1)) / parts;
        if (current.length > 0 && runs.length < parts - 1 && Math.abs(sofar - boundary) <= Math.abs(sofar + entry.ms - boundary)) {
            runs.push(current);
            current = [];
        }
        current.push(entry);
        sofar += entry.ms;
    }
    runs.push(current);
    return runs;
}

/**
 * Splits the tests into jobs of equal recorded time, a spec file's tests at a
 * project together where they fit. A file of more than a job's share is cut
 * into runs of consecutive tests, and while there are fewer runs than jobs the
 * longest that holds more than one test is cut in two. The runs go longest
 * first, each to the job with the least time so far, ties by their first test's
 * identity, so every job works the same split out. Each job keeps its tests in
 * their listed order.
 */
export function splitShards(tests: readonly string[], total: number, timings?: Readonly<Record<string, number>>): string[][] {
    const timeOf = testTimes(timings);
    const files = new Map<string, Timed[]>();
    for (const [index, test] of tests.entries()) {
        const file = testFile(test);
        const run = files.get(file) ?? [];
        run.push({ test, index, ms: timeOf(test) });
        files.set(file, run);
    }
    const share = tests.reduce((sum, test) => sum + timeOf(test), 0) / total;
    const runs = [...files.values()].flatMap(run => cutRun(run, share > 0 ? Math.ceil(timeOfRun(run) / share) : 1));
    const identity = (run: readonly Timed[]) => testIdentity(run[0]!.test);
    const longestFirst = (a: readonly Timed[], b: readonly Timed[]) =>
        timeOfRun(b) - timeOfRun(a) || (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0);
    while (runs.length < total) {
        const longest = runs.filter(run => run.length > 1).sort(longestFirst)[0];
        if (longest === undefined) break;
        runs.splice(runs.indexOf(longest), 1, ...cutRun(longest, 2));
    }
    const times = Array.from({ length: total }, () => 0);
    const jobs: Timed[][] = Array.from({ length: total }, () => []);
    for (const run of runs.sort(longestFirst)) {
        let least = 0;
        for (let job = 1; job < total; job++) if (times[job]! < times[least]!) least = job;
        times[least]! += timeOfRun(run);
        jobs[least]!.push(...run);
    }
    return jobs.map(job => job.sort((a, b) => a.index - b.index).map(entry => entry.test));
}

/** One job's tests of a split by recorded time ({@link splitShards}), exactly once across the jobs. */
export function selectShard(tests: readonly string[], shard: string, timings?: Readonly<Record<string, number>>): string[] {
    const parts = /^([1-9]\d*)\/([1-9]\d*)$/.exec(shard);
    const current = Number(parts?.[1]);
    const total = Number(parts?.[2]);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current > total) {
        throw new Error(`Invalid responsive shard '${shard}'; expected n/total with 1 <= n <= total`);
    }
    return splitShards(tests, total, timings)[current - 1]!;
}

function main(args: string[]): number {
    const shardArgs = args.filter(arg => arg.startsWith("--shard="));
    if (args.includes("--shard") || shardArgs.length > 1) {
        throw new Error("Specify one responsive shard as --shard=n/total");
    }
    if (!shardArgs.length) return spawnSync(process.execPath, [cli, "test", ...args], { stdio: "inherit" }).status ?? 1;
    const shard = shardArgs[0].slice("--shard=".length);
    // Validate before importing any test files.
    selectShard([], shard);
    const forwarded = args.filter(arg => !arg.startsWith("--shard="));
    const tests = listTests(forwarded);
    const selected = selectShard(tests, shard);
    // Discovery already applied any caller's test list. Execute the shard's
    // narrower list alone, including when the caller used a separate argument.
    const executionArgs: string[] = [];
    for (let i = 0; i < forwarded.length; i++) {
        if (forwarded[i] === "--test-list") { i++; continue; }
        if (!forwarded[i].startsWith("--test-list=")) executionArgs.push(forwarded[i]);
    }
    if (!selected.length) throw new Error(`Responsive shard ${shard} selected no tests`);
    console.log(`Responsive shard ${shard}: ${selected.length} of ${tests.length} tests (split by recorded time)`);
    const temporary = mkdtempSync(join(tmpdir(), "east-ui-responsive-"));
    try {
        const file = join(temporary, "tests.txt");
        writeFileSync(file, selected.join("\n") + "\n");
        return spawnSync(process.execPath, [cli, "test", ...executionArgs, `--test-list=${file}`], { stdio: "inherit" }).status ?? 1;
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
