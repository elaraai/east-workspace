/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * The Schematic in its frame, on e3 itself (#1387, `Schematic Builder Spec.md`
 * §6): each example mounted as the showcase mounts it, its kinds' records read
 * through e3-web. The toolbar holds §6.1's items in order (SC24) — the rail,
 * the tools, the zoom and Fit, Find, the steps while something is selected,
 * and the history while a record is edited — and folds the rail first, then
 * its own, the history last; the tool held is the viewer's, kept
 * under the Schematic's `id`, and Connect's menu picks the link kind it draws.
 * The keys (SC28): arrows step the selection, Esc clears it, Del deletes the
 * selected link (a step of the editing's history, #1388), Space and Ctrl hold
 * Select and Zoom box, ⌘F focuses Find. The
 * footer counts each item kind's items drawn of its rows, the zones, links and
 * nets, and each record's last save (§6.3). The frame's skeleton covers the
 * first read, later reads keep the canvas, and a failed read is a banner with
 * Retry (SC32). A card's dot and the canvas's probe resolve one colour chain
 * (SC26), and the canvas sets nothing inline but geometry (SC31).
 */

import { expect, test, vi } from "vitest";
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrayType, East, OptionType, StringType, none, printFor, some } from "@elaraai/east";
import { Reactive, State, UIComponentType } from "@elaraai/east-ui/internal";
import { getRegisteredPlatformImplementations } from "@elaraai/east-ui-components";
import { Data, Record, Schematic } from "@elaraai/e3-ui/internal";
import * as ex from "@elaraai/e3-ui/examples/schematic/schematic";
import { e3Harness, settle, slot } from "../e3-web-mount.test-utils.js";
import { at, card, layOutCanvas, tap } from "./schematic.test-utils.js";
import "./index.js";

const h = e3Harness({ "schematic/schematic": ex }, { main: "data-schematic-canvas" });

// jsdom lays nothing out: the canvas is given the box a page would give it, 1080 × 540 px.
const canvasLayout = layOutCanvas();

/** The data centre's px a metre: its 28 × 14 m drawing fitted to the canvas's 1080 × 540 px. */
const PPU = 1080 / 28;

/** Longer than a fly takes (350 ms): run on the test's clock, it lands. */
const FLY_MS = 400;

/** One animation frame, and a little over. */
const FRAME_MS = 20;

/** What the data centre's host keeps of the selection, as East prints it. */
const keptSelection = () => printFor(ArrayType(Schematic.Types.Ref))(East.compile(East.function([], ArrayType(Schematic.Types.Ref), ($) => {
    const kept = $.const(State.bind([ArrayType(Schematic.Types.Ref)], "ex.schematicDataCentre.selected", []));
    return kept.read();
}), getRegisteredPlatformImplementations())());
/** References printed, as East prints an array of them. */
const printRefs = printFor(ArrayType(Schematic.Types.Ref));

/** The canvas. */
const canvasOf = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-schematic-canvas]")!;

/** The toolbar's row. */
const rowOf = (container: HTMLElement) => slot(container, "toolbar").querySelector<HTMLElement>("[data-toolbar]")!;

/** The toolbar's items, in the row's order. */
const itemsOf = (container: HTMLElement) => rowOf(container).getAttribute("data-toolbar-state")!.split(";").map((part) => part.split("=")[0]!);

/** The toolbar's fold steps, in the order they apply. */
const ladderOf = (container: HTMLElement) => rowOf(container).getAttribute("data-toolbar-ladder")!.split(" ");

/** Lets each card answer a tap at its centre, as a page would hit it. */
function hits(container: HTMLElement, centres: readonly (readonly [kind: string, key: string, x: number, y: number])[]) {
    const at = centres.map(([kind, key, x, y]) => [card(container, kind, key)!, x, y] as const);
    canvasLayout.hits((px, py) => at.find(([, x, y]) => Math.hypot(px - x * PPU, py - y * PPU) < 4)?.[0] ?? null);
}

/** Mounts the data centre, and waits until its racks are drawn. */
async function dataCentre() {
    const ui = await h.mount(ex.schematicDataCentre);
    await settle();
    await waitFor(() => expect(card(ui.container, "racks", "A05")).not.toBeNull());
    return ui;
}

// ── The toolbar (§6.1, SC24) ────────────────────────────────────────────────

test("the toolbar holds §6.1's items in order — the rail, the tools, the zoom and Fit, Find, the steps while something is selected, and the history — and folds the rail first (SC24)", async () => {
    const { container } = await dataCentre();
    const rail = itemsOf(container).filter((key) => key.startsWith("record-"));
    expect(rail.length).toBeGreaterThan(0);
    // The data centre edits its records: the history ends the row (#1388).
    expect(itemsOf(container)).toEqual([...rail, "tools", "zoom", "seek", "history"]);
    // The rail's steps come first, its summary's after them; then the Schematic's own, the View last, one move; and the
    // history's after every one of them.
    const own = ["tools>1", "seek>1", "tools>2", "tools>3", "zoom>1", "seek>2"];
    const ladder = ladderOf(container);
    expect(ladder.filter((step) => !step.startsWith("record-"))).toEqual([...own, "history>1"]);
    expect(ladder.slice(0, ladder.length - own.length - 1).every((step) => step.startsWith("record-"))).toBe(true);
    // Something selected: the steps to the previous and the next item show, after Find, and fold into the View with it.
    hits(container, [["racks", "A05", 16.8, 2.9]]);
    await tap(canvasOf(container), PPU, 16.8, 2.9);
    await waitFor(() => expect(itemsOf(container)).toEqual([...rail, "tools", "zoom", "seek", "step", "history"]));
    expect(ladderOf(container).filter((step) => !step.startsWith("record-"))).toEqual([...own, "step>1", "history>1"]);
    // Nothing selected again: the steps go.
    fireEvent.pointerEnter(canvasOf(container));
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    await waitFor(() => expect(itemsOf(container)).toEqual([...rail, "tools", "zoom", "seek", "history"]));
});

test("the steps walk the items in order, flying to each and selecting it; Zoom and Fit move the camera", async () => {
    const { container, getByRole } = await dataCentre();
    // The layer the cards ride holds the camera, and stays while cards come and go.
    const layer = card(container, "racks", "A05")!.parentElement!;
    const ppu = () => Number(layer.style.getPropertyValue("--cam-ppu"));
    hits(container, [["racks", "A05", 16.8, 2.9]]);
    await tap(canvasOf(container), PPU, 16.8, 2.9);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A05" }])));
    // The camera moves over animation frames — a step's fly, Zoom's and Fit's paint: the test runs them on a clock of its
    // own, so each lands however busy the machine running it is.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        const frames = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
        // Cage A's items, by their names: A01 … A05, then PDU-A and PDU-B.
        await act(async () => { fireEvent.click(getByRole("button", { name: "Next item" })); });
        await frames(FLY_MS);
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "pdus", key: "PDU-A" }])));
        // Landed on it, zoomed in: its card draws, selected.
        expect(ppu()).toBeGreaterThan(PPU);
        expect(card(container, "pdus", "PDU-A")?.hasAttribute("data-selected")).toBe(true);
        await act(async () => { fireEvent.click(getByRole("button", { name: "Previous item" })); });
        await frames(FLY_MS);
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A05" }])));
        expect(card(container, "racks", "A05")?.hasAttribute("data-selected")).toBe(true);
        // Fit puts the camera over the whole floor; Zoom in moves it; Fit puts it back.
        await act(async () => { fireEvent.click(getByRole("button", { name: "Fit" })); });
        await frames(FRAME_MS);
        expect(ppu()).toBeCloseTo(PPU, 6);
        await act(async () => { fireEvent.click(getByRole("button", { name: "Zoom in" })); });
        await frames(FRAME_MS);
        expect(ppu()).toBeGreaterThan(PPU);
        await act(async () => { fireEvent.click(getByRole("button", { name: "Fit" })); });
        await frames(FRAME_MS);
        expect(ppu()).toBeCloseTo(PPU, 6);
    } finally {
        vi.useRealTimers();
    }
});

test("the tools: the data centre's every one, its Move over its editable racks and Connect over its fibre runs; the tool held is the viewer's, kept under the Schematic's id", async () => {
    const first = await dataCentre();
    const tools = () => [...slot(first.container, "toolbar").querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.textContent);
    expect(tools()).toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
    expect(first.getByRole("radio", { name: "Select" }).getAttribute("aria-checked")).toBe("true");
    expect(canvasOf(first.container).getAttribute("data-tool")).toBe("select");
    // One link kind: Connect needs no menu.
    expect(first.container.querySelector("[data-schematic-segmenu='link']")).toBeNull();
    await act(async () => { fireEvent.click(first.getByRole("radio", { name: "Marquee" })); });
    expect(first.getByRole("radio", { name: "Marquee" }).getAttribute("aria-checked")).toBe("true");
    expect(canvasOf(first.container).getAttribute("data-tool")).toBe("marquee");
    // Mounted again, the Schematic holds the tool the viewer left it with.
    first.unmount();
    const second = await dataCentre();
    expect(second.getByRole("radio", { name: "Marquee" }).getAttribute("aria-checked")).toBe("true");
    expect(canvasOf(second.container).getAttribute("data-tool")).toBe("marquee");
});

test("a Schematic whose kinds are read only offers Select, Zoom box and Marquee alone", async () => {
    const { container } = await h.mount(ex.schematicFloor);
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    expect([...slot(container, "toolbar").querySelectorAll("[data-schematic-seg='tools'] [role=radio]")].map((radio) => radio.textContent))
        .toEqual(["Select", "Zoom box", "Marquee"]);
});

const HEARD_KEY = "schematic.frame.heard";

/** The floor's racks and the data centre's network frames, joined by fibre runs read as two link kinds, each bound with its patch door: what Connect may draw. */
const twoRuns = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicFloorRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    const fibre = $.let(Record.bind(ex.schematicFibre, [ex.schematicFibrePatch]));
    const heard = $.let(State.bind([StringType], HEARD_KEY, ""));
    const canConnect = $.const(East.function([Schematic.Types.Candidate], OptionType(StringType), ($2, candidate) => {
        $2(heard.write(East.print(candidate)));
        return $2.let(none, OptionType(StringType));
    }));
    const ends = { field: "from", of: { rack: "racks", frame: "network" } } as const;
    return Schematic({
        id: "runs",
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
        links: {
            fibre: Schematic.links(fibre, { name: "Fibre run", icon: "bolt", via: "path", from: ends, to: { ...ends, field: "to" } }),
            uplinks: Schematic.links(fibre, { name: "Uplink", icon: "bolt", via: "path", from: ends, to: { ...ends, field: "to" } }),
        },
        canConnect,
    });
})));

/** What the view's veto last heard. */
const heard = () => East.compile(East.function([], StringType, ($) => {
    const bound = $.const(State.bind([StringType], HEARD_KEY, ""));
    return bound.read();
}), getRegisteredPlatformImplementations())();

test("over two editable link kinds, Connect's menu picks the kind it draws — the first until the viewer picks — and Connect draws it", async () => {
    const { container, getByRole } = await h.mount({ fn: twoRuns });
    await waitFor(() => expect(card(container, "network", "MMR-1")).not.toBeNull());
    const menu = container.querySelector<HTMLElement>("[data-schematic-segmenu='link']")!;
    expect(menu.textContent).toBe("Fibre run");
    await act(async () => { fireEvent.click(menu); });
    await waitFor(() => expect([...document.querySelectorAll("[role=menuitem]")].map((item) => item.textContent)).toEqual(["Fibre run", "Uplink"]));
    const uplink = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((item) => item.textContent === "Uplink")!;
    await act(async () => { fireEvent.pointerDown(uplink); });
    await act(async () => { fireEvent.click(uplink); });
    await waitFor(() => expect(document.querySelector("[role=menu]")).toBeNull());
    // Picking a kind holds Connect, drawing it.
    expect(getByRole("radio", { name: "Connect" }).getAttribute("aria-checked")).toBe("true");
    expect(container.querySelector("[data-schematic-segmenu='link']")!.textContent).toBe("Uplink");
    hits(container, [["racks", "A01", 2.4, 2.9], ["network", "MMR-1", 24.2, 2.9]]);
    const canvas = canvasOf(container);
    await act(async () => {
        fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(PPU, 2.4, 2.9) });
        fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: "mouse", buttons: 1, ...at(PPU, 24.2, 2.9) });
    });
    expect(heard()).toBe(printFor(Schematic.Types.Candidate)({ kind: "uplinks", from: { kind: "racks", key: "A01" }, to: { kind: "network", key: "MMR-1" } }));
    await act(async () => { fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: "mouse", button: 0, ...at(PPU, 24.2, 2.9) }); });
});

// ── The keys (SC28) ─────────────────────────────────────────────────────────

test("arrows step the selection, flying to each item; Esc clears it; Del deletes the selected link (SC28)", async () => {
    const { container, getByRole } = await dataCentre();
    const canvas = canvasOf(container);
    canvas.focus();
    // The camera moves over animation frames — each step's fly, and Fit's paint: the test runs them on a clock of its own,
    // so each lands however busy the machine running it is, and a tap after Fit meets the floor Fit drew.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    try {
        const frames = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
        // From nothing selected, the first item in order: Cage A's first rack by name.
        await act(async () => { fireEvent.keyDown(canvas, { key: "ArrowRight" }); });
        await frames(FLY_MS);
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A01" }])));
        // Flown to it: its card wears the selection.
        expect(card(container, "racks", "A01")?.hasAttribute("data-selected")).toBe(true);
        await act(async () => { fireEvent.keyDown(canvas, { key: "ArrowDown" }); });
        await frames(FLY_MS);
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A02" }])));
        await act(async () => { fireEvent.keyDown(canvas, { key: "ArrowLeft" }); });
        await frames(FLY_MS);
        await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A01" }])));
        // Esc, with the pointer over the canvas: the selection clears.
        fireEvent.pointerEnter(canvas);
        await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
        await waitFor(() => expect(keptSelection()).toBe(printRefs([])));
        // Fit, back to the whole floor, drawn.
        await act(async () => { fireEvent.click(getByRole("button", { name: "Fit" })); });
        await frames(FRAME_MS);
    } finally {
        vi.useRealTimers();
    }
    // A run tapped on its path — u1, from A01 straight down to ODF-1's top — is selected; Del deletes it, and a tap where it
    // ran finds nothing.
    await tap(canvas, PPU, 2.4, 6.0);
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "fibre", key: "u1" }])));
    await act(async () => { fireEvent.keyDown(window, { key: "Delete" }); });
    await waitFor(() => expect(keptSelection()).toBe(printRefs([])));
    await tap(canvas, PPU, 2.4, 6.0);
    await settle();
    expect(keptSelection()).toBe(printRefs([]));
});

test("Space held over the canvas holds Select, and Ctrl Zoom box, until let go (SC28)", async () => {
    const { container, getByRole } = await dataCentre();
    await act(async () => { fireEvent.click(getByRole("radio", { name: "Marquee" })); });
    const canvas = canvasOf(container);
    // Not over the canvas: Space is the page's.
    await act(async () => { fireEvent.keyDown(window, { code: "Space", key: " " }); });
    expect(canvas.getAttribute("data-tool")).toBe("marquee");
    await act(async () => { fireEvent.keyUp(window, { code: "Space", key: " " }); });
    fireEvent.pointerEnter(canvas);
    await act(async () => { fireEvent.keyDown(window, { code: "Space", key: " " }); });
    expect(canvas.getAttribute("data-tool")).toBe("select");
    await act(async () => { fireEvent.keyUp(window, { code: "Space", key: " " }); });
    expect(canvas.getAttribute("data-tool")).toBe("marquee");
    await act(async () => { fireEvent.keyDown(window, { key: "Control", ctrlKey: true }); });
    expect(canvas.getAttribute("data-tool")).toBe("zoom");
    await act(async () => { fireEvent.keyUp(window, { key: "Control" }); });
    expect(canvas.getAttribute("data-tool")).toBe("marquee");
    // The toolbar shows the tool held, not the one a key holds for a moment.
    expect(getByRole("radio", { name: "Marquee" }).getAttribute("aria-checked")).toBe("true");
});

test("⌘F, or Ctrl+F, anywhere in the frame focuses Find (SC28)", async () => {
    const { container } = await dataCentre();
    const input = slot(container, "toolbar").querySelector<HTMLInputElement>("[data-toolbar-item='seek'] input")!;
    const canvas = canvasOf(container);
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "f", metaKey: true }); });
    expect(document.activeElement).toBe(input);
    canvas.focus();
    await act(async () => { fireEvent.keyDown(slot(container, "footer"), { key: "f", ctrlKey: true }); });
    expect(document.activeElement).toBe(input);
});

test("Find finds an item by its key, and a pick flies to it and selects it", async () => {
    const { container } = await dataCentre();
    const search = slot(container, "toolbar").querySelector<HTMLElement>("[data-toolbar-item='seek'] [data-part='dataset-key-search']")!;
    const input = search.querySelector<HTMLInputElement>("input")!;
    for (const key of "A03") {
        const typed = input.value + key;
        await userEvent.type(input, key);
        await waitFor(() => expect(input.value).toBe(typed));
    }
    await waitFor(() => expect(search.textContent).toMatch(/1 match/), { timeout: 5_000 });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(keptSelection()).toBe(printRefs([{ kind: "racks", key: "A03" }])));
    await waitFor(() => expect(card(container, "racks", "A03")?.hasAttribute("data-selected")).toBe(true));
});

// ── The footer (§6.3) ───────────────────────────────────────────────────────

/** The footer's lines, as they read. */
const footerOf = (container: HTMLElement) => [...slot(container, "footer").querySelectorAll("[data-schematic-footer] > *")].map((line) => line.textContent);

test("the footer counts each item kind's items drawn of its rows, the zones, the links and the nets, and says when each record was last saved (§6.3)", async () => {
    const { container } = await dataCentre();
    await waitFor(() => expect(footerOf(container).slice(0, 7)).toEqual([
        "Rack 5 of 7", "Network frame 3", "Cooling unit 3", "Power distribution unit 2", "5 zones", "6 links", "2 nets",
    ]));
    // The racks, the cooling units, the fibre runs, the power feeds and the fibre trunks are bound with their patch doors: each
    // record's last save, its time today.
    await waitFor(() => expect(footerOf(container).slice(7).map((line) => line?.replace(/saved .*$/u, "saved"))).toEqual([
        "Rack saved", "Cooling unit saved", "Fibre run saved", "Power feed saved", "Fibre trunk saved",
    ]));
    // Another session takes A05 off the floor: four drawn of seven.
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks, ["A05", { ...racks.get("A05")!, x: none, y: none }]]));
    await waitFor(() => expect(footerOf(container)[0]).toBe("Rack 4 of 7"));
});

test("a Schematic whose kinds are read whole counts the rows it read, and says no save", async () => {
    const { container } = await h.mount(ex.schematicFloor);
    await waitFor(() => expect(footerOf(container)).toEqual(["Rack 6"]));
});

// ── Loading and failure (SC32) ──────────────────────────────────────────────

/** Whether a request reads the data centre's racks through their source. */
const racksSource = (request: { dataset: string | undefined }) => request.dataset === "records.schematic_racks";

test("the frame's skeleton covers the first read; later reads keep the canvas and what it draws (SC32)", async () => {
    const held = h.e3.hold(racksSource);
    const { container } = await h.mount(ex.schematicDataCentre);
    await held.holding;
    await settle();
    // The racks are on their way: the skeleton covers the frame, its regions mounted beneath it, hidden and inert.
    const frame = container.querySelector<HTMLElement>("[data-builder-frame]")!;
    expect(container.querySelector("[data-builder-loading]")).not.toBeNull();
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(slot(container, "toolbar").getAttribute("aria-hidden")).toBe("true");
    const canvas = canvasOf(container);
    expect(card(container, "network", "MMR-1")).toBeNull();
    held.release();
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")).not.toBeNull());
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(canvasOf(container)).toBe(canvas);
    // Another session moves A05 down the floor, clear of every other card; its read is held: the frame stays, the canvas and A05 where they were.
    const before = card(container, "racks", "A05")!.style.transform;
    const again = h.e3.hold(racksSource);
    const racks = await h.read(ex.schematicRacks);
    await h.patch(ex.schematicRacks, new Map([...racks, ["A05", { ...racks.get("A05")!, y: some(8.0) }]]));
    await again.holding;
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    expect(container.querySelector("[data-schematic]")!.getAttribute("aria-busy")).toBe("true");
    expect(card(container, "racks", "A05")!.style.transform).toBe(before);
    again.release();
    await settle();
    await waitFor(() => expect(card(container, "racks", "A05")!.style.transform).not.toBe(before));
    expect(canvasOf(container)).toBe(canvas);
});

test("a kind whose read fails is a banner with Retry, the other kinds drawn; Retry reads it again (SC32)", async () => {
    const stop = h.e3.fail(racksSource);
    const { container, getByRole } = await h.mount(ex.schematicDataCentre);
    await settle();
    const banner = await waitFor(() => {
        const found = slot(container, "banners")?.querySelector<HTMLElement>("[data-schematic-banner='racks']");
        if (found === null || found === undefined) throw new Error("no banner for the racks");
        return found;
    });
    expect(within(banner).getByText("Rack rows could not be read")).toBeDefined();
    // The skeleton is gone: every other kind is drawn, and the racks are not.
    expect(container.querySelector("[data-builder-loading]")).toBeNull();
    expect(card(container, "network", "MMR-1")).not.toBeNull();
    expect(card(container, "racks", "A01")).toBeNull();
    stop();
    await act(async () => { fireEvent.click(within(banner).getByRole("button", { name: "Retry" })); });
    await settle();
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    expect(container.querySelector("[data-schematic-banner]")).toBeNull();
    expect(getByRole("radio", { name: "Select" })).toBeDefined();
});

// ── The canvas's colours and styles (SC26, SC31) ────────────────────────────

/** An element's colour roles: the data attributes the recipe's chain reads. */
const tintOf = (el: Element) => ["data-surface", "data-color", "data-tone", "data-status", "data-pattern"]
    .map((name) => `${name}=${el.getAttribute(name) ?? ""}`).join(" ");

test("the canvas's probe resolves its own marks' colours and fonts, and each colour its drawing names, through the recipe (SC26)", async () => {
    const { container } = await dataCentre();
    const probe = container.querySelector("[data-schematic-probe]")!;
    // The canvas's own marks: a role each, and its fonts.
    expect(probe.querySelectorAll("[data-role]")).toHaveLength(16);
    expect([...probe.querySelectorAll("[data-font]")].map((el) => el.getAttribute("data-font"))).toEqual(["label", "eyebrow"]);
    // Each colour once: the items in their ground, naming none; the rooms outlined in their pattern's muted, the cold aisle hatched in the
    // brand's and the hot in warning's. The fibre runs and the feeds name no tone of their own: they draw in the links' look (#1403).
    expect([...probe.querySelectorAll("[data-tint]")].map(tintOf).sort()).toEqual([
        "data-surface=item data-color= data-tone= data-status= data-pattern=",
        "data-surface=zone data-color= data-tone= data-status= data-pattern=brand",
        "data-surface=zone data-color= data-tone= data-status= data-pattern=muted",
        "data-surface=zone data-color= data-tone= data-status= data-pattern=warning",
    ]);
    // The links' look: the shared links part's own elements, at rest and lit, a caption on its knockout, a moved link's line and a drag's.
    const parts = probe.querySelector("[data-schematic-links]")!;
    expect([
        "[data-plan-casing='band']", "[data-plan-link]:not([data-lit]) [data-plan-ribbon-band]", "[data-plan-link][data-lit] [data-plan-ribbon-band]",
        "[data-plan-linkend]", "[data-plan-ribbon-knockout]", "[data-plan-ribbon-caption]", "[data-was] [data-plan-ribbon-band]",
        "[data-plan-link-preview] [data-plan-ribbon-band]",
    ].filter((selector) => parts.querySelector(selector) === null)).toEqual([]);
    // A card whose item names no colour draws no dot.
    expect(card(container, "racks", "A01")!.querySelector("[data-surface]")).toBeNull();
});

test("an item's colour token draws its card's dot and its marks alike; one that names no colour draws no dot (SC26)", async () => {
    const { container } = await h.mount(ex.schematicShapes);
    await waitFor(() => expect(card(container, "units", "CRAH-1")).not.toBeNull());
    const probe = container.querySelector("[data-schematic-probe]")!;
    const probed = new Set([...probe.querySelectorAll("[data-tint]")].map(tintOf));
    const crah = card(container, "units", "CRAH-1")!.querySelector("[data-surface]")!;
    expect(tintOf(crah)).toBe("data-surface=item data-color=status.info data-tone= data-status= data-pattern=");
    expect(probed.has(tintOf(crah))).toBe(true);
    expect(tintOf(card(container, "units", "CT-2")!.querySelector("[data-surface]")!)).toBe("data-surface=item data-color=heat.3 data-tone= data-status= data-pattern=");
    expect(card(container, "units", "PDU-3")!.querySelector("[data-surface]")).toBeNull();
    expect(probed.has("data-surface=item data-color= data-tone= data-status= data-pattern=")).toBe(true);
});

/**
 * What the canvas may set inline: geometry — positions, sizes, the grid's pattern, its position as one property or its
 * two longhands — and the camera's, a layer's and the widest card's custom properties.
 */
const GEOMETRY = new Set([
    "left", "top", "width", "height", "transform", "background-size", "background-position", "background-position-x", "background-position-y",
    "--cam-ppu", "--cam-tx", "--cam-ty", "--schematic-layer-opacity", "--schematic-card-max",
]);

/** The floor's racks, drawn at a card's own width, beside the network frames at their items' widths. */
const unboxed = East.function([], UIComponentType, (_$) => Reactive.Root(East.function([], UIComponentType, ($) => {
    const racks = $.let(Data.bind(ex.schematicFloorRacks));
    const frames = $.let(Data.bind(ex.schematicFrames));
    return Schematic({
        id: "unboxed",
        extent: { width: 28, height: 14 },
        items: {
            racks: Schematic.items(racks, { name: "Rack", icon: "server", x: "x", y: "y", label: "name" }),
            network: Schematic.items(frames, { name: "Network frame", icon: "network-wired", x: "x", y: "y", width: "w", height: "h", label: "name" }),
        },
    });
})));

test("the card layer holds the widest card, which the recipe holds a card to; a card at its item's own width is boxed, held to that (#1393)", async () => {
    const { container } = await h.mount({ fn: unboxed });
    await waitFor(() => expect(card(container, "racks", "A01")).not.toBeNull());
    await waitFor(() => expect(card(container, "network", "MMR-1")).not.toBeNull());
    expect(card(container, "racks", "A01")!.parentElement!.style.getPropertyValue("--schematic-card-max")).toBe("200px");
    expect([card(container, "racks", "A01")!.hasAttribute("data-boxed"), card(container, "network", "MMR-1")!.hasAttribute("data-boxed")]).toEqual([false, true]);
});

test("the canvas, its cards, its minimap and the footer set nothing inline but geometry: the recipe owns every style (SC31)", async () => {
    const { container } = await dataCentre();
    // Zoomed in, cards and the minimap and the scale bar all draw.
    const styled = [...container.querySelectorAll<HTMLElement>("[data-schematic-canvas], [data-schematic-canvas] [style], [data-schematic-footer] [style], [data-schematic-footer][style]")];
    expect(styled.length).toBeGreaterThan(5);
    const outside = styled.flatMap((el) => Array.from({ length: el.style.length }, (_, i) => el.style.item(i)).filter((property) => !GEOMETRY.has(property))
        .map((property) => `${el.getAttribute("data-card-key") ?? el.tagName}: ${property}`));
    expect(outside).toEqual([]);
});
