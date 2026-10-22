/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic through its carrier (#1384, #1386). `<Schematic>` returns the
 * Schematic as the `Schematic` extension — its payload's bytes beside its kind
 * — and the dispatcher hands it to the renderer registered against that kind,
 * decoding the payload's functions against the registered platform: each
 * kind's rows, read from the floor's records on e3 itself, and the host's
 * selection callbacks, which write a bound State. The host hears each entity
 * named by its kind's slot and its key (§5).
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { ArrayType, East, NullType, StringType, printFor } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { entityId } from "./canvas/drawn.js";
// The Schematic is an extension: its renderer registers as it loads.
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

Element.prototype.scrollIntoView ??= function scrollIntoView() {};

// jsdom lays nothing out: the canvas is given the box a page would give it.
beforeEach(() => {
    for (const [name, px] of [["clientWidth", 1080], ["clientHeight", 540]] as const) {
        Object.defineProperty(HTMLElement.prototype, name, {
            configurable: true,
            get(this: HTMLElement) { return this.hasAttribute("data-schematic-canvas") ? px : 0; },
        });
    }
});

afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

const SELECTED_KEY = "schematic.carrier.selected";
const ZONES_KEY = "schematic.carrier.zones";
const INSIDE_KEY = "schematic.carrier.inside";

/**
 * The floor's racks and the data centre's areas, drawn: a selection of racks
 * writes the references it names to State, and a selection of areas the areas'
 * and the racks' inside them.
 */
const view = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicFloorRacks));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const selected = $.let(State.bind([StringType], SELECTED_KEY, ""));
    const zones = $.let(State.bind([StringType], ZONES_KEY, ""));
    const inside = $.let(State.bind([StringType], INSIDE_KEY, ""));
    const onSelectionChange = $.const(East.function([Schematic.Types.SelectionEvent], NullType, ($2, ev) => {
        $2(selected.write(East.print(ev.selection)));
    }));
    const onZoneSelectionChange = $.const(East.function([Schematic.Types.ZoneSelectionEvent], NullType, ($2, ev) => {
        $2(zones.write(East.print(ev.selection)));
        $2(inside.write(East.print(ev.items)));
    }));
    return Schematic({
        extent: { width: 28, height: 14 },
        items: { racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }) },
        zones: { areas: Schematic.zones(areas, { name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name", pattern: (a) => a.pattern }) },
        onSelectionChange,
        onZoneSelectionChange,
    });
})));

/** What a State holds now. */
const stateOf = (key: string) => East.compile(East.function([], StringType, ($) => {
    const bound = $.const(State.bind([StringType], key, ""));
    return bound.read();
}), getRegisteredPlatformImplementations())();

/** References printed, as East prints an array of them. */
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

describe("<Schematic> through its carrier", () => {
    test("the Schematic is the Schematic extension, and the dispatcher draws it: its navigator lists the areas and the racks inside them", async () => {
        const { container, getByText } = await h.mount({ fn: view });
        await waitFor(() => expect(container.querySelector("[data-schematic-canvas]")).not.toBeNull());
        await waitFor(() => expect(getByText("Cage A")).toBeDefined());
        // The racks outside every outline area lie on the floor, after the areas.
        const listed = () => [...container.querySelectorAll("[data-nav-key]")].map((el) => el.getAttribute("data-nav-key"));
        expect(listed()).toEqual([entityId({ kind: "racks", key: "B01" }), entityId({ kind: "racks", key: "B02" })]);
        fireEvent.click(getByText("Cage A"));
        await waitFor(() => expect(listed()).toContain(entityId({ kind: "racks", key: "A01" })));
    });

    test("a rack selected from the navigator is heard by the host named by its kind and key", async () => {
        const { container } = await h.mount({ fn: view });
        const b01 = entityId({ kind: "racks", key: "B01" });
        await waitFor(() => expect(container.querySelector(`[data-nav-key=${JSON.stringify(b01)}]`)).not.toBeNull());
        fireEvent.click(container.querySelector(`[data-nav-key=${JSON.stringify(b01)}]`)!);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }])));
        await waitFor(() => expect(container.querySelector(`[data-nav-key=${JSON.stringify(b01)}]`)?.hasAttribute("data-selected")).toBe(true));
    });

    test("an area selected from the navigator is heard with the racks inside it, each named by its kind and key", async () => {
        const { getByText } = await h.mount({ fn: view });
        await waitFor(() => expect(getByText("Cage A")).toBeDefined());
        fireEvent.click(getByText("Cage A"));
        await waitFor(() => expect(stateOf(ZONES_KEY)).toBe(printRefs([{ kind: "areas", key: "cage-a" }])));
        expect(stateOf(INSIDE_KEY)).toBe(printRefs(["A01", "A02", "A03", "A04"].map((key) => ({ kind: "racks", key }))));
    });
});
