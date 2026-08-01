/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { East, BooleanType, NullType, StringType, variant, some, type ExprType } from "@elaraai/east";
import { Schematic, Text, UIComponentType } from "@elaraai/east-ui/internal";
import * as ex from "./schematic.examples.js";

describeEast("Schematic", (test) => {
    Assert.examples(test, {
        schematicPlant: ex.schematicPlant,
        schematicStress: ex.schematicStress,
        schematicFacility: ex.schematicFacility,
        schematicLinkEdit: ex.schematicLinkEdit,
        schematicNets: ex.schematicNets,
        schematicVariants: ex.schematicVariants,
        schematicSlice: ex.schematicSlice,
        schematicInteractions: ex.schematicInteractions,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // (schematicInteractions is a configurator — a single Reactive tree, no
    // captions — so Assert.examples coverage suffices for it.)
    // =========================================================================

    test("schematicVariants panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.schematicVariants.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 4n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "MINIMAL"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "LAYERS"));
        $(Assert.equal(rows.get(2n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "GEOMETRY"));
        $(Assert.equal(rows.get(3n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "COLOR OVERRIDE"));
    });

    test("schematicSlice panel mounts one captioned row per merged example", $ => {
        const panel = $.const(ex.schematicSlice.fn() as ExprType<UIComponentType>);
        const rows = $.const(panel.unwrap().unwrap("Stack").children);
        $(Assert.equal(rows.size(), 2n));
        $(Assert.equal(rows.get(0n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "SLICE EFFECT"));
        $(Assert.equal(rows.get(1n).unwrap().unwrap("Stack").children.get(0n).unwrap().unwrap("Text").value, "SELECT FILTER"));
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
        $(Assert.equal(root.nets.size(), 0n));
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
        $(Assert.equal(root.links.get(0n).label.hasTag("none"), true));
        $(Assert.equal(root.links.get(0n).metric.hasTag("none"), true));
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
                links: [{ id: "l1", src: "A", dst: "A", s: Schematic.dashed({ tone: "ink" }), via: [{ x: 5.0, y: 2.0 }], lbl: "recirc", m: "2 m³/h" }],
                link: l => ({ key: l.id, from: l.src, to: l.dst, style: l.s, via: l.via, label: l.lbl, metric: l.m }),
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
        $(Assert.equal(root.links.get(0n).label.unwrap("some"), "recirc"));
        $(Assert.equal(root.links.get(0n).metric.unwrap("some"), "2 m³/h"));
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

    test("excluded flag + flat slice-effect props (ghost + pulse + fitted frame) carry through", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 2.0, y: 2.0, out: true }, { id: "B", x: 5.0, y: 2.0, out: false }],
            {
                extent: { width: 8, height: 6 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id, excluded: e.out }),
                sliceOpacity: 0.25,
                sliceDesaturate: true,
                sliceEmphasis: "pulse",
                sliceFrame: true,
                sliceFrameFit: true,
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));

        $(Assert.equal(root.items.get(0n).excluded.unwrap("some"), true));
        $(Assert.equal(root.items.get(1n).excluded.unwrap("some"), false));

        const eff = $.let(root.sliceEffect.unwrap("some"));
        $(Assert.equal(eff.hidden.hasTag("none"), true));              // kept, not hidden
        $(Assert.equal(eff.opacity.unwrap("some"), 0.25));
        $(Assert.equal(eff.desaturate.unwrap("some"), true));
        $(Assert.equal(eff.dot.hasTag("none"), true));
        $(Assert.equal(eff.emphasis.unwrap("some").hasTag("pulse"), true));
        $(Assert.equal(eff.frame.unwrap("some"), true));
        $(Assert.equal(eff.frameFit.unwrap("some"), true));
    });

    test("slice-effect: `sliceHidden` + `halo`, and unset props default to none", $ => {
        const hide = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                sliceHidden: true,
            },
        ).unwrap().unwrap("Schematic"));
        // Default (unset) item excluded flag is `none`.
        $(Assert.equal(hide.items.get(0n).excluded.hasTag("none"), true));
        const heff = $.let(hide.sliceEffect.unwrap("some"));
        $(Assert.equal(heff.hidden.unwrap("some"), true));
        // No other prop set ⇒ each `none`.
        $(Assert.equal(heff.emphasis.hasTag("none"), true));
        $(Assert.equal(heff.frame.hasTag("none"), true));
        $(Assert.equal(heff.opacity.hasTag("none"), true));

        const bare = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                sliceEmphasis: "halo",
                sliceFrame: true,
            },
        ).unwrap().unwrap("Schematic"));
        const eff = $.let(bare.sliceEffect.unwrap("some"));
        $(Assert.equal(eff.emphasis.unwrap("some").hasTag("halo"), true));
        $(Assert.equal(eff.frame.unwrap("some"), true));
        $(Assert.equal(eff.frameFit.hasTag("none"), true));           // frame on, no auto-fit
        $(Assert.equal(eff.hidden.hasTag("none"), true));             // kept, not hidden
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

    test("net mapper carries sources / destinations / label through; defaults fill the rest", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "M", x: 1.0, y: 1.0 }, { id: "A", x: 5.0, y: 1.0 }, { id: "B", x: 5.0, y: 3.0 }],
            {
                extent: { width: 8, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                nets: [{ id: "n1", srcs: ["M"], dsts: ["A", "B"], name: "supply" }],
                net: n => ({ key: n.id, sources: n.srcs, destinations: n.dsts, label: n.name }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));
        $(Assert.equal(root.nets.size(), 1n));
        const net = $.let(root.nets.get(0n));
        $(Assert.equal(net.key, "n1"));
        $(Assert.equal(net.sources.size(), 1n));
        $(Assert.equal(net.destinations.size(), 2n));
        $(Assert.equal(net.destinations.get(1n), "B"));
        $(Assert.equal(net.label.unwrap("some"), "supply"));
        $(Assert.equal(net.metric.hasTag("none"), true));
        $(Assert.equal(net.style.hasTag("solid"), true));
        $(Assert.equal(net.route.hasTag("orthogonal"), true));
        $(Assert.equal(net.via.size(), 0n));
        $(Assert.equal(net.layer.hasTag("none"), true));
    });

    test("selection defaults: selectionMode / onSelectionChange / onSelect all none", $ => {
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));
        $(Assert.equal(root.selectionMode.hasTag("none"), true));
        $(Assert.equal(root.onSelectionChange.hasTag("none"), true));
        $(Assert.equal(root.onSelect.hasTag("none"), true));
        $(Assert.equal(root.sliceSelectField.hasTag("none"), true));
        $(Assert.equal(root.selectZoomFocus.hasTag("none"), true));
        $(Assert.equal(root.onViewportChange.hasTag("none"), true));
        $(Assert.equal(root.onItemOpen.hasTag("none"), true));
        $(Assert.equal(root.onSelectZone.hasTag("none"), true));
        $(Assert.equal(root.onZoneSelectionChange.hasTag("none"), true));
        $(Assert.equal(root.linkMode.hasTag("none"), true));
        $(Assert.equal(root.onCreateLink.hasTag("none"), true));
        $(Assert.equal(root.onSelectLink.hasTag("none"), true));
        $(Assert.equal(root.onEditLink.hasTag("none"), true));
        $(Assert.equal(root.onDeleteLink.hasTag("none"), true));
        $(Assert.equal(root.readOnly.hasTag("none"), true));
        $(Assert.equal(root.readOnlyLinks.hasTag("none"), true));
        $(Assert.equal(root.readOnlyItems.hasTag("none"), true));
        $(Assert.equal(root.onMoveItem.hasTag("none"), true));
        $(Assert.equal(root.itemHover.hasTag("none"), true));
        $(Assert.equal(root.zoneHover.hasTag("none"), true));
        $(Assert.equal(root.linkHover.hasTag("none"), true));
        $(Assert.equal(root.onEditNet.hasTag("none"), true));
        $(Assert.equal(root.canConnect.hasTag("none"), true));
    });

    test("selectionMode, onSelectionChange, sliceSelectField carry through", $ => {
        const onChange = East.function([Schematic.Types.SelectionEvent], NullType, (_$, _ev) => { });
        const onViewport = East.function([Schematic.Types.ViewportEvent], NullType, (_$, _ev) => { });
        const sch = $.let(Schematic.Root(
            [{ id: "A", x: 1.0, y: 1.0 }],
            {
                extent: { width: 4, height: 4 },
                item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
                selectionMode: "multiple",
                onSelectionChange: onChange,
                onViewportChange: onViewport,
                onItemOpen: East.function([StringType], NullType, (_$, _k) => { }),
                onSelectZone: East.function([StringType], NullType, (_$, _k) => { }),
                onZoneSelectionChange: East.function([Schematic.Types.ZoneSelectionEvent], NullType, (_$, _ev) => { }),
                linkMode: "connect",
                onCreateLink: East.function([Schematic.Types.LinkCreateEvent], NullType, (_$, _ev) => { }),
                onSelectLink: East.function([StringType], NullType, (_$, _k) => { }),
                onEditLink: East.function([Schematic.Types.LinkEditEvent], NullType, (_$, _ev) => { }),
                onDeleteLink: East.function([StringType], NullType, (_$, _k) => { }),
                readOnly: false,
                readOnlyLinks: false,
                readOnlyItems: true,
                onMoveItem: East.function([Schematic.Types.ItemMoveEvent], NullType, (_$, _ev) => { }),
                itemHover: East.function([StringType], UIComponentType, (_$, _k) => Text.Root("item")),
                zoneHover: East.function([StringType], UIComponentType, (_$, _k) => Text.Root("zone")),
                linkHover: East.function([StringType], UIComponentType, (_$, _k) => Text.Root("link")),
                onEditNet: East.function([Schematic.Types.NetEndpoints], NullType, (_$, _ev) => { }),
                canConnect: East.function([StringType, StringType], BooleanType, (_$, _f, _t) => East.value(true)),
                sliceSelectField: "id",
                selectZoomFocus: true,
            },
        ));
        const root = $.let(sch.unwrap().unwrap("Schematic"));
        $(Assert.equal(root.selectionMode.unwrap("some").hasTag("multiple"), true));
        $(Assert.equal(root.onSelectionChange.hasTag("some"), true));
        $(Assert.equal(root.sliceSelectField.unwrap("some"), "id"));
        $(Assert.equal(root.selectZoomFocus.unwrap("some"), true));
        $(Assert.equal(root.onViewportChange.hasTag("some"), true));
        $(Assert.equal(root.onItemOpen.hasTag("some"), true));
        $(Assert.equal(root.onSelectZone.hasTag("some"), true));
        $(Assert.equal(root.onZoneSelectionChange.hasTag("some"), true));
        $(Assert.equal(root.linkMode.unwrap("some").hasTag("connect"), true));
        $(Assert.equal(root.onCreateLink.hasTag("some"), true));
        $(Assert.equal(root.onSelectLink.hasTag("some"), true));
        $(Assert.equal(root.onEditLink.hasTag("some"), true));
        $(Assert.equal(root.onDeleteLink.hasTag("some"), true));
        $(Assert.equal(root.readOnly.unwrap("some"), false));
        $(Assert.equal(root.readOnlyLinks.unwrap("some"), false));
        $(Assert.equal(root.readOnlyItems.unwrap("some"), true));
        $(Assert.equal(root.onMoveItem.hasTag("some"), true));
        $(Assert.equal(root.itemHover.hasTag("some"), true));
        $(Assert.equal(root.zoneHover.hasTag("some"), true));
        $(Assert.equal(root.linkHover.hasTag("some"), true));
        $(Assert.equal(root.onEditNet.hasTag("some"), true));
        $(Assert.equal(root.canConnect.hasTag("some"), true));
    });
}, { platformFns: TestImpl });
