/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-scale lab's generator (#1710): writes the jobs record's first state — as many print jobs as it is asked for,
 * spread over the lab's presses and five years — to a beast2 file, which `e3 seed` commits as the record's `$init`.
 *
 * Usage: `tsx generate.ts <out.beast2> <jobs>`
 *
 * The jobs are written as they are made, a segment at a time, through the beast2 element writer — the Writer whose
 * segments e3 takes in — so a file of tens of millions holds one segment in memory at once. Each press's jobs follow
 * one another and never overlap, on quarter hours: most a shift long or less, some a day or two, a few up to three
 * days. Those before the lab's now are done, those across it running, those in the fortnight after it confirmed and
 * the rest estimated; two hundred more wait in the backlog, with no start, no end and no press. The same count writes
 * the same jobs every time.
 *
 * @packageDocumentation
 */

import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { Beast2ElementWriter, none, some, variant } from "@elaraai/east";
import { LAB_FIRST_PRESS, LAB_FROM, LAB_NOW, LAB_PRESSES, LAB_TO, LabJobs } from "./types.ts";

const [out, count] = process.argv.slice(2);
if (out === undefined || count === undefined || !/^\d+$/.test(count)) {
    console.error("usage: tsx generate.ts <out.beast2> <jobs>");
    process.exit(2);
}
const total = Number(count);

/** A quarter hour, the step every start and end stands on. */
const QUARTER = 15 * 60_000;
const HOUR = 4 * QUARTER;
const DAY = 24 * HOUR;
/** The jobs waiting in the backlog, after the scheduled ones. */
const BACKLOG = 200;

const KINDS = [
    "Brochure run", "Catalogue", "Event posters", "Menu cards", "Annual report", "Magazine run", "Store flyers",
    "Ticket books", "Wall calendars", "Course handbooks", "Gift boxes", "Timetables", "Museum guide", "Seed catalogue",
    "Tour brochure", "Order forms", "Prospectus", "Exhibition book", "Price list", "Trade catalogue",
];
const CUSTOMERS = [
    "Alder & Finch", "Larkspur Home", "Driftwood Museum", "Elmway College", "Granite Hall", "Copperleaf Cafe",
    "Foxglove Gardens", "Bluewater Tours", "Harbour Arts Society", "Juniper Toys", "Northwind Outfitters",
    "Meridian Monthly", "Heathfield Theatre", "Hollybank Books", "Saltmarsh Press Club", "Wrenfield Council",
];

/**
 * A seeded stream of numbers in [0, 1) — mulberry32 — so a count writes the same jobs every time.
 *
 * @param seed - Where the stream starts
 * @returns The next number at each call
 */
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const random = seeded(1_710);
const presses = Number(LAB_PRESSES);
const firstPress = Number(LAB_FIRST_PRESS);
const from = LAB_FROM.getTime();
const span = LAB_TO.getTime() - from;
const now = LAB_NOW.getTime();
const began = performance.now();

const fd = openSync(out, "w");
const writer = new Beast2ElementWriter(LabJobs, (bytes) => { writeSync(fd, bytes); });
let n = 0;
for (let p = 0; p < presses; p++) {
    const press = `P-${p + firstPress}`;
    // The count shared out: the first presses take one more each where it does not divide.
    const onPress = Math.floor(total / presses) + (p < total % presses ? 1 : 0);
    // Each job has a slot of the span to itself, and runs inside it, so a press's jobs never overlap.
    const slot = span / onPress;
    for (let j = 0; j < onPress; j++) {
        const kind = random();
        const hours = kind < 0.7 ? 2 + random() * 10 : kind < 0.95 ? 12 + random() * 24 : 36 + random() * 36;
        const length = Math.min(hours * HOUR, slot * 0.9);
        const opens = from + j * slot + random() * (slot - length);
        // On quarter hours: its start the one at or after where it opens, its end the one at or before where it
        // closes — inside its slot — and a quarter hour at least.
        const start = Math.ceil(opens / QUARTER) * QUARTER;
        const end = Math.max(start + QUARTER, Math.floor((opens + length) / QUARTER) * QUARTER);
        const stock = random();
        n += 1;
        writer.add([`J-${n.toString().padStart(8, "0")}`, {
            title: KINDS[Math.floor(random() * KINDS.length)]!,
            start: some(new Date(start)),
            end: some(new Date(end)),
            press: some(press),
            state: end <= now ? variant("actual", null)
                : start <= now ? variant("in-progress", null)
                    : start < now + 14 * DAY ? variant("confirmed", null)
                        : variant("estimated", null),
            sheets: Math.round(2 + random() * 198) * 1_000,
            customer: CUSTOMERS[Math.floor(random() * CUSTOMERS.length)]!,
            stock: stock < 0.5 ? variant("coated", null) : stock < 0.85 ? variant("uncoated", null) : variant("board", null),
            due: some(new Date(end + 2 * DAY)),
        }]);
        if (n % 1_000_000 === 0) console.log(`${n.toLocaleString("en")} jobs, ${((performance.now() - began) / 1000).toFixed(0)} s`);
    }
}
// The backlog: due over the month after now, on no press yet.
for (let b = 0; b < BACKLOG; b++) {
    const stock = random();
    n += 1;
    writer.add([`J-${n.toString().padStart(8, "0")}`, {
        title: KINDS[b % KINDS.length]!,
        start: none,
        end: none,
        press: none,
        state: variant("estimated", null),
        sheets: Math.round(2 + random() * 198) * 1_000,
        customer: CUSTOMERS[b % CUSTOMERS.length]!,
        stock: stock < 0.5 ? variant("coated", null) : stock < 0.85 ? variant("uncoated", null) : variant("board", null),
        due: some(new Date(now + (3 + (b % 30)) * DAY)),
    }]);
}
writer.finish();
closeSync(fd);
const seconds = (performance.now() - began) / 1000;
console.log(`${out}: ${n.toLocaleString("en")} jobs on ${presses.toLocaleString("en")} presses, ` +
    `${(statSync(out).size / 1e6).toFixed(0)} MB, ${seconds.toFixed(0)} s`);
