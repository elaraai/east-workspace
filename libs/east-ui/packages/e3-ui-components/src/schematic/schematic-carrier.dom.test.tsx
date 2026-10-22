/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic through its carrier (#1384, #1386, #1401). `<Schematic>`
 * returns the Schematic as the `Schematic` extension — its payload's bytes
 * beside its kind — and the dispatcher hands it to the renderer registered
 * against that kind, decoding the payload's functions against the registered
 * platform: each kind's rows, read from the data centre's records on e3
 * itself; the host's `onSelect`, which writes the whole selection to a bound
 * State, each entity named by its kind's slot and its key (D34, SC29); the
 * zones' patterns, from each area's own field (SC37); and the host's
 * `canConnect`, which hears each candidate a connect drag would write and
 * refuses one with its words, a candidate it throws over allowed (D34, SC39).
 */

import { describe, expect, test, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { ArrayType, East, IntegerType, NullType, OptionType, StringType, none, parseFor, printFor, some } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness } from "../e3-web-mount.test-utils.js";
import { at as atPx, card, layOutCanvas, tap as tapAt } from "./schematic.test-utils.js";
// The Schematic is an extension: its renderer registers as it loads.
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

/** The canvas laid out as a page would: 1080 × 540 px, so the 28 × 14 m drawing is 38.57 px a metre. */
const canvasLayout = layOutCanvas();

const SELECTED_KEY = "schematic.carrier.selected";
const REPORTS_KEY = "schematic.carrier.reports";
const HEARD_KEY = "schematic.carrier.heard";

/** The veto's words: a fibre run joins two racks, or a rack and a frame, on this floor — never two frames. */
const FRAMES_REFUSED = "Two frames are joined by a cross-connect";

/**
 * The floor's racks, the data centre's network frames, areas and fibre runs:
 * the whole selection written to State, and each candidate a connect drag would
 * write heard and recorded, two frames refused — and a run from B01, which the
 * host's veto has no rule for, thrown over.
 */
const view = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicFloorRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const areas = $.let(Data.bind(ex.schematicAreas));
    const fibre = $.let(Record.bind(ex.schematicFibre, [ex.schematicFibrePatch]));
    const selected = $.let(State.bind([StringType], SELECTED_KEY, ""));
    const reports = $.let(State.bind([IntegerType], REPORTS_KEY, 0n));
    const heard = $.let(State.bind([StringType], HEARD_KEY, ""));
    const onSelect = $.const(East.function([ArrayType(Schematic.Types.Ref)], NullType, ($2, chosen) => {
        $2(selected.write(East.print(chosen)));
        $2(reports.write(reports.read().add(1n)));
    }));
    const canConnect = $.const(East.function([Schematic.Types.Candidate], OptionType(StringType), ($2, c) => {
        $2(heard.write(East.print(c)));
        $2.if(East.equal(c.from.key, "B01"), ($3) => { $3.error(East.str`No cabling rule covers ${c.from.key}`); });
        return East.equal(c.from.kind, "network").and(($3) => East.equal(c.to.kind, "network")).ifElse(($3) => some(FRAMES_REFUSED), ($3) => none);
    }));
    return Schematic({
        id: "carrier",
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        zones: {
            areas: Schematic.zones(areas, {
                name: "Area", icon: "vector-square", x: "x", y: "y", width: "w", height: "h", label: "name",
                pattern: (a) => a.kind.match({ room: (_$3) => Schematic.outline(), cold: (_$3) => Schematic.hatch({ tone: "brand" }), hot: (_$3) => Schematic.hatch({ tone: "warning" }) }),
            }),
        },
        links: {
            fibre: Schematic.links(fibre, {
                name: "Fibre run", icon: "bolt", via: "path",
                from: { field: "from", of: { rack: "racks", frame: "network" } }, to: { field: "to", of: { rack: "racks", frame: "network" } },
            }),
        },
        onSelect,
        canConnect,
    });
})));

/** What a State holds now. */
const stateOf = (key: string) => East.compile(East.function([], StringType, ($) => {
    const bound = $.const(State.bind([StringType], key, ""));
    return bound.read();
}), getRegisteredPlatformImplementations())();

/** How many times the host has heard the selection. */
const reportsOf = () => East.compile(East.function([], IntegerType, ($) => {
    const bound = $.const(State.bind([IntegerType], REPORTS_KEY, 0n));
    return bound.read();
}), getRegisteredPlatformImplementations())();

/** References printed, as East prints an array of them. */
const printRefs = printFor(ArrayType(Schematic.Types.Ref));
const parseRefs = parseFor(ArrayType(Schematic.Types.Ref));

/** The whole selection the host keeps, read back from the text it wrote. */
function selectedRefs() {
    const read = parseRefs(stateOf(SELECTED_KEY));
    if (!read.success) throw new Error(`the host keeps no selection: ${read.error}`);
    return read.value;
}

/**
 * The fibre run the host's selection names, once it is one run: a new row's, its key minted unique among every
 * key the Schematic read and drafted (SC7) — one the record holds none of.
 */
async function newRun(): Promise<string> {
    const refs = await waitFor(() => {
        const now = selectedRefs();
        expect(now.map((ref) => ref.kind)).toEqual(["fibre"]);
        return now;
    });
    const key = refs[0]!.key;
    expect((await h.read(ex.schematicFibre)).has(key)).toBe(false);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
    return key;
}
/** A candidate printed, as East prints one. */
const printCandidate = printFor(Schematic.Types.Candidate);

/** The canvas's px a metre: the 28 × 14 m drawing fitted to the canvas's 1080 × 540 px, the camera at rest. */
const PPU = 1080 / 28;
/** A world point on the canvas, in px from its corner. */
const at = (x: number, y: number) => atPx(PPU, x, y);
/** A tap on the canvas at a world point. */
const tap = (canvas: Element, x: number, y: number) => tapAt(canvas, PPU, x, y);

/** Lets B01's card answer a tap at its centre, as a page would hit it, and gives the card. */
function hitB01(container: HTMLElement): HTMLElement {
    const b01 = card(container, "racks", "B01")!;
    canvasLayout.hits((x, y) => (Math.hypot(x - 2.4 * PPU, y - 8.6 * PPU) < 4 ? b01 : null));
    return b01;
}

describe("<Schematic> through its carrier", () => {
    test("the Schematic is the Schematic extension, and the dispatcher draws it in its frame: the toolbar's tools over the canvas's cards (#1387)", async () => {
        const { container, getByRole } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "B01")).not.toBeNull());
        expect(container.querySelector("[data-builder-frame] [data-frame-slot=main] [data-schematic-canvas]")).not.toBeNull();
        // The tools: Select, Zoom box and Marquee, and Connect over the fibre runs, bound with their patch door; no item kind edits, so no Move.
        expect(getByRole("radiogroup", { name: "Tool" })).toBeDefined();
        const tools = [...container.querySelectorAll('[data-schematic-seg="tools"] [role=radio]')].map((radio) => radio.textContent);
        expect(tools).toEqual(["Select", "Zoom box", "Marquee", "Connect"]);
        expect(getByRole("radio", { name: "Select" }).getAttribute("aria-checked")).toBe("true");
    });

    test("a rack tapped on the canvas is heard by `onSelect`, named by its kind and key (SC29)", async () => {
        const { container } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "B01")).not.toBeNull());
        const b01 = hitB01(container);
        await tap(container.querySelector("[data-schematic-canvas]")!, 2.4, 8.6);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }])));
        await waitFor(() => expect(b01.hasAttribute("data-selected")).toBe(true));
    });

    test("an area selected beside a rack is heard with it: the whole selection, each entity by its kind and key (SC29)", async () => {
        const { container } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "B01")).not.toBeNull());
        hitB01(container);
        const canvas = container.querySelector("[data-schematic-canvas]")!;
        await tap(canvas, 2.4, 8.6);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }])));
        // Cage A, outlined, clear of its racks: a tap on it selects it beside the rack.
        await tap(canvas, 10.0, 1.0);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }, { kind: "areas", key: "cage-a" }])));
    });

    test("an area's pattern comes from its own `kind`: a room, outlined, takes a tap and is heard; an aisle, hatched, is an annotation a tap passes through (SC37)", async () => {
        const { container } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
        const canvas = container.querySelector("[data-schematic-canvas]")!;
        // Cold aisle A, a `cold` area, is hatched: a tap in it, clear of every rack and fibre run, selects nothing.
        await tap(canvas, 14.0, 6.6);
        expect(reportsOf()).toBe(0n);
        // Cage A, a `room`, is outlined: a tap in it, clear of its racks, selects it.
        await tap(canvas, 10.0, 1.0);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "areas", key: "cage-a" }])));
    });

    test("a fibre run tapped on its path is heard by `onSelect`, named by its kind and key (SC29)", async () => {
        const { container } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "network", "ODF-1")).not.toBeNull());
        // u1 runs from A01 (2.4, 2.9) down to ODF-1's level, then across to it (8.4, 9.6): its path crosses (5.2, 9.6), where no card is.
        await tap(container.querySelector("[data-schematic-canvas]")!, 5.2, 9.6);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    });

    test("Esc clears the whole selection, and the host hears it empty, once (SC29)", async () => {
        const { container } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "B01")).not.toBeNull());
        hitB01(container);
        const canvas = container.querySelector("[data-schematic-canvas]")!;
        await tap(canvas, 2.4, 8.6);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }])));
        await tap(canvas, 10.0, 1.0);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "racks", key: "B01" }, { kind: "areas", key: "cage-a" }])));
        expect(reportsOf()).toBe(2n);
        fireEvent.pointerEnter(canvas);
        // One gesture clears the items, the zones and the link: the host hears it once.
        await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([])));
        expect(reportsOf()).toBe(3n);
        // A tap on the bare floor clears what is already clear: the host hears nothing new.
        await tap(canvas, 14.0, 13.5);
        expect(reportsOf()).toBe(3n);
    });

    test("`canConnect` hears each candidate a connect drag would write; its words refuse it, and `none` lets it snap and record (SC39)", async () => {
        const { container, getByRole } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "network", "ODF-1")).not.toBeNull());
        const cards = {
            A01: card(container, "racks", "A01")!, A02: card(container, "racks", "A02")!,
            ODF1: card(container, "network", "ODF-1")!, MMR1: card(container, "network", "MMR-1")!,
        };
        // Each card answers at its centre, as a page would hit it.
        const centres: readonly (readonly [Element, number, number])[] = [[cards.A01, 2.4, 2.9], [cards.A02, 6.0, 2.9], [cards.ODF1, 8.4, 9.6], [cards.MMR1, 24.2, 2.9]];
        canvasLayout.hits((x, y) => centres.find(([, cx, cy]) => Math.hypot(x - cx * PPU, y - cy * PPU) < 4)?.[0] ?? null);
        fireEvent.click(getByRole("radio", { name: "Connect" }));
        const canvas = container.querySelector("[data-schematic-canvas]")!;
        // From a frame to a frame: refused, its words kept, and the target rings danger.
        await act(async () => {
            fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(8.4, 9.6) });
            fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(24.2, 2.9) });
        });
        expect(stateOf(HEARD_KEY)).toBe(printCandidate({ kind: "fibre", from: { kind: "network", key: "ODF-1" }, to: { kind: "network", key: "MMR-1" } }));
        await waitFor(() => expect(cards.MMR1.hasAttribute("data-forbidden")).toBe(true));
        // On to a rack: allowed, and the frame it left rings no longer.
        await act(async () => { fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(6.0, 2.9) }); });
        expect(stateOf(HEARD_KEY)).toBe(printCandidate({ kind: "fibre", from: { kind: "network", key: "ODF-1" }, to: { kind: "racks", key: "A02" } }));
        await waitFor(() => expect(cards.MMR1.hasAttribute("data-forbidden")).toBe(false));
        expect(cards.A02.hasAttribute("data-forbidden")).toBe(false);
        // Back to the frame, and let go there: refused, so nothing is recorded.
        await act(async () => { fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(24.2, 2.9) }); });
        await waitFor(() => expect(cards.MMR1.hasAttribute("data-forbidden")).toBe(true));
        await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(24.2, 2.9) }); });
        // From a rack to the frame: allowed, and let go there, the run is recorded.
        await act(async () => {
            fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(2.4, 2.9) });
            fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(24.2, 2.9) });
        });
        expect(stateOf(HEARD_KEY)).toBe(printCandidate({ kind: "fibre", from: { kind: "racks", key: "A01" }, to: { kind: "network", key: "MMR-1" } }));
        expect(cards.MMR1.hasAttribute("data-forbidden")).toBe(false);
        await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(24.2, 2.9) }); });
        fireEvent.click(getByRole("radio", { name: "Select" }));
        // Where the refused run would lie — along y 9.6, out to MMR-1's column — a tap finds the network room beneath.
        await tap(canvas, 20.0, 9.6);
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([{ kind: "areas", key: "net-room" }])));
        fireEvent.pointerEnter(canvas);
        await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
        await waitFor(() => expect(stateOf(SELECTED_KEY)).toBe(printRefs([])));
        // The recorded run lies along the racks' row, A01 to MMR-1: a tap past A04 finds it, under a key minted new.
        await tap(canvas, 19.0, 2.9);
        await newRun();
    });

    test("a veto that throws allows the candidate, and the console says why (SC39)", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { container, getByRole } = await h.mount({ fn: view });
        await waitFor(() => expect(card(container, "racks", "B01")).not.toBeNull());
        const cards = { B01: card(container, "racks", "B01")!, MMR1: card(container, "network", "MMR-1")! };
        const centres: readonly (readonly [Element, number, number])[] = [[cards.B01, 2.4, 8.6], [cards.MMR1, 24.2, 2.9]];
        canvasLayout.hits((x, y) => centres.find(([, cx, cy]) => Math.hypot(x - cx * PPU, y - cy * PPU) < 4)?.[0] ?? null);
        fireEvent.click(getByRole("radio", { name: "Connect" }));
        const canvas = container.querySelector("[data-schematic-canvas]")!;
        // The host's veto has no rule for B01, and throws: the frame is no refusal's target, and the console says why.
        await act(async () => {
            fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(2.4, 8.6) });
            fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(24.2, 2.9) });
        });
        expect(stateOf(HEARD_KEY)).toBe(printCandidate({ kind: "fibre", from: { kind: "racks", key: "B01" }, to: { kind: "network", key: "MMR-1" } }));
        expect(cards.MMR1.hasAttribute("data-forbidden")).toBe(false);
        expect(logged).toHaveBeenCalledWith("[Schematic] canConnect veto failed (allowing):", expect.anything());
        // Let go: the run is recorded, along B01's row out to MMR-1's column, where a tap finds it.
        await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(24.2, 2.9) }); });
        fireEvent.click(getByRole("radio", { name: "Select" }));
        await tap(canvas, 17.0, 8.6);
        await newRun();
    });
});
