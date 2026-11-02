/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 *
 * Writes `responsive.timings.json`, the times CI's responsive jobs are split
 * by (`responsive-shards.ts`, #1466), from the JSON reports the jobs of a CI
 * run of the whole suite uploaded:
 *
 *     gh run download <run> -p 'responsive-timings-*' -D <dir>
 *     pnpm --filter @elaraai/east-ui-showcase exec tsx scripts/responsive-timings.ts <dir>
 *
 * Each test's time is its last result's duration, keyed by its identity: its
 * project, file and title path, as a listing prints them.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A suite of a JSON report: a file's, its title the file's path from the tests' directory, or a describe block's. */
interface Suite {
    readonly title: string;
    readonly specs?: readonly {
        readonly title: string;
        readonly tests: readonly { readonly projectName: string; readonly results: readonly { readonly duration: number }[] }[];
    }[];
    readonly suites?: readonly Suite[];
}

function reportsIn(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? reportsIn(path) : name.endsWith(".json") ? [path] : [];
    });
}

/** Each test of a suite, with its describe blocks' titles, by identity, into `times`. */
function collect(file: string, suite: Suite, titles: readonly string[], times: Map<string, number>): void {
    for (const spec of suite.specs ?? []) {
        for (const test of spec.tests) {
            times.set(`[${test.projectName}] › ${[file, ...titles, spec.title].join(" › ")}`, Math.max(0, Math.round(test.results.at(-1)?.duration ?? 0)));
        }
    }
    for (const child of suite.suites ?? []) collect(file, child, [...titles, child.title], times);
}

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: tsx scripts/responsive-timings.ts <a directory of the jobs' JSON reports>");
const times = new Map<string, number>();
for (const path of reportsIn(dir)) {
    for (const suite of (JSON.parse(readFileSync(path, "utf8")) as { readonly suites: readonly Suite[] }).suites) collect(suite.title, suite, [], times);
}
if (times.size === 0) throw new Error(`no responsive test's time in the reports under ${dir}`);
const sorted = Object.fromEntries([...times].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(new URL("../responsive.timings.json", import.meta.url), JSON.stringify(sorted, null, 1) + "\n");
console.log(`responsive.timings.json: ${times.size} tests`);
