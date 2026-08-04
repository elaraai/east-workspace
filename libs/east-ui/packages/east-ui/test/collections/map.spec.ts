/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describeEast, Assert, TestImpl } from "@elaraai/east-node-std";
import { variant, some, type ExprType } from "@elaraai/east";
import { Map } from "@elaraai/east-ui/internal";
import { UIComponentType } from "@elaraai/east-ui";
import * as ex from "./map.examples.js";

describeEast("Map", (test) => {
    Assert.examples(test, {
        mapBasic: ex.mapBasic,
        mapOverlayVariants: ex.mapOverlayVariants,
    });

    // =========================================================================
    // Panels — every merged example stays mounted as a captioned row (#461).
    // The mono-uppercase Text captions are the stable per-mini anchors.
    // =========================================================================

    test("mapOverlayVariants drives its preview from inline option tables", $ => {
        // Everything the configurator needs — the overlay-preset table
        // routing between the five canvases plus the area-click aside — is
        // declared inside the example body, because the documentation capture
        // only extracts `fn`. That puts the tables inside the Reactive body,
        // which TestImpl does not execute, so they cannot be asserted from
        // here; `Assert.examples` above still compiles and evaluates the
        // outer function. The per-option coverage lives in the Map.Root tests
        // below, which construct each option directly.
        const panel = $.const(ex.mapOverlayVariants.fn() as ExprType<UIComponentType>);
        $(Assert.equal(panel.unwrap().hasTag("ReactiveComponent"), true));
    });

    test("resolves markers with defaults and an empty canvas", $ => {
        const m = $.let(Map.Root(
            [{ id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor" }],
            {
                center: Map.at(-34.881, 138.6), zoom: 12n,
                marker: p => ({ key: p.id, lat: p.lat, lng: p.lng, label: p.name }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Map"));

        // markers resolve; `at` is built from lat / lng
        $(Assert.equal(root.markers.size(), 1n));
        $(Assert.equal(root.markers.get(0n).key, "okafor"));
        $(Assert.equal(root.markers.get(0n).at.lat, -34.842));
        $(Assert.equal(root.markers.get(0n).at.lng, 138.598));
        $(Assert.equal(root.markers.get(0n).label.unwrap("some"), "J. Okafor"));
        $(Assert.equal(root.markers.get(0n).icon.hasTag("none"), true));
        $(Assert.equal(root.markers.get(0n).minZoom.hasTag("none"), true));
        $(Assert.equal(root.markers.get(0n).interactive.hasTag("none"), true));

        // empty tables
        $(Assert.equal(root.areas.size(), 0n));
        $(Assert.equal(root.lines.size(), 0n));
        $(Assert.equal(root.labels.size(), 0n));
        $(Assert.equal(root.overlays.size(), 0n));

        // tiles default to CARTO Positron
        $(Assert.equal(root.tiles.hasTag("carto"), true));
        $(Assert.equal(root.tiles.unwrap("carto").style.hasTag("positron"), true));

        // scalar option defaults
        $(Assert.equal(root.center.lat, -34.881));
        $(Assert.equal(root.zoom, 12n));
        $(Assert.equal(root.minZoom.hasTag("none"), true));
        $(Assert.equal(root.lodZoom.hasTag("none"), true));
        $(Assert.equal(root.fitBounds.hasTag("none"), true));
        $(Assert.equal(root.hexes.hasTag("none"), true));
        $(Assert.equal(root.scrollWheelZoom.hasTag("none"), true));
        $(Assert.equal(root.attributionPrefix.hasTag("none"), true));
        $(Assert.equal(root.height.hasTag("none"), true));
        $(Assert.equal(root.onAreaClick.hasTag("none"), true));
    });

    test("areas resolve with status / tone / pulse / flyTo defaults to none", $ => {
        const m = $.let(Map.Root(
            [],
            {
                center: Map.at(-34.881, 138.6), zoom: 12n,
                areas: [{ id: "5000", lat: -34.9258, lng: 138.5994, name: "5000 · CBD" }],
                area: a => ({ key: a.id, label: a.name, shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n) }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Map"));

        $(Assert.equal(root.areas.size(), 1n));
        const area = $.let(root.areas.get(0n));
        $(Assert.equal(area.key, "5000"));
        $(Assert.equal(area.shape.hasTag("hexDisk"), true));
        $(Assert.equal(area.shape.unwrap("hexDisk").resolution, 8n));
        $(Assert.equal(area.label.unwrap("some"), "5000 · CBD"));
        $(Assert.equal(area.detailLabel.hasTag("none"), true));
        $(Assert.equal(area.status.hasTag("none"), true));
        $(Assert.equal(area.tone.hasTag("none"), true));
        $(Assert.equal(area.pulse.hasTag("none"), true));
        $(Assert.equal(area.flyTo.hasTag("none"), true));
        $(Assert.equal(area.interactive.hasTag("none"), true));
    });

    test("markers default to an empty table when omitted; area interactive carries through", $ => {
        const m = $.let(Map.Root(
            undefined,
            {
                center: Map.at(-34.881, 138.6), zoom: 12n,
                areas: [{ id: "5000", lat: -34.9258, lng: 138.5994 }],
                area: a => ({ key: a.id, shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n), interactive: false }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Map"));
        $(Assert.equal(root.markers.size(), 0n));
        $(Assert.equal(root.areas.get(0n).interactive.unwrap("some"), false));
    });

    test("status / tone / dashed-line-with-arrow carry through", $ => {
        const m = $.let(Map.Root(
            [],
            {
                center: Map.at(-34.881, 138.6), zoom: 12n,
                tiles: Map.osm(),
                areas: [{ id: "5100", lat: -34.836, lng: 138.6, name: "5100", st: some(variant("danger", null)) }],
                area: a => ({
                    key: a.id, label: a.name, tone: "danger",
                    shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n), status: a.st,
                }),
                lines: [{ id: "move" }],
                line: l => ({
                    key: l.id,
                    points: [Map.at(-34.905, 138.6), Map.at(-34.852, 138.6)],
                    style: Map.dashed({ tone: "brand" }),
                    arrow: true,
                }),
            },
        ));
        const root = $.let(m.unwrap().unwrap("Map"));

        $(Assert.equal(root.tiles.hasTag("osm"), true));
        const area = $.let(root.areas.get(0n));
        $(Assert.equal(area.status.unwrap("some").hasTag("danger"), true));
        $(Assert.equal(area.tone.unwrap("some").hasTag("danger"), true));
        const line = $.let(root.lines.get(0n));
        $(Assert.equal(line.style.hasTag("dashed"), true));
        $(Assert.equal(line.style.unwrap("dashed").tone.unwrap("some").hasTag("brand"), true));
        $(Assert.equal(line.points.size(), 2n));
        $(Assert.equal(line.flow.hasTag("none"), true));
        $(Assert.equal(line.arrow.unwrap("some"), true));
    });

    test("hex lattice and custom height carry through", $ => {
        const m = $.let(Map.Root(
            [],
            {
                center: Map.at(-34.881, 138.6), zoom: 12n,
                hexes: Map.hex({ lattice: { center: Map.at(-34.881, 138.6), k: 11n, resolution: 8n }, tone: "muted" }),
                height: "540px",
            },
        ));
        const root = $.let(m.unwrap().unwrap("Map"));

        $(Assert.equal(root.hexes.unwrap("some").lattice.unwrap("some").k, 11n));
        $(Assert.equal(root.hexes.unwrap("some").lattice.unwrap("some").resolution, 8n));
        $(Assert.equal(root.hexes.unwrap("some").tone.unwrap("some").hasTag("muted"), true));
        $(Assert.equal(root.height.unwrap("some"), "540px"));
    });
}, { platformFns: TestImpl });
