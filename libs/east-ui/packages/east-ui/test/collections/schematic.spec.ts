/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { variant, some } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";
import * as ex from "./schematic.examples.js";

describeEast("Schematic", (test) => {
    Assert.examples(test, {
        schematicPlant: ex.schematicPlant,
        schematicMinimal: ex.schematicMinimal,
        schematicInteractive: ex.schematicInteractive,
        schematicFacility: ex.schematicFacility,
    });

    test("resolves items with defaults", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "T1", x: 3.0, y: 2.0 }],
            {
                extent: { width: 10, height: 5 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.extent.width, 10.0));
        $(Assert.equal(root.items.size(), 1n));
        $(Assert.equal(root.items.get(0n).key, "T1"));
        $(Assert.equal(root.items.get(0n).status.hasTag("none"), true));
        $(Assert.equal(root.items.get(0n).meter.hasTag("none"), true));
        $(Assert.equal(root.zones.size(), 0n));
        $(Assert.equal(root.links.size(), 0n));
        $(Assert.equal(root.scaleUnit.hasTag("none"), true));
    });

    test("zones default to outline; links default to solid with no waypoints", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }, { id: "B", x: 8.0, y: 4.0 }],
            {
                extent: { width: 10, height: 5 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                zones: [{ id: "z1", name: "Hall", x: 0.0, y: 0.0, w: 5.0, h: 3.0 }],
                zone: z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h }),
                links: [{ id: "l1", src: "A", dst: "B" }],
                link: l => ({ key: l.id, from: l.src, to: l.dst }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.zones.get(0n).pattern.hasTag("outline"), true));
        $(Assert.equal(root.links.get(0n).style.hasTag("solid"), true));
        $(Assert.equal(root.links.get(0n).via.size(), 0n));
    });

    test("typed status, hatch pattern, and waypoints carry through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0, state: some(variant("warning", null)), fill: 3.0, cap: 4.0 }],
            {
                extent: { width: 10, height: 5 },
                item: e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    status: e.state,
                    meter: { value: e.fill, max: e.cap },
                }),
                zones: [{ id: "z1", name: "Aisle", x: 0.0, y: 3.0, w: 10.0, h: 1.0, p: Schematic.hatch({ spacing: 10.0 }) }],
                zone: z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, pattern: z.p }),
                links: [{ id: "l1", src: "A", dst: "A", s: Schematic.dashed({ tone: "ink" }), via: [{ x: 5.0, y: 2.0 }] }],
                link: l => ({ key: l.id, from: l.src, to: l.dst, style: l.s, via: l.via }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.items.get(0n).status.unwrap("some").hasTag("warning"), true));
        $(Assert.equal(root.items.get(0n).meter.unwrap("some").max, 4.0));
        $(Assert.equal(root.zones.get(0n).pattern.hasTag("hatch"), true));
        $(Assert.equal(root.links.get(0n).style.hasTag("dashed"), true));
        $(Assert.equal(root.links.get(0n).style.unwrap("dashed").tone.unwrap("some").hasTag("ink"), true));
        $(Assert.equal(root.links.get(0n).route.hasTag("orthogonal"), true));
        $(Assert.equal(root.zones.get(0n).pattern.unwrap("hatch").spacing.unwrap("some"), 10.0));
        $(Assert.equal(root.links.get(0n).via.get(0n).x, 5.0));
    });
}, { platformFns: TestImpl });
