/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The plan-steps lab's generator (#1710): writes the steps record's first state — as many steps as it is asked for,
 * shared out over the works' machines and five years — to a beast2 file, which `e3 seed` commits as the record's
 * `$init`.
 *
 * Usage: `tsx generate.ts <out.beast2> <steps>`
 *
 * A Dict streams in its keys' order, and a step's key is a variant, whose cases East orders by name: the bays'
 * deliveries first, by bay and slot; then the presses' work, by order and its place in it — a run, a third of them
 * after a setup of their own; then the crews' shifts, by crew and start. Each machine's steps follow one another and
 * never overlap, on quarter hours: a run most often a shift long or less, a setup an hour or so, a shift eight hours, a
 * delivery under an hour. Those before the lab's now are done, those across it running, those in the fortnight after it
 * confirmed and the rest estimated. The same count writes the same steps every time.
 *
 * @packageDocumentation
 */

import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { Beast2ElementWriter, variant } from "@elaraai/east";
import {
    LAB_FIRST_BAY, LAB_FIRST_CREW, LAB_FIRST_HALL, LAB_FIRST_PRESS, LAB_FROM, LAB_HALLS, LAB_HALL_BAYS, LAB_HALL_CREWS, LAB_HALL_PRESSES, LAB_NOW, LAB_TO,
    LabSteps,
} from "./types.ts";

const [out, count] = process.argv.slice(2);
if (out === undefined || count === undefined || !/^\d+$/.test(count)) {
    console.error("usage: tsx generate.ts <out.beast2> <steps>");
    process.exit(2);
}
const total = Number(count);

/** A quarter hour, the step every start and end stands on. */
const QUARTER = 15 * 60_000;
const HOUR = 4 * QUARTER;
const DAY = 24 * HOUR;

const TITLES = [
    "Brochure run", "Catalogue", "Event posters", "Menu cards", "Annual report", "Magazine run", "Store flyers",
    "Ticket books", "Wall calendars", "Course handbooks", "Gift boxes", "Timetables", "Museum guide", "Seed catalogue",
    "Tour brochure", "Order forms", "Prospectus", "Exhibition book", "Price list", "Trade catalogue",
];

/**
 * A seeded stream of numbers in [0, 1) — mulberry32 — so a count writes the same steps every time.
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
const halls = Number(LAB_HALLS);
const presses = halls * Number(LAB_HALL_PRESSES);
const crews = halls * Number(LAB_HALL_CREWS);
const bays = halls * Number(LAB_HALL_BAYS);
const machines = presses + crews + bays;
const from = LAB_FROM.getTime();
const span = LAB_TO.getTime() - from;
const now = LAB_NOW.getTime();
const began = performance.now();

/** How many steps the machine at a place in the writing order takes: the count shared out, the first ones one more where it does not divide. */
const stepsOf = (at: number): number => Math.floor(total / machines) + (at < total % machines ? 1 : 0);

/** The hall a machine of a kind is in, by its place among that kind's: each hall holds its share of them in turn. */
const hallOf = (place: number, perHall: bigint): string => `H${Math.floor(place / Number(perHall)) + Number(LAB_FIRST_HALL)}`;

/** The lifecycle a step wears, by where it stands to now. */
const stateOf = (start: number, end: number) => end <= now ? variant("actual", null)
    : start <= now ? variant("in-progress", null)
        : start < now + 14 * DAY ? variant("confirmed", null)
            : variant("estimated", null);

/**
 * A step's times inside its slot: its length, as long as it asks but most of the slot, its start where it opens at
 * random, both on quarter hours, and a quarter hour at least.
 */
function placed(slotStart: number, slot: number, wanted: number): { start: number; end: number } {
    const length = Math.min(wanted, slot * 0.9);
    const opens = slotStart + random() * (slot - length);
    const start = Math.ceil(opens / QUARTER) * QUARTER;
    const end = Math.max(start + QUARTER, Math.floor((opens + length) / QUARTER) * QUARTER);
    return { start, end };
}

const fd = openSync(out, "w");
const writer = new Beast2ElementWriter(LabSteps, (bytes) => { writeSync(fd, bytes); });
let n = 0;
let at = 0;

// The bays' deliveries, by bay and slot.
for (let b = 0; b < bays; b++, at++) {
    const bay = `B-${b + Number(LAB_FIRST_BAY)}`;
    const hall = hallOf(b, LAB_HALL_BAYS);
    const onBay = stepsOf(at);
    const slot = span / onBay;
    for (let j = 0; j < onBay; j++) {
        // Half an hour at least: a delivery's slot, its key, starts a quarter hour after the last one's at the closest.
        const { start, end } = placed(from + j * slot, slot, 2 * QUARTER + random() * 2 * QUARTER);
        writer.add([variant("drop", { bay, slot: new Date(start) }), {
            hall, on: variant("bay", bay), start: new Date(start), end: new Date(end), state: stateOf(start, end),
            kind: variant("delivery", { pallets: Math.round(1 + random() * 11) }),
        }]);
        n += 1;
    }
}

// The presses' work, by order and its place in it: a run, a third of them after a setup of their own.
let order = 0;
for (let p = 0; p < presses; p++, at++) {
    const press = `P-${p + Number(LAB_FIRST_PRESS)}`;
    const hall = hallOf(p, LAB_HALL_PRESSES);
    const onPress = stepsOf(at);
    const slot = span / onPress;
    let j = 0;
    while (j < onPress) {
        order += 1;
        const id = `O-${order.toString().padStart(8, "0")}`;
        let place = 1n;
        // A setup before the run, where its order has one and the press has a slot for both.
        if (random() < 1 / 3 && j + 1 < onPress) {
            const { start, end } = placed(from + j * slot, slot, HOUR / 2 + random() * HOUR);
            writer.add([variant("job", { order: id, n: place }), {
                hall, on: variant("press", press), start: new Date(start), end: new Date(end), state: stateOf(start, end),
                kind: variant("setup", { plates: BigInt(1 + Math.floor(random() * 8)) }),
            }]);
            n += 1;
            j += 1;
            place += 1n;
        }
        const kind = random();
        const hours = kind < 0.7 ? 2 + random() * 10 : kind < 0.95 ? 12 + random() * 24 : 36 + random() * 36;
        const { start, end } = placed(from + j * slot, slot, hours * HOUR);
        writer.add([variant("job", { order: id, n: place }), {
            hall, on: variant("press", press), start: new Date(start), end: new Date(end), state: stateOf(start, end),
            kind: variant("run", { title: TITLES[Math.floor(random() * TITLES.length)]!, sheets: Math.round(2 + random() * 198) * 1_000 }),
        }]);
        n += 1;
        j += 1;
    }
}

// The crews' shifts, by crew and start.
for (let c = 0; c < crews; c++, at++) {
    const crew = `C-${c + Number(LAB_FIRST_CREW)}`;
    const hall = hallOf(c, LAB_HALL_CREWS);
    const onCrew = stepsOf(at);
    const slot = span / onCrew;
    for (let j = 0; j < onCrew; j++) {
        const { start, end } = placed(from + j * slot, slot, 8 * HOUR);
        writer.add([variant("shift", { crew, date: new Date(start) }), {
            hall, on: variant("crew", crew), start: new Date(start), end: new Date(end), state: stateOf(start, end),
            kind: variant("labour", { people: BigInt(2 + Math.floor(random() * 7)) }),
        }]);
        n += 1;
        if (n % 1_000_000 === 0) console.log(`${n.toLocaleString("en")} steps, ${((performance.now() - began) / 1000).toFixed(0)} s`);
    }
}
writer.finish();
closeSync(fd);
const seconds = (performance.now() - began) / 1000;
console.log(`${out}: ${n.toLocaleString("en")} steps on ${machines.toLocaleString("en")} machines in ${halls} halls, ` +
    `${(statSync(out).size / 1e6).toFixed(0)} MB, ${seconds.toFixed(0)} s`);
