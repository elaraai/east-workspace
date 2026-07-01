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
        schematicSlice: ex.schematicSlice,
        schematicSliceEffect: ex.schematicSliceEffect,
        schematicLayers: ex.schematicLayers,
        schematicMinimal: ex.schematicMinimal,
        schematicInteractive: ex.schematicInteractive,
        schematicFacility: ex.schematicFacility,
        schematicGeometry: ex.schematicGeometry,
        schematicColorOverride: ex.schematicColorOverride,
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

    test("item footprint and zone geometry default to none", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 10, height: 5 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                zones: [{ id: "z", name: "Z", x: 0.0, y: 0.0, w: 4.0, h: 3.0 }],
                zone: z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.items.get(0n).footprint.hasTag("none"), true));
        $(Assert.equal(root.zones.get(0n).geometry.hasTag("none"), true));
        $(Assert.equal(root.height.hasTag("none"), true));
    });

    test("fixed height carries through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 10, height: 5 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                height: "400px",
            },
        ));
        $(Assert.equal($.let(sch.unwrap().unwrap("Schematic")).height.unwrap("some"), "400px"));
    });

    test("polygon / circle footprints and arc-aware polyline zone geometry carry through", $ => {
        const sch = $.let(Schematic.Root(
            [
                { id: "P", x: 3.0, y: 3.0, r: 0.0, round: false,
                  pts: [{ x: 1.0, y: 1.0, bulge: 0.0 }, { x: 5.0, y: 1.0, bulge: 0.5 }, { x: 3.0, y: 5.0, bulge: 0.0 }] },
                { id: "T", x: 8.0, y: 2.0, r: 1.5, round: true,
                  pts: [{ x: 8.0, y: 2.0, bulge: 0.0 }] },
            ],
            {
                extent: { width: 10, height: 8 },
                item: e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    footprint: e.round.ifElse(_$ => Schematic.circle(e.r), _$ => Schematic.polygon(e.pts)),
                }),
                zones: [{ id: "r", name: "Rd", x: 0.0, y: 4.0, w: 9.0, h: 2.0,
                          pl: [{ x: 0.5, y: 5.0, bulge: 0.0 }, { x: 8.5, y: 5.0, bulge: 0.0 }] }],
                zone: z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, geometry: Schematic.polyline(z.pl, { width: 0.8 }) }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        const poly = $.let(root.items.get(0n).footprint.unwrap("some"));
        $(Assert.equal(poly.hasTag("polygon"), true));
        $(Assert.equal(poly.unwrap("polygon").vertices.size(), 3n));
        $(Assert.equal(poly.unwrap("polygon").vertices.get(1n).bulge, 0.5));
        $(Assert.equal(root.items.get(1n).footprint.unwrap("some").hasTag("circle"), true));
        $(Assert.equal(root.items.get(1n).footprint.unwrap("some").unwrap("circle").radius, 1.5));
        $(Assert.equal(root.zones.get(0n).geometry.unwrap("some").hasTag("polyline"), true));
        $(Assert.equal(root.zones.get(0n).geometry.unwrap("some").unwrap("polyline").vertices.size(), 2n));
        $(Assert.equal(root.zones.get(0n).geometry.unwrap("some").unwrap("polyline").width.unwrap("some"), 0.8));
    });

    test("item and zone colour overrides carry through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 2.0, y: 2.0, r: 1.0 }],
            {
                extent: { width: 8, height: 6 },
                item: e => ({
                    key: e.id, x: e.x, y: e.y, label: e.id,
                    footprint: Schematic.circle(e.r),
                    tone: "brand", color: "#2D7FF9", bg: "#2D7FF9", fillOpacity: 0.2, weight: 2.0,
                }),
                zones: [{ id: "z", name: "Z", x: 0.0, y: 0.0, w: 8.0, h: 6.0 }],
                zone: z => ({
                    key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h,
                    tone: "danger", color: "#DC2626", bg: "#DC2626", fillOpacity: 0.15, weight: 1.5,
                }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        const item = $.let(root.items.get(0n));
        $(Assert.equal(item.tone.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(item.color.unwrap("some"), "#2D7FF9"));
        $(Assert.equal(item.bg.unwrap("some"), "#2D7FF9"));
        $(Assert.equal(item.fillOpacity.unwrap("some"), 0.2));
        $(Assert.equal(item.weight.unwrap("some"), 2.0));

        const zone = $.let(root.zones.get(0n));
        $(Assert.equal(zone.tone.unwrap("some").hasTag("danger"), true));
        $(Assert.equal(zone.color.unwrap("some"), "#DC2626"));
        $(Assert.equal(zone.bg.unwrap("some"), "#DC2626"));
        $(Assert.equal(zone.weight.unwrap("some"), 1.5));
    });

    test("excluded flag + a composed slice effect (ghost + pulse + fitted frame) carry through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 2.0, y: 2.0, out: true }, { id: "B", x: 5.0, y: 2.0, out: false }],
            {
                extent: { width: 8, height: 6 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id, excluded: e.out }),
                sliceEffect: { excluded: { opacity: 0.25, desaturate: true }, emphasis: "pulse", frame: { fit: true } },
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.items.get(0n).excluded.unwrap("some"), true));
        $(Assert.equal(root.items.get(1n).excluded.unwrap("some"), false));

        const eff = $.let(root.sliceEffect.unwrap("some"));
        const keep = $.let(eff.excluded.unwrap("some"));
        $(Assert.equal(keep.hasTag("keep"), true));
        $(Assert.equal(keep.unwrap("keep").opacity.unwrap("some"), 0.25));
        $(Assert.equal(keep.unwrap("keep").desaturate.unwrap("some"), true));
        $(Assert.equal(keep.unwrap("keep").dot.hasTag("none"), true));
        $(Assert.equal(eff.emphasis.unwrap("some").hasTag("pulse"), true));
        $(Assert.equal(eff.frame.unwrap("some").fit.unwrap("some"), true));
    });

    test("excluded style shorthands: `hide` and `none`, plus a bare `frame`", $ => {
        const hide = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                sliceEffect: { excluded: "hide" },
            },
        ).unwrap().unwrap("Schematic"));
        // Default (unset) item excluded flag is `none`.
        $(Assert.equal(hide.items.get(0n).excluded.hasTag("none"), true));
        $(Assert.equal(hide.sliceEffect.unwrap("some").excluded.unwrap("some").hasTag("hide"), true));
        // No emphasis / frame set ⇒ both `none`.
        $(Assert.equal(hide.sliceEffect.unwrap("some").emphasis.hasTag("none"), true));
        $(Assert.equal(hide.sliceEffect.unwrap("some").frame.hasTag("none"), true));

        const bare = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                sliceEffect: { excluded: "none", emphasis: "halo", frame: true },
            },
        ).unwrap().unwrap("Schematic"));
        const eff = $.let(bare.sliceEffect.unwrap("some"));
        // `"none"` ⇒ `keep` with every modifier absent (full styling, kept).
        const keep = $.let(eff.excluded.unwrap("some"));
        $(Assert.equal(keep.hasTag("keep"), true));
        $(Assert.equal(keep.unwrap("keep").opacity.hasTag("none"), true));
        $(Assert.equal(keep.unwrap("keep").desaturate.hasTag("none"), true));
        $(Assert.equal(eff.emphasis.unwrap("some").hasTag("halo"), true));
        // `frame: true` ⇒ framed, but no auto-fit.
        $(Assert.equal(eff.frame.unwrap("some").fit.hasTag("none"), true));
    });

    test("layers declaration + per-entity layer tags (items / zones / links) carry through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0, sys: "process" }, { id: "B", x: 5.0, y: 1.0, sys: "maintenance" }],
            {
                extent: { width: 8, height: 6 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id, layer: e.sys }),
                zones: [{ id: "z", name: "Z", x: 0.0, y: 0.0, w: 4.0, h: 3.0 }],
                zone: z => ({ key: z.id, label: z.name, x: z.x, y: z.y, width: z.w, height: z.h, layer: "shell" }),
                links: [{ id: "l", src: "A", dst: "B", lyr: "utilities" }],
                link: l => ({ key: l.id, from: l.src, to: l.dst, layer: l.lyr }),
                layers: [
                    { key: "shell", label: "Shell", tone: "muted", locked: true, opacity: 0.5 },
                    { key: "process", label: "Process", tone: "brand" },
                    { key: "maintenance", label: "Maint", visible: false },
                ],
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        const ls = $.let(root.layers.unwrap("some"));
        $(Assert.equal(ls.size(), 3n));
        const shell = $.let(ls.get(0n));
        $(Assert.equal(shell.key, "shell"));
        $(Assert.equal(shell.label, "Shell"));
        $(Assert.equal(shell.locked.unwrap("some"), true));
        $(Assert.equal(shell.opacity.unwrap("some"), 0.5));
        $(Assert.equal(shell.tone.unwrap("some").hasTag("muted"), true));
        // Unset author visibility ⇒ `none` (resolves to visible); an explicit `false` ships hidden.
        $(Assert.equal(shell.visible.hasTag("none"), true));
        $(Assert.equal(ls.get(2n).visible.unwrap("some"), false));

        // Per-entity layer tags across all three kinds.
        $(Assert.equal(root.items.get(0n).layer.unwrap("some"), "process"));
        $(Assert.equal(root.items.get(1n).layer.unwrap("some"), "maintenance"));
        $(Assert.equal(root.zones.get(0n).layer.unwrap("some"), "shell"));
        $(Assert.equal(root.links.get(0n).layer.unwrap("some"), "utilities"));
    });

    test("no layers ⇒ root.layers none and each entity layer none", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));
        $(Assert.equal(root.layers.hasTag("none"), true));
        $(Assert.equal(root.items.get(0n).layer.hasTag("none"), true));
    });
}, { platformFns: TestImpl });
