/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the canvas draws (#1386, `drawn.ts`): an item, a zone, a link and a net
 * from their kinds' roles — each named by its reference printed, a row with no
 * position drawing nothing, and a card drawing its details' status, bar,
 * figure and second line where its kind gives none. Fixtures are real East
 * values typed from the roles' East types, compared through East.
 */

import { describe, test, expect } from "vitest";
import { defaultValue, equalFor, none, printFor, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import {
    SchematicDrawnItemType, SchematicDrawnLinkType, SchematicDrawnNetType, SchematicDrawnZoneType, drawnItem, drawnLink, drawnNet, drawnZone, entityId,
    type DetailsRoles, type ItemRoles, type LinkRoles, type NetRoles, type ZoneRoles,
} from "./drawn";

const RACK = { kind: "racks", key: "A01" };
const COOLER = { kind: "cooling", key: "A01" };
const FRAME = { kind: "network", key: "ODF-1" };

/** A rack's roles: placed at (2, 3), named, every other role as its type's default. */
const rackRoles = (over: Partial<ItemRoles> = {}): ItemRoles => ({
    ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 2, y: 3 }), label: "A01", ...over,
});

/** A details row's roles: a status, a bar, a figure and a second line. */
const details: DetailsRoles = {
    status: some({ label: "Hot", tone: variant("danger", null), ring: false }),
    meter: some({ value: 7.4, max: 8.0 }),
    metric: some("7.4 kW"),
    sublabel: some("from the loads"),
};

describe("an entity's id", () => {
    test("is its reference as East prints it: two kinds' rows of one key are two entities", () => {
        expect(entityId(RACK)).toBe(printFor(Schematic.Types.Ref)(RACK));
        expect(entityId(RACK)).not.toBe(entityId(COOLER));
        expect(entityId({ kind: "racks", key: "A01" })).toBe(entityId(RACK));
    });
});

describe("drawnItem", () => {
    test("an item is drawn at its centre, named by its reference, its roles as its kind reads them", () => {
        const drawn = drawnItem(RACK, rackRoles({ width: some(3.2), layer: some("power") }), undefined);
        expect(drawn).toBeDefined();
        expect(equalFor(SchematicDrawnItemType)(drawn!, {
            ...defaultValue<typeof SchematicDrawnItemType>(SchematicDrawnItemType),
            key: entityId(RACK), ref: RACK, x: 2, y: 3, label: "A01", width: some(3.2), layer: some("power"),
        })).toBe(true);
    });

    test("a row with no position — its kind's backlog — draws nothing", () => {
        expect(drawnItem(RACK, rackRoles({ position: none }), undefined)).toBeUndefined();
    });

    test("a card draws its details' status, bar, figure and second line where its kind gives none", () => {
        const drawn = drawnItem(RACK, rackRoles(), details)!;
        expect(equalFor(Schematic.Types.Item.fields.status)(drawn.status, details.status)).toBe(true);
        expect(equalFor(Schematic.Types.Item.fields.meter)(drawn.meter, details.meter)).toBe(true);
        expect(equalFor(Schematic.Types.Item.fields.metric)(drawn.metric, details.metric)).toBe(true);
        expect(equalFor(Schematic.Types.Item.fields.sublabel)(drawn.sublabel, details.sublabel)).toBe(true);
        // The kind's own second line is its own: the details' fill only what the kind leaves out.
        const own = drawnItem(RACK, rackRoles({ sublabel: some("42U") }), details)!;
        expect(equalFor(Schematic.Types.Item.fields.sublabel)(own.sublabel, some("42U"))).toBe(true);
    });
});

describe("drawnZone, drawnLink and drawnNet", () => {
    test("a zone keeps its box, its pattern and its shape about the box's centre", () => {
        const roles: ZoneRoles = {
            ...defaultValue<typeof Schematic.Types.Zone>(Schematic.Types.Zone),
            x: 0.6, y: 0.6, width: 19.6, height: 4.6, label: "Cage A",
            pattern: variant("hatch", { tone: none, spacing: none, angle: none }), geometry: some(variant("circle", { radius: 2 })),
        };
        const ref = { kind: "areas", key: "cage-a" };
        expect(equalFor(SchematicDrawnZoneType)(drawnZone(ref, roles), {
            ...defaultValue<typeof SchematicDrawnZoneType>(SchematicDrawnZoneType),
            key: entityId(ref), ref, x: 0.6, y: 0.6, width: 19.6, height: 4.6, label: "Cage A", pattern: roles.pattern, geometry: roles.geometry,
        })).toBe(true);
    });

    test("a link's ends are the ids of the items it joins", () => {
        const roles: LinkRoles = { ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link), from: RACK, to: FRAME, label: some("uplink") };
        const ref = { kind: "fibre", key: "u1" };
        const drawn = drawnLink(ref, roles);
        expect(drawn.from).toBe(entityId(RACK));
        expect(drawn.to).toBe(entityId(FRAME));
        expect(equalFor(SchematicDrawnLinkType)(drawn, {
            ...defaultValue<typeof SchematicDrawnLinkType>(SchematicDrawnLinkType),
            key: entityId(ref), ref, from: entityId(RACK), to: entityId(FRAME), label: some("uplink"), style: roles.style, route: roles.route,
        })).toBe(true);
    });

    test("a net's sides are the ids of the items it joins, in order", () => {
        const roles: NetRoles = { ...defaultValue<typeof Schematic.Types.Net>(Schematic.Types.Net), sources: [FRAME], destinations: [RACK, COOLER] };
        const ref = { kind: "feeds", key: "f1" };
        const drawn = drawnNet(ref, roles);
        expect(drawn.sources).toEqual([entityId(FRAME)]);
        expect(drawn.destinations).toEqual([entityId(RACK), entityId(COOLER)]);
        expect(equalFor(SchematicDrawnNetType)(drawn, {
            ...defaultValue<typeof SchematicDrawnNetType>(SchematicDrawnNetType),
            key: entityId(ref), ref, sources: [entityId(FRAME)], destinations: [entityId(RACK), entityId(COOLER)], style: roles.style, route: roles.route,
        })).toBe(true);
    });
});
