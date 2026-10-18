/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Table's narrowing (#1336), pure: over 500 seeded random days — lanes,
 * free slots, batches, reservations, bins not yet allocated, split bins — the
 * rows a narrowing shows agree with an oracle built another way (an inverted
 * index of resources to rows, and set algebra), keep their order, grow with
 * what is shown, never hide a free or unallocated row for a resource, and the
 * bands count exactly what they show.
 */
import { describe, expect, test } from "vitest";
import { SortedMap, SortedSet, StringType, compareFor, none, some, variant, type option } from "@elaraai/east";
import { narrowBands, narrowRows, tableBands, tableRows, type TableRow } from "./table-rows.js";
import type { Bin, Day, Slot } from "./model.js";

const byString = compareFor(StringType);
const DAY = new Date(Date.UTC(2027, 4, 11));
const LANES = ["L-1", "L-2", "L-3", "L-4"];
const RESOURCES = ["R-1", "R-2", "R-3", "R-4", "R-5", "R-6"];

/** A seeded generator (mulberry32): the same cases on every run. */
function random(seed: number) {
    let t = seed >>> 0;
    const next = () => {
        t = (t + 0x6d2b79f5) >>> 0;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
    return {
        int: (n: number) => Math.floor(next() * n),
        pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!,
        subset: <T,>(xs: readonly T[]) => xs.filter(() => next() < 0.5),
        chance: (p: number) => next() < p,
    };
}

/** A random day: each lane's slots an hour apart, each free or holding a batch of bins — booked, reserved, split or not linked. */
function randomDay(seed: number): { slots: Slot[]; plan: Day } {
    const r = random(seed);
    const lanes = LANES.slice(0, 1 + r.int(LANES.length));
    const bins = new SortedMap<string, Bin>([], byString);
    const slots: Slot[] = [];
    let id = 0;
    for (let hour = 0; hour < 24; hour += 1 + r.int(3)) {
        for (const lane of lanes) {
            const at = new Date(DAY.getTime() + hour * 3_600_000 + lanes.indexOf(lane) * 60_000);
            const ids: string[] = [];
            for (let k = r.chance(0.5) ? 0 : 1 + r.int(3); k > 0; k--) {
                const key = `b${id++}`;
                const reserved = r.chance(0.15);
                // A bin is on no resource, one, or several (a split).
                const on = r.chance(0.15) ? [] : r.chance(0.25) ? r.subset(RESOURCES) : [r.pick(RESOURCES)];
                bins.set(key, { lane, at: new Date(at.getTime() + ids.length * 1000), event: reserved ? none : some(`E${id}`), quantity: reserved ? 0 : 1 + r.int(40),
                    kind: none, hold: variant("days", 1), parts: new SortedMap(on.map(res => [res, 1]), byString), values: null } as unknown as Bin);
                ids.push(key);
            }
            slots.push({ lane, at, status: ids.length === 0 ? variant("free", null) : variant("booked", null), bins: ids });
        }
    }
    return { slots, plan: { status: variant("draft", null), bins } as unknown as Day };
}
const set = (xs: readonly string[]) => new SortedSet(xs, byString);
const shown = (r: ReturnType<typeof random>, all: readonly string[]): option<SortedSet<string>> => r.chance(0.2) ? none : some(set(r.subset(all)));

/**
 * The oracle, built another way: the rows by lane, intersected with the rows
 * a resource narrowing keeps — every row on no resource, and the union over
 * the shown resources of an inverted index of each resource's rows.
 */
function oracle(rows: readonly TableRow[], plan: Day, lanes: option<SortedSet<string>>, resources: option<SortedSet<string>>): Set<string> {
    const byLane = new Set(rows.filter(row => lanes.type === "none" || lanes.value.has(row.lane)).map(row => row.key));
    const index = new Map<string, Set<string>>();
    const onNothing = new Set<string>();
    for (const row of rows) {
        const parts = row.bin === undefined ? undefined : plan.bins.get(row.bin)?.parts;
        if (parts === undefined || parts.size === 0) { onNothing.add(row.key); continue; }
        for (const resource of parts.keys()) {
            if (!index.has(resource)) index.set(resource, new Set());
            index.get(resource)!.add(row.key);
        }
    }
    const byResource = resources.type === "none" ? new Set(rows.map(row => row.key))
        : new Set([...onNothing, ...[...resources.value].flatMap(resource => [...(index.get(resource) ?? [])])]);
    return new Set([...byLane].filter(key => byResource.has(key)));
}

describe("narrowRows (#1336)", () => {
    test("agrees with the oracle over 500 random days, keeping the rows' order", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const { slots, plan } = randomDay(seed);
            const rows = tableRows(slots, plan);
            const r = random(seed * 7919);
            const lanes = shown(r, LANES), resources = shown(r, RESOURCES);
            const narrowed = narrowRows(rows, plan, lanes, resources);
            expect(new Set(narrowed.map(row => row.key)), `seed ${seed}`).toEqual(oracle(rows, plan, lanes, resources));
            // A subsequence of the rows: never reordered.
            const order = rows.map(row => row.key);
            const at = narrowed.map(row => order.indexOf(row.key));
            expect(at, `seed ${seed}`).toEqual([...at].sort((a, b) => a - b));
        }
    });

    test("grows with what is shown: more lanes or more resources never hide a row", () => {
        for (let seed = 1; seed <= 500; seed++) {
            const { slots, plan } = randomDay(seed);
            const rows = tableRows(slots, plan);
            const r = random(seed * 104729);
            const lanes = r.subset(LANES), resources = r.subset(RESOURCES);
            const moreLanes = [...new Set([...lanes, ...r.subset(LANES)])], moreResources = [...new Set([...resources, ...r.subset(RESOURCES)])];
            const keys = (l: readonly string[], s: readonly string[]) => new Set(narrowRows(rows, plan, some(set(l)), some(set(s))).map(row => row.key));
            const base = keys(lanes, resources);
            for (const key of base) {
                expect(keys(moreLanes, resources).has(key), `seed ${seed}`).toBe(true);
                expect(keys(lanes, moreResources).has(key), `seed ${seed}`).toBe(true);
            }
        }
    });

    test("nothing chosen shows every row; every lane and every resource chosen shows every row too", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const { slots, plan } = randomDay(seed);
            const rows = tableRows(slots, plan);
            expect(narrowRows(rows, plan, none, none)).toEqual(rows);
            expect(narrowRows(rows, plan, some(set(LANES)), some(set(RESOURCES)))).toEqual(rows);
        }
    });

    test("a resource narrowing never hides a free row, a reservation on no resource or a bin not yet allocated; showing no resource leaves only those", () => {
        for (let seed = 1; seed <= 200; seed++) {
            const { slots, plan } = randomDay(seed);
            const rows = tableRows(slots, plan);
            const kept = narrowRows(rows, plan, none, some(set([])));
            const onNothing = rows.filter(row => row.bin === undefined || plan.bins.get(row.bin)!.parts.size === 0);
            expect(kept).toEqual(onNothing);
            expect(kept.some(row => row.kind === "free") || !rows.some(row => row.kind === "free"), `seed ${seed}`).toBe(true);
        }
    });

    test("a split bin shows while any one of its resources shows", () => {
        const { plan } = randomDay(3);
        const split = [...plan.bins].find(([, bin]) => bin.parts.size > 1);
        expect(split).toBeDefined();
        const [id, bin] = split!;
        const row: TableRow = { key: `bin:${id}`, lane: bin.lane, at: bin.at, slotAt: bin.at, bin: id, kind: "bin" };
        for (const resource of bin.parts.keys()) expect(narrowRows([row], plan, none, some(set([resource])))).toEqual([row]);
        const others = RESOURCES.filter(resource => !bin.parts.has(resource));
        expect(narrowRows([row], plan, none, some(set(others)))).toEqual([]);
    });
});

describe("narrowBands (#1336)", () => {
    test("each band holds its narrowed rows and counts exactly what it shows; a band the narrowing empties goes; nothing chosen changes nothing", () => {
        for (let seed = 1; seed <= 300; seed++) {
            const { slots, plan } = randomDay(seed);
            const bands = tableBands(tableRows(slots, plan), plan, DAY);
            expect(narrowBands(bands, plan, none, none)).toEqual(bands);
            const r = random(seed * 15485863);
            const lanes = shown(r, LANES), resources = shown(r, RESOURCES);
            const narrowed = narrowBands(bands, plan, lanes, resources);
            const expected = bands.map(band => ({ band, rows: narrowRows(band.rows, plan, lanes, resources) }))
                .filter(({ band, rows }) => rows.length > 0 || band.rows.length === 0);
            expect(narrowed.map(band => band.key), `seed ${seed}`).toEqual(expected.map(({ band }) => band.key));
            narrowed.forEach((band, i) => {
                const rows = expected[i]!.rows;
                expect(band.rows).toEqual(rows);
                expect([band.bins, band.reserved, band.free]).toEqual([
                    rows.filter(row => row.kind === "bin").length, rows.filter(row => row.kind === "reserved").length, rows.filter(row => row.kind === "free").length]);
                expect(band.quantity).toBe(rows.filter(row => row.kind === "bin").reduce((sum, row) => sum + plan.bins.get(row.bin!)!.quantity, 0));
                expect(band.bins + band.reserved + band.free).toBe(band.rows.length);
            });
        }
    });
});
