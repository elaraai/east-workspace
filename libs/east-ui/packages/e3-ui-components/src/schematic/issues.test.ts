/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The drawing's issues (#1391, `issues.ts`, SC16), pure: an item outside the
 * extent; a footprint or a zone's shape past its box — its vertices, the arcs
 * its bulges draw and a band's half-width; a colour naming no theme colour,
 * an entity's or a layer's; a link's end or a net's member no kind holds, and
 * none asked of a kind read through its source; and each record's session's —
 * the app's check refusing a row, and a Save's conflict or refusal — which
 * block and name the row's entity. Fixtures are real East values typed from
 * the Schematic's East types.
 */

import { describe, expect, test } from "vitest";
import { defaultValue, none, some, variant, type ValueTypeOf, type option } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import { detailsKey } from "./record-keys.js";
import { drawingIssues, outsideBox, sessionIssues, shapeExtent, type SchematicIssueArgs, type SchematicIssueSession } from "./issues.js";

const T = Schematic.Types;
type Geometry = ValueTypeOf<typeof T.Geometry>;

const ref = (kind: string, key: string): SchematicRef => ({ kind, key });
const vertex = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
const polygon = (...vertices: ReturnType<typeof vertex>[]): Geometry => variant("polygon", { vertices });
const polyline = (width: option<number>, ...vertices: ReturnType<typeof vertex>[]): Geometry => variant("polyline", { vertices, width });

/** An item drawn at a point, its label its key, its box and footprint and colour as given. */
function item(at: SchematicRef, x: number, y: number, extra: Partial<ValueTypeOf<typeof T.Item>> = {}) {
    return drawnItem(at, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: at.key, ...extra }, undefined)!;
}

const NAMES = new Map([["racks", "Rack"], ["network", "Network frame"], ["areas", "Area"], ["fibre", "Fibre run"], ["feeds", "Power feed"]]);
const COLOURS: ReadonlySet<string> = new Set(["status.warn", "brand.solid", "heat.3"]);

/** The issue args over a drawing: every rack held but A09, the frames read through a source. */
function args(drawn: Partial<SchematicDrawn>, extra: Partial<SchematicIssueArgs> = {}): SchematicIssueArgs {
    return {
        drawn: { items: [], zones: [], links: [], nets: [], ...drawn },
        extent: { width: 28, height: 14 },
        names: NAMES,
        holds: (at) => (at.kind === "racks" ? at.key !== "A09" : at.kind === "network" ? undefined : false),
        layers: [],
        colours: COLOURS,
        ...extra,
    };
}

describe("shapeExtent", () => {
    test("a circle reaches its radius every way; the box itself reaches nothing", () => {
        expect(shapeExtent(variant("circle", { radius: 0.7 }))).toEqual({ minX: -0.7, minY: -0.7, maxX: 0.7, maxY: 0.7 });
        expect(shapeExtent(variant("rect", null))).toBeUndefined();
    });

    test("an arc reaches past its chord as far as it bulges, as the painter draws it — a polygon's closing edge too", () => {
        // A half circle (bulge 1) on the chord from (-1, 0) to (1, 0): its far side reaches 1 from the chord.
        const reach = shapeExtent(polygon(vertex(-1, 0, 1), vertex(1, 0)))!;
        expect(Math.max(Math.abs(reach.minY), Math.abs(reach.maxY))).toBeCloseTo(1, 9);
        expect([reach.minX, reach.maxX]).toEqual([-1, 1]);
        // The same edge as a polygon's closing one: the last vertex's bulge curves the edge back to the first.
        const closing = shapeExtent(polygon(vertex(1, 0), vertex(-1, 0, 1)))!;
        expect(Math.max(Math.abs(closing.minY), Math.abs(closing.maxY))).toBeCloseTo(1, 9);
    });

    test("a polyline's band reaches half its width past its line; an open line has no closing edge", () => {
        const band = shapeExtent(polyline(some(1.4), vertex(-2, 0), vertex(2, 0)))!;
        expect(band).toEqual({ minX: -2.7, minY: -0.7, maxX: 2.7, maxY: 0.7 });
        // A bulge on the last vertex of an open line curves nothing.
        expect(shapeExtent(polyline(none, vertex(-1, 0), vertex(1, 0, 1)))).toEqual({ minX: -1, minY: 0, maxX: 1, maxY: 0 });
    });
});

describe("outsideBox", () => {
    test("a shape within its box, to its edge, is within; past it by any of its parts is outside", () => {
        expect(outsideBox(variant("circle", { radius: 0.7 }), 1.4, 1.4)).toBe(false);
        expect(outsideBox(variant("circle", { radius: 0.8 }), 1.4, 1.4)).toBe(true);
        expect(outsideBox(polygon(vertex(-1, -1), vertex(1, -1), vertex(1, 1)), 2, 2)).toBe(false);
        // Its vertices within the box, its arc past it.
        expect(outsideBox(polygon(vertex(-1, 0, 1), vertex(1, 0)), 2, 1.6)).toBe(true);
        expect(outsideBox(polyline(some(1.4), vertex(-2, 0), vertex(2, 0)), 4, 2)).toBe(true);
        expect(outsideBox(variant("rect", null), 0, 0)).toBe(false);
    });
});

describe("drawingIssues", () => {
    test("an item outside the extent, a footprint past its box and a colour naming no theme colour each warn, naming the item", () => {
        const outside = item(ref("racks", "A01"), 30, 2);
        const round = item(ref("racks", "A02"), 6, 2, { width: some(1.4), height: some(1.4), footprint: some(variant("circle", { radius: 1 })) });
        const tinted = item(ref("racks", "A03"), 9, 2, { color: some("heat.9") });
        const fine = item(ref("racks", "A04"), 12, 2, { width: some(1.4), height: some(1.4), footprint: some(variant("circle", { radius: 0.7 })), color: some("heat.3") });
        expect(drawingIssues(args({ items: [outside, round, tinted, fine] }))).toEqual([
            { at: outside.key, blocking: false, where: { kind: "Rack", name: "A01" }, word: { issue: "outside" } },
            { at: round.key, blocking: false, where: { kind: "Rack", name: "A02" }, word: { issue: "geometry" } },
            { at: tinted.key, blocking: false, where: { kind: "Rack", name: "A03" }, word: { issue: "colour", colour: "heat.9" } },
        ]);
    });

    test("a zone's shape past its box and its colour warn; a layer's colour too, naming the layer and selecting nothing", () => {
        const hall = drawnZone(ref("areas", "hall"), {
            ...defaultValue<typeof T.Zone>(T.Zone), label: "Hall 3", width: 4, height: 2, color: some("status.danger"),
            geometry: some(polygon(vertex(-2, -1), vertex(2.5, -1), vertex(2, 1))),
        });
        const issues = drawingIssues(args({ zones: [hall] }, {
            layers: [{ key: "power", label: "Power", color: some("status.warn") }, { key: "odd", label: "Odd", color: some("ink.9") }],
        }));
        expect(issues).toEqual([
            { at: hall.key, blocking: false, where: { kind: "Area", name: "Hall 3" }, word: { issue: "geometry" } },
            { at: hall.key, blocking: false, where: { kind: "Area", name: "Hall 3" }, word: { issue: "colour", colour: "status.danger" } },
            { at: undefined, blocking: false, where: { kind: undefined, name: "Odd" }, word: { issue: "colour", colour: "ink.9" } },
        ]);
    });

    test("a link's end or a net's member no kind holds warns, naming it; one a kind read through its source may hold is never asked", () => {
        const run = drawnLink(ref("fibre", "u1"), { ...defaultValue<typeof T.Link>(T.Link), from: ref("racks", "A09"), to: ref("network", "ODF-9") });
        const stray = drawnLink(ref("fibre", "u2"), { ...defaultValue<typeof T.Link>(T.Link), from: ref("racks", "A01"), to: ref("pumps", "P1") });
        const feed = drawnNet(ref("feeds", "feed-a"), {
            ...defaultValue<typeof T.Net>(T.Net), label: some("PDU-A · A side"), sources: [ref("pdus", "PDU-A")], destinations: [ref("racks", "A01"), ref("racks", "A09")],
        });
        expect(drawingIssues(args({ links: [run, stray], nets: [feed] }))).toEqual([
            // A09 no rack holds; ODF-9's kind is read through its source: never asked.
            { at: run.key, blocking: false, where: { kind: "Fibre run", name: "u1" }, word: { issue: "missing", kind: "Rack", key: "A09" } },
            // A slot no item kind has: named by the slot.
            { at: stray.key, blocking: false, where: { kind: "Fibre run", name: "u2" }, word: { issue: "missing", kind: "pumps", key: "P1" } },
            { at: feed.key, blocking: false, where: { kind: "Power feed", name: "PDU-A · A side" }, word: { issue: "missing", kind: "pdus", key: "PDU-A" } },
            { at: feed.key, blocking: false, where: { kind: "Power feed", name: "PDU-A · A side" }, word: { issue: "missing", kind: "Rack", key: "A09" } },
        ]);
    });

    test("a drawing that holds together has no issue", () => {
        const a01 = item(ref("racks", "A01"), 2, 2);
        const run = drawnLink(ref("fibre", "u1"), { ...defaultValue<typeof T.Link>(T.Link), from: ref("racks", "A01"), to: ref("racks", "A02") });
        expect(drawingIssues(args({ items: [a01], links: [run] }, { layers: [{ key: "power", label: "Power", color: some("status.warn") }] }))).toEqual([]);
        expect(entityId(a01.ref)).toBe(a01.key);
    });
});

describe("sessionIssues", () => {
    /** An issue as a session raises it. */
    const issue = (entry: string, message: string, field?: string) => ({ entry, row: none, field: field === undefined ? none : some(field), message });
    /** A session as Issues reads it. */
    const session = (kind: string, readiness: SchematicIssueSession["session"]["readiness"], status: SchematicIssueSession["session"]["status"] = "idle",
        issues: SchematicIssueSession["session"]["issues"] = []): SchematicIssueSession => ({ kind, session: { readiness, status, issues } });

    test("the app's check refusing a row blocks, naming the row's entity — a details record's row its item's — and a Save's refusal while it stands", () => {
        const labels = new Map([[entityId(ref("racks", "A03")), "A03"]]);
        const issues = sessionIssues([
            session("racks", variant("incomplete", [issue("A03", "an owner is needed", "owner")])),
            session(detailsKey("racks"), variant("invalid", [issue("A01", "capacity is below the load")])),
            session("fibre", variant("ready", null), "rejected", [issue("", "the fibre runs are frozen"), issue("u3", "u3 changed")]),
            // A conflict past, its words no longer stand: an idle session says nothing.
            session("feeds", variant("ready", null), "idle", [issue("feed-a", "stale")]),
        ], NAMES, (id) => labels.get(id));
        expect(issues).toEqual([
            { at: entityId(ref("racks", "A03")), blocking: true, where: { kind: "Rack", name: "A03" }, word: { issue: "ready", field: "owner", message: "an owner is needed" } },
            { at: entityId(ref("racks", "A01")), blocking: true, where: { kind: "Rack", name: "A01" }, word: { issue: "ready", field: undefined, message: "capacity is below the load" } },
            { at: undefined, blocking: true, where: { kind: "Fibre run", name: "Fibre run" }, word: { issue: "save", field: undefined, message: "the fibre runs are frozen" } },
            { at: entityId(ref("fibre", "u3")), blocking: true, where: { kind: "Fibre run", name: "u3" }, word: { issue: "save", field: undefined, message: "u3 changed" } },
        ]);
    });
});
