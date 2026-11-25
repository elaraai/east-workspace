/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-nested lab's generator (#1710): writes the works record's first state — as many works as it is asked for,
 * each made by `generateWorks` over five years — to a beast2 file, which `e3 seed` commits as the record's `$init`.
 *
 * Usage: `tsx generate.ts <out.beast2> <works>`
 *
 * The works are written as they are made, one at a time, through the beast2 element writer, so a file of thousands
 * holds one segment in memory at once. The same count writes the same works every time.
 *
 * @packageDocumentation
 */

import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { Beast2ElementWriter, East } from "@elaraai/east";
import { generateWorks } from "./generator.ts";
import { FIRST_WORKS, LabWorksByKey, WORKS_WEEKS } from "./types.ts";

const [out, count] = process.argv.slice(2);
if (out === undefined || count === undefined || !/^\d+$/.test(count)) {
    console.error("usage: tsx generate.ts <out.beast2> <works>");
    process.exit(2);
}
const total = Number(count);

const works = East.compile(generateWorks, []);
const began = performance.now();
const fd = openSync(out, "w");
const writer = new Beast2ElementWriter(LabWorksByKey, (bytes) => { writeSync(fd, bytes); });
let items = 0;
for (let n = 0; n < total; n++) {
    const made = works(BigInt(n), WORKS_WEEKS);
    // What the nested series index files of it: its jobs, alarms and load, its crews' hours, and its parts' jobs.
    let crewHours = 0;
    for (const crew of made.crews.values()) crewHours += crew.hours.size;
    let partJobs = 0;
    const stack = [...made.parts.values()];
    for (let part = stack.pop(); part !== undefined; part = stack.pop()) {
        partJobs += part.jobs.size;
        stack.push(...part.parts.values());
    }
    items += made.jobs.size + made.alarms.size + made.load.size + crewHours + partJobs;
    writer.add([`W-${BigInt(n) + FIRST_WORKS}`, made]);
    if ((n + 1) % 100 === 0) console.log(`${(n + 1).toLocaleString("en")} works, ${items.toLocaleString("en")} items, ${((performance.now() - began) / 1000).toFixed(0)} s`);
}
writer.finish();
closeSync(fd);
const seconds = (performance.now() - began) / 1000;
console.log(`${out}: ${total.toLocaleString("en")} works, ${items.toLocaleString("en")} items, ` +
    `${(statSync(out).size / 1e6).toFixed(0)} MB, ${seconds.toFixed(0)} s`);
