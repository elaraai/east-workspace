/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * How CI's renderer shards split the test files (#1466): by how long each
 * takes, not by how many there are. Vitest's own shards are runs of equal
 * counts, and these files take from under a second to minutes each, so four
 * such shards took 15 to 25 minutes. Each file goes, longest first, to the
 * shard with the least time so far, by the times CI recorded
 * (`vitest.timings.json`, written by `scripts/vitest-timings.ts`); a file with
 * none counts as the median. Every shard works the split out from the same
 * files alike, so together they run each file once.
 */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/** Each test file's recorded time, in milliseconds, by its path from the package. */
const TIMINGS: Readonly<Record<string, number>> = JSON.parse(readFileSync(new URL("./vitest.timings.json", import.meta.url), "utf8")) as Record<string, number>;

/** The time a file with none recorded counts as: the median of those recorded. */
const MEDIAN: number = (() => {
    const times = Object.values(TIMINGS).sort((a, b) => a - b);
    return times.length === 0 ? 1 : times[Math.floor(times.length / 2)]!;
})();

/** Vitest's sequencer, its shards split by recorded time. */
export class TimedSequencer extends BaseSequencer {
    override shard(files: TestSpecification[]): Promise<TestSpecification[]> {
        const shard = this.ctx.config.shard;
        if (shard === undefined) return Promise.resolve(files);
        const timed = files
            .map((file) => {
                const path = relative(this.ctx.config.root, file.moduleId).replaceAll("\\", "/");
                return { file, path, ms: TIMINGS[path] ?? MEDIAN };
            })
            // Longest first, then by path: the same order on every shard.
            .sort((a, b) => b.ms - a.ms || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        const totals: number[] = Array.from({ length: shard.count }, () => 0);
        const placed: TestSpecification[][] = totals.map(() => []);
        for (const { file, ms } of timed) {
            let least = 0;
            for (let i = 1; i < totals.length; i++) if (totals[i]! < totals[least]!) least = i;
            totals[least] = totals[least]! + ms;
            placed[least]!.push(file);
        }
        return Promise.resolve(placed[shard.index - 1] ?? []);
    }
}
