/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * Packed dots on e3 itself (ruled 26 Oct 2026, "Legible dots"; canvas
 * invariant 9): where dots overlap, the painter draws the worst colour on top,
 * and a tap picks the dot drawn on top where it lands — the paint and the hit
 * agree. The data centre's racks are drawn over a floor so large that at Fit
 * their dots, 3.6 m apart, stand a pixel or so apart, each covering its
 * neighbours: A04's, hot, is drawn over A01's, OK, at A01's own centre.
 *
 * jsdom lays nothing out: the canvas is given the box a page would give it,
 * 1080 × 540 px at the client origin.
 */

import { expect, test } from "vitest";
import { waitFor } from "@testing-library/react";
import { ArrayType, East, NullType, printFor, variant } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle } from "../e3-web-mount.test-utils.js";
import { fitted, layOutCanvas, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
layOutCanvas();

/** Where the host keeps the selection. */
const SELECTED = "schematic.packed.dots.selected";

/** The floor: 2,800 × 1,400 m, so its racks' dots overlap at Fit. */
const FLOOR = { width: 2800, height: 1400 };

/** The data centre's racks read whole, their loads' alarms their statuses, the selection kept by the host. */
const packed = { fn: East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicRacks));
    const loads = $.let(Data.bind(ex.schematicRackLoads));
    const selected = $.let(State.bind([ArrayType(Schematic.Types.Ref)], SELECTED, []));
    const onSelect = $.const(East.function([ArrayType(Schematic.Types.Ref)], NullType, ($2, refs) => {
        $2(selected.write(refs));
    }));
    return Schematic({
        id: "packedDots",
        extent: FLOOR,
        onSelect,
        items: {
            racks: Schematic.items(racks, {
                name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
                details: Schematic.details(loads, {
                    status: { field: "alarm", cases: {
                        ok: { label: "OK", tone: variant("success", null), ring: false },
                        warm: { label: "Warm", tone: variant("warning", null), ring: false },
                        hot: { label: "Hot", tone: variant("danger", null), ring: false },
                    } },
                }),
            }),
        },
    });
}))) };

/** Reads what the host keeps of the selection: its State, read through East. */
const readSelected = East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], SELECTED, []));
    return kept.read();
}), getRegisteredPlatformImplementations());
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

test("a tap where packed dots overlap picks the dot drawn on top there — the worst colour — never the nearest centre under it (invariant 9)", async () => {
    const { container } = await h.mount(packed);
    await settle();
    const canvas = container.querySelector<HTMLElement>("[data-schematic-canvas]")!;
    await waitFor(() => expect(canvas.getAttribute("data-lod")).toBe("dot"));
    await settle();
    // At A01's centre — OK, its status the healthiest — A04's dot, hot, is drawn over it: a tap there picks A04.
    await tap(canvas, fitted(FLOOR.width, FLOOR.height), 2.4, 2.9);
    await waitFor(() => expect(printRefs(readSelected())).not.toBe(printRefs([])));
    expect(printRefs(readSelected())).toBe(printRefs([{ kind: "racks", key: "A04" }]));
});
