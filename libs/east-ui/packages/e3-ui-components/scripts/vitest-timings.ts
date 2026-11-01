/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Writes `vitest.timings.json`, the times CI's renderer shards are split by
 * (`vitest.sequencer.ts`, #1466), from the Vitest JSON reports a CI run's
 * renderer shards uploaded:
 *
 *     gh run download <run> -p 'renderer-timings-*' -D <dir>
 *     pnpm --filter @elaraai/e3-ui-components exec tsx scripts/vitest-timings.ts <dir>
 *
 * Each test file's time is its report's end less its start, keyed by its path
 * from the package.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the reports say of each test file: its path where it ran, and when it started and ended. */
interface Report {
    readonly testResults: readonly { readonly name: string; readonly startTime: number; readonly endTime: number }[];
}

/** The package's directory in a path a runner reported. */
const PACKAGE = "/libs/east-ui/packages/e3-ui-components/";

function reportsIn(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? reportsIn(path) : name.endsWith(".json") ? [path] : [];
    });
}

const dir = process.argv[2];
if (dir === undefined) throw new Error("usage: tsx scripts/vitest-timings.ts <a directory of the shards' JSON reports>");
const times = new Map<string, number>();
for (const path of reportsIn(dir)) {
    for (const result of (JSON.parse(readFileSync(path, "utf8")) as Report).testResults) {
        const name = result.name.replaceAll("\\", "/");
        const at = name.lastIndexOf(PACKAGE);
        if (at < 0) continue;
        times.set(name.slice(at + PACKAGE.length), Math.max(0, Math.round(result.endTime - result.startTime)));
    }
}
if (times.size === 0) throw new Error(`no renderer test file's time in the reports under ${dir}`);
const sorted = Object.fromEntries([...times].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
writeFileSync(new URL("../vitest.timings.json", import.meta.url), JSON.stringify(sorted, null, 1) + "\n");
console.log(`vitest.timings.json: ${times.size} test files`);
