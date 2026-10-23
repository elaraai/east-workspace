/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the rail's narrowing does to the drawing (#1392, `narrowing.ts`, §10.2,
 * §10.3): the matches, each a row of a kind whose source narrows among its
 * shown keys; hidden — the default — a link or a net whose ends the narrowing
 * hides is out, and an end a read whole doesn't hold is not the narrowing's;
 * dimmed, a narrowed-out row is context, and so is a link ending at one and a
 * net a side of which is all context; a row a gesture created is neither; and
 * the lists' drawing with what is out left out. Fixtures are real East values
 * typed from the Schematic's East types.
 */

import { describe, expect, test } from "vitest";
import { SortedSet, StringType, compareFor, defaultValue, none, some, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import type { SchematicHeldRows } from "./data.js";
import { NO_NARROWING, narrowedDrawing, schematicNarrowing } from "./narrowing.js";

const T = Schematic.Types;
const compareString = compareFor(StringType);

/** An entity's id, by its kind and key. */
const id = (kind: string, key: string) => entityId({ kind, key });

/** An item of a kind, placed. */
const item = (kind: string, key: string) => drawnItem({ kind, key }, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x: 1, y: 1 }), label: key }, undefined)!;

/** A run from one item to another. */
const run = (key: string, from: SchematicRef, to: SchematicRef) => drawnLink({ kind: "fibre", key }, { ...defaultValue<typeof T.Link>(T.Link), from, to });

/** A feed from units to racks. */
const feed = (key: string, sources: SchematicRef[], destinations: SchematicRef[]) =>
    drawnNet({ kind: "feeds", key }, { ...defaultValue<typeof T.Net>(T.Net), sources, destinations });

const rack = (key: string) => ({ kind: "racks", key });
const frame = (key: string) => ({ kind: "network", key });
const pdu = (key: string) => ({ kind: "pdus", key });

/** A floor's drawing: the racks it is given, two frames, two units, a cage, four runs and two feeds. */
function floor(racks: readonly string[]): SchematicDrawn {
    return {
        items: [...racks.map((key) => item("racks", key)), item("network", "ODF-1"), item("network", "CORE-1"), item("pdus", "PDU-A"), item("pdus", "PDU-B")],
        zones: [drawnZone({ kind: "areas", key: "cage-a" }, { ...defaultValue<typeof T.Zone>(T.Zone), label: "Cage A" })],
        links: [
            run("u1", rack("A01"), frame("ODF-1")), run("u2", rack("A02"), frame("ODF-1")), run("u3", rack("A03"), frame("ODF-1")),
            run("x1", frame("ODF-1"), frame("CORE-1")),
        ],
        nets: [feed("feed-a", [pdu("PDU-A")], [rack("A01"), rack("A02"), rack("A03")]), feed("feed-b", [pdu("PDU-B")], [rack("A03"), rack("A04")])],
    };
}

/** What each read holds: the racks given, every frame and unit, the cage, every run and feed. */
function held(racks: readonly string[]): SchematicHeldRows {
    const rows = (keys: readonly string[]) => new Map(keys.map((key) => [key, { details: undefined }] as const));
    return new Map([
        ["racks", rows(racks)], ["network", rows(["ODF-1", "CORE-1"])], ["pdus", rows(["PDU-A", "PDU-B"])], ["areas", rows(["cage-a"])],
        ["fibre", rows(["u1", "u2", "u3", "x1"])], ["feeds", rows(["feed-a", "feed-b"])],
    ]);
}

/** Shown keys, as a source's visibility reads them. */
const shownKeys = (...keys: string[]): option<ReadonlySet<string>> => some(new SortedSet(keys, compareString));

/** The racks read through their source, each other kind whole. */
const SOURCED = new Set(["racks"]);

/** A set's members, in East's order of strings. */
const sorted = (set: ReadonlySet<string>) => [...set].sort(compareString);

describe("schematicNarrowing", () => {
    test("while no source narrows — or its keys are not read, or have not resolved — nothing matches, nothing is context and nothing is out", () => {
        const all = ["A01", "A02", "A03", "A04"];
        for (const dim of [false, true]) {
            expect(schematicNarrowing({ drawn: floor(all), held: held(all), sourced: SOURCED, keys: () => none, dim })).toBe(NO_NARROWING);
            expect(schematicNarrowing({ drawn: floor(all), held: held(all), sourced: SOURCED, keys: () => undefined, dim })).toBe(NO_NARROWING);
        }
    });

    test("hidden: the racks the narrowing holds match; a run ending at a rack it hides is out, and a feed whose racks are all hidden — but no run or feed of the rest", () => {
        // The read holds the narrowing's racks alone: A01 and A02.
        const narrowing = schematicNarrowing({
            drawn: floor(["A01", "A02"]), held: held(["A01", "A02"]), sourced: SOURCED, keys: (slot) => (slot === "racks" ? shownKeys("A01", "A02") : undefined), dim: false,
        });
        expect(sorted(narrowing.matches)).toEqual(sorted(new Set([id("racks", "A01"), id("racks", "A02")])));
        expect(narrowing.context.size).toBe(0);
        // u3 runs from A03, which the narrowing hides; feed-b feeds A03 and A04 alone; feed-a still feeds A01 and A02.
        expect(sorted(narrowing.out)).toEqual(sorted(new Set([id("fibre", "u3"), id("feeds", "feed-b")])));
        expect(narrowing.isContext(rack("A03"))).toBe(false);
    });

    test("hidden: an end no read holds of a kind read whole is no narrowing's, and an unplaced rack its read holds stays an end", () => {
        const drawn = floor(["A01"]);
        const narrowing = schematicNarrowing({
            drawn: { ...drawn, links: [...drawn.links, run("u9", rack("A01"), frame("GONE")), run("u6", rack("A06"), frame("ODF-1"))] },
            // A06 has no position: the read holds it, and it draws nothing.
            held: held(["A01", "A06"]), sourced: SOURCED, keys: (slot) => (slot === "racks" ? shownKeys("A01", "A06") : undefined), dim: false,
        });
        expect(narrowing.out.has(id("fibre", "u9"))).toBe(false);
        expect(narrowing.out.has(id("fibre", "u6"))).toBe(false);
        expect(narrowing.out.has(id("fibre", "u2"))).toBe(true);
    });

    test("dimmed: every rack is read, and those the narrowing leaves out are context — with each run ending at one, and a feed whose racks are all context — out of every list", () => {
        const all = ["A01", "A02", "A03", "A04"];
        const narrowing = schematicNarrowing({
            drawn: floor(all), held: held(all), sourced: SOURCED, keys: (slot) => (slot === "racks" ? shownKeys("A01", "A02") : undefined), dim: true,
        });
        const context = [id("racks", "A03"), id("racks", "A04"), id("fibre", "u3"), id("feeds", "feed-b")];
        expect(sorted(narrowing.context)).toEqual(sorted(new Set(context)));
        expect(sorted(narrowing.out)).toEqual(sorted(new Set(context)));
        // feed-a feeds A03 too, and A01 and A02: it draws as itself, its leg to A03 the painter's to dim.
        expect(narrowing.context.has(id("feeds", "feed-a"))).toBe(false);
        expect(sorted(narrowing.matches)).toEqual(sorted(new Set([id("racks", "A01"), id("racks", "A02")])));
        // A row the read holds outside the narrowing — a backlog row among them — is context; one inside it is not.
        expect([narrowing.isContext(rack("A04")), narrowing.isContext(rack("A02"))]).toEqual([true, false]);
    });

    test("dimmed: a kind's own source narrows it — a run outside the fibre's narrowing is context, and one inside it matches", () => {
        const all = ["A01", "A02", "A03", "A04"];
        const narrowing = schematicNarrowing({
            drawn: floor(all), held: held(all), sourced: new Set(["racks", "fibre"]), keys: (slot) => (slot === "fibre" ? shownKeys("u1", "x1") : slot === "racks" ? none : undefined),
            dim: true,
        });
        expect(sorted(narrowing.context)).toEqual(sorted(new Set([id("fibre", "u2"), id("fibre", "u3")])));
        expect(sorted(narrowing.matches)).toEqual(sorted(new Set([id("fibre", "u1"), id("fibre", "x1")])));
    });

    test("a row a gesture created — drawn, no read holding it — is neither context nor a match", () => {
        const all = ["A01", "A02"];
        const drawn = floor(all);
        const narrowing = schematicNarrowing({
            drawn: { ...drawn, items: [...drawn.items, item("racks", "new-1")] }, held: held(all), sourced: SOURCED,
            keys: (slot) => (slot === "racks" ? shownKeys("A01") : undefined), dim: true,
        });
        expect([narrowing.context.has(id("racks", "new-1")), narrowing.matches.has(id("racks", "new-1"))]).toEqual([false, false]);
        expect(narrowing.context.has(id("racks", "A02"))).toBe(true);
        expect(narrowing.isContext(rack("new-1"))).toBe(false);
    });
});

describe("narrowedDrawing", () => {
    test("leaves out what the narrowing takes out, and is the drawing itself while nothing is", () => {
        const drawn = floor(["A01", "A02", "A03", "A04"]);
        expect(narrowedDrawing(drawn, new Set())).toBe(drawn);
        const shown = narrowedDrawing(drawn, new Set([id("racks", "A03"), id("fibre", "u3"), id("feeds", "feed-b"), id("areas", "cage-a")]));
        expect(shown.items.map((i) => i.ref.key)).toEqual(["A01", "A02", "A04", "ODF-1", "CORE-1", "PDU-A", "PDU-B"]);
        expect([shown.zones.length, shown.links.map((l) => l.ref.key), shown.nets.map((n) => n.ref.key)]).toEqual([0, ["u1", "u2", "x1"], ["feed-a"]]);
    });
});
