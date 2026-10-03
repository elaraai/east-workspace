/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * `BuilderFrame` in the DOM (#1125 F1): its regions, each only when given and
 * main always; a described pane drawn as a `DockPane` — its tabs and its rail,
 * its collapsed state and open tab the host's or its own — and an element
 * pane placed as it is; an overlay pane closed by Esc, the focus back on its
 * rail, and one open at a time, never so wide that less than 48px of main
 * shows beside it; the scrim exactly when the rule says, and a tap on it
 * closing the pane; an overlay pane on a wide frame over a live main; and an
 * open overlay pane stepping aside while a drag is under way.
 *
 * jsdom lays nothing out: the frame's width is laid out here — its root's
 * client rect, and its ResizeObserver told — as the browser would.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChakraProvider } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import { system } from "../../theme/index.js";
import { DragLayerProvider, useDragSourceItem } from "../../dnd/drag-layer";
import { pointAt } from "../../dnd/dnd.test-utils.js";
import { BuilderFrame, type BuilderFrameDock, type BuilderFrameProps } from "./index.js";

// ── jsdom's layout, laid out by the test ────────────────────────────────────

/** Every ResizeObserver the page made: its callback, and what it watches. */
interface Watching {
    readonly callback: ResizeObserverCallback;
    readonly watched: Set<Element>;
    readonly observer: ResizeObserver;
}
const watching: Watching[] = [];

/** A ResizeObserver that tells its callback only when the test says the layout moved. */
class ResizeObserverStub {
    private readonly entry: Watching;
    constructor(callback: ResizeObserverCallback) {
        this.entry = { callback, watched: new Set(), observer: this as unknown as ResizeObserver };
        watching.push(this.entry);
    }
    observe(el: Element) { this.entry.watched.add(el); }
    unobserve(el: Element) { this.entry.watched.delete(el); }
    disconnect() { this.entry.watched.clear(); }
}

/** An element's client rect, `width` px wide. */
function rect(width: number): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, width, height: 600, right: width, bottom: 600, toJSON: () => ({}) } as DOMRect;
}

/** Lay an element out `width` px wide. */
function layOut(el: Element, width: number): void {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue(rect(width));
}

/** Lay the frame out `width` px wide, and tell its observer — as the browser does when the frame's width moves. */
function frameAt(width: number): void {
    const root = frame();
    layOut(root, width);
    act(() => {
        for (const w of watching) if (w.watched.has(root)) w.callback([], w.observer);
    });
}

beforeEach(() => {
    watching.length = 0;
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    localStorage.clear();
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ── The frame, and what it draws ────────────────────────────────────────────

const MAIN = <div data-testid="main">MAIN</div>;

/** A pane with tabs: the Library, 264px wide. */
const library = (more: Partial<BuilderFrameDock> = {}): BuilderFrameDock => ({
    label: "Library",
    icon: "book",
    size: "264px",
    tabs: [
        { key: "cards", label: "Cards", body: <button type="button">CARD</button> },
        { key: "pages", label: "Pages", body: <span>PAGES</span> },
    ],
    ...more,
});

/** A pane with one body: the Properties, 300px wide. */
const properties = (more: Partial<BuilderFrameDock> = {}): BuilderFrameDock => ({
    label: "Properties",
    icon: "sliders",
    size: "300px",
    body: <span>PROPS</span>,
    ...more,
});

/** Mount a frame, with a drag layer on the page. */
function mount(props: Omit<BuilderFrameProps, "storageKey" | "children"> & { children?: ReactNode }) {
    return render(
        <ChakraProvider value={system}>
            <DragLayerProvider>
                <BuilderFrame storageKey="frame-test" {...props}>{props.children ?? MAIN}</BuilderFrame>
            </DragLayerProvider>
        </ChakraProvider>,
    );
}

const frame = (): HTMLElement => document.querySelector<HTMLElement>("[data-builder-frame]")!;
/** A region of the frame, by its slot. */
const slot = (name: string): HTMLElement => frame().querySelector<HTMLElement>(`[data-frame-slot="${name}"]`)!;
/** The frame's regions, top to bottom. */
const regions = () => [...frame().children].map((el) => el.getAttribute("data-frame-slot"));
/** The panes and main, start to end. */
const across = () => [...slot("body").children].map((el) => el.getAttribute("data-frame-slot"));
/** Where a pane sits, and whether it is collapsed. */
const paneOf = (side: "start" | "end") => [slot(side).getAttribute("data-pane-mode"), slot(side).hasAttribute("data-collapsed")];
/** What holds a described pane's DockPane: in its slot, or floating over main. */
const sheet = (side: "start" | "end"): HTMLElement => slot(side).firstElementChild as HTMLElement;
/** The scrim, when it shows. */
const scrim = (): HTMLElement | null => frame().querySelector<HTMLElement>("[data-scrim]");
/** The open tab of a pane. */
const openTab = (side: "start" | "end") =>
    [...slot(side).querySelectorAll("[role=tab]")].filter((tab) => tab.getAttribute("aria-selected") === "true").map((tab) => tab.textContent);

/** Press a pane's collapse or expand control, as a pointer does. */
async function press(name: string): Promise<void> {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name })); });
}

/** Let the microtasks a change is told through land: the pane's to the frame, and the frame's to its host. */
async function told(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 4; i++) await Promise.resolve();
    });
}

// ── F1 ───────────────────────────────────────────────────────────────────────

describe("BuilderFrame — its regions (#1125 F1)", () => {
    test("each region appears only when given, and main always; the frame draws no outer border", () => {
        mount({});
        expect([regions(), across(), slot("main").textContent]).toEqual([["body"], ["main"], "MAIN"]);
        cleanup();

        mount({
            toolbar: [{ key: "name", forms: [<span>Untitled</span>] }],
            banners: <div>CHANGED ELSEWHERE</div>,
            start: library(),
            end: properties(),
            footer: <div>STATUS</div>,
        });
        expect([regions(), across()]).toEqual([["toolbar", "banners", "body", "footer"], ["start", "main", "end"]]);
        expect(slot("toolbar").querySelector("[data-toolbar-item=name]")!.textContent).toBe("Untitled");
        expect([slot("banners").textContent, slot("main").textContent, slot("footer").textContent]).toEqual(["CHANGED ELSEWHERE", "MAIN", "STATUS"]);
        cleanup();

        // A band of nothing is no band.
        mount({ banners: false, footer: null });
        expect(regions()).toEqual(["body"]);

        const recipe = system.getSlotRecipe("builderFrame") as { base: { root: Record<string, unknown> } };
        expect(Object.keys(recipe.base.root).filter((k) => /^border/i.test(k) || /^(outline|boxShadow)$/.test(k))).toEqual([]);
    });

    test("the accessible name is the label's", () => {
        mount({ label: "Page builder" });
        expect(screen.getByRole("group", { name: "Page builder" })).toBe(frame());
    });
});

describe("BuilderFrame — its panes (#1125 F1)", () => {
    test("a described pane is a DockPane: its tab row and collapse control; collapsed, its 44px rail of icon, badge, label and detail, in the brand while active", async () => {
        mount({ start: library({ badge: "47" }), end: properties({ active: true, badge: "8/12", detail: "Revenue trend", defaultCollapsed: true }) });
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Cards", "Pages"]);
        expect(screen.getByRole("button", { name: "Collapse Library" }).getAttribute("aria-expanded")).toBe("true");
        expect([paneOf("start"), slot("start").style.width]).toEqual([["pinned", false], "264px"]);
        // The end pane, collapsed: its rail.
        expect([paneOf("end"), slot("end").style.width]).toEqual([["pinned", true], "44px"]);
        const rail = slot("end").querySelector<HTMLElement>("[data-dock-detail]")!.parentElement!;
        expect([rail.hasAttribute("data-active"), [...rail.children].map((el) => el.textContent)]).toEqual([true, ["", "8/12", "Properties", "Revenue trend"]]);
        expect(rail.querySelector("svg[data-icon=sliders]")).not.toBeNull();

        await press("Collapse Library");
        expect([paneOf("start"), slot("start").style.width, screen.queryAllByRole("tab")]).toEqual([["pinned", true], "44px", []]);
        await press("Expand Library");
        expect([paneOf("start"), slot("start").style.width]).toEqual([["pinned", false], "264px"]);
    });

    test("kept by the pane: its open tab and, when it persists, its collapsed state outlive a remount, under the storage key", async () => {
        const first = mount({ start: library({ persist: "local" }) });
        await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Pages" })); });
        await press("Collapse Library");
        expect(paneOf("start")).toEqual(["pinned", true]);
        first.unmount();

        mount({ start: library({ persist: "local" }) });
        expect(paneOf("start")).toEqual(["pinned", true]);
        await press("Expand Library");
        expect(openTab("start")).toEqual(["Pages"]);
    });

    test("driven by the host: the pane follows its collapsed state and open tab, and tells it each change through a microtask", async () => {
        const heard: Array<boolean | string> = [];
        function Host() {
            const [collapsed, setCollapsed] = useState(false);
            const [tab, setTab] = useState("pages");
            return (
                <BuilderFrame
                    storageKey="frame-test"
                    start={library({
                        collapsed, tab,
                        onCollapsedChange: (next) => { heard.push(next); setCollapsed(next); },
                        onTabChange: (key) => { heard.push(key); setTab(key); },
                    })}
                >
                    <button type="button" onClick={() => setCollapsed(!collapsed)}>HOST TOGGLES</button>
                    <button type="button" onClick={() => setTab("cards")}>HOST OPENS CARDS</button>
                </BuilderFrame>
            );
        }
        render(<ChakraProvider value={system}><Host /></ChakraProvider>);
        expect([paneOf("start"), openTab("start")]).toEqual([["pinned", false], ["Pages"]]);
        // The host drives it.
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "HOST OPENS CARDS" })); });
        await act(async () => { fireEvent.click(screen.getByRole("button", { name: "HOST TOGGLES" })); });
        expect([paneOf("start"), heard]).toEqual([["pinned", true], []]);
        // The pane tells it, after the click.
        fireEvent.click(screen.getByRole("button", { name: "Expand Library" }));
        expect(heard).toEqual([]);
        await told();
        expect([paneOf("start"), heard]).toEqual([["pinned", false], [false]]);
        expect(openTab("start")).toEqual(["Cards"]);
        fireEvent.click(screen.getByRole("tab", { name: "Pages" }));
        await told();
        expect([openTab("start"), heard]).toEqual([["Pages"], [false, "pages"]]);
    });

    test("an { element } pane is placed as it is, pinned at its side", () => {
        mount({ start: { element: <aside data-testid="own">OWN PANE</aside> }, end: properties() });
        const own = slot("start");
        expect([own.children.length, own.firstElementChild!.getAttribute("data-testid"), own.textContent]).toEqual([1, "own", "OWN PANE"]);
        expect([own.getAttribute("data-pane-mode"), own.style.width, own.querySelector("[data-surface]")]).toEqual(["pinned", "", null]);
    });

    test("a pane that never collapses has no collapse control and no rail, and stays pinned however narrow the frame", () => {
        mount({ start: library({ collapsible: false, defaultCollapsed: true }) });
        frameAt(400);
        expect([paneOf("start"), slot("start").style.width]).toEqual([["pinned", false], "264px"]);
        expect(screen.queryByRole("button", { name: /Library$/ })).toBeNull();
        expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Cards", "Pages"]);
    });
});

describe("BuilderFrame — auto, overlay and the scrim (#1125 F1)", () => {
    test("auto: pinned while main keeps 480px beside the panes; an auto pane that starts to overlay closes, and opens again once pinned — unless opened or closed meanwhile", async () => {
        mount({ start: library(), end: properties() });
        frameAt(1440);
        expect([paneOf("start"), paneOf("end")]).toEqual([["pinned", false], ["pinned", false]]);
        // Room for the start pane only.
        frameAt(900);
        expect([paneOf("start"), paneOf("end"), slot("end").style.width]).toEqual([["pinned", false], ["overlay", true], "44px"]);
        frameAt(1440);
        expect(paneOf("end")).toEqual(["pinned", false]);
        // Room for neither, then for both: both close, then both open.
        frameAt(700);
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", true], ["overlay", true]]);
        frameAt(1440);
        expect([paneOf("start"), paneOf("end")]).toEqual([["pinned", false], ["pinned", false]]);
        // Opened as an overlay, then closed: it stays closed once pinned.
        frameAt(900);
        await press("Expand Properties");
        await press("Collapse Properties");
        frameAt(1440);
        expect(paneOf("end")).toEqual(["pinned", true]);
    });

    test("a pane's width that is not a plain px length is measured as the browser lays it out", () => {
        mount({ start: library({ size: "min(480px, 52%)" }) });
        // Beside the sheet, an unseen box at the pane's width; a px width needs none.
        expect(slot("start").children).toHaveLength(2);
        const probe = slot("start").lastElementChild!;
        expect([probe.getAttribute("aria-hidden"), probe.childElementCount]).toEqual(["true", 0]);
        layOut(probe, 480);
        frameAt(1240);
        expect(paneOf("start")).toEqual(["pinned", false]);
        layOut(probe, 416);
        frameAt(800);
        expect(paneOf("start")).toEqual(["overlay", true]);
    });

    test("an overlay pane: its rail stays in the flow; open, it floats over main from its edge, as wide as the pane", async () => {
        mount({ start: library({ mode: "overlay", defaultCollapsed: true }), end: properties({ mode: "overlay", defaultCollapsed: true }) });
        frameAt(1200);
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["overlay", true], "44px", ""]);
        await press("Expand Library");
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["overlay", false], "44px", "264px"]);
        await press("Expand Properties");
        expect([slot("end").style.width, sheet("end").style.width]).toEqual(["44px", "300px"]);
    });

    test("an overlay pane on a narrow frame is never wider than the frame less the other side's rail, less a 48px strip of main; an overlay narrower than that, and a pinned pane, keep their widths", async () => {
        mount({ start: library(), end: properties() });
        // A 324px phone: both panes overlay, each on its rail.
        frameAt(324);
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", true], ["overlay", true]]);
        // The 300px Properties take the frame less the Library's 44px rail, less the 48px strip.
        await press("Expand Properties");
        expect([paneOf("end"), slot("end").style.width, sheet("end").style.width]).toEqual([["overlay", false], "44px", "232px"]);
        // So do the 264px Library, beside the Properties' rail.
        await press("Expand Library");
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["overlay", false], "44px", "232px"]);
        // On a wider phone the Library has the room: its own width.
        frameAt(400);
        expect([paneOf("start"), sheet("start").style.width]).toEqual([["overlay", false], "264px"]);
        // Pinned, a pane is its own width in the flow.
        frameAt(1440);
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["pinned", false], "264px", ""]);
    });

    test("Esc closes the open overlay pane before anything else hears it — from the pane or from main — and returns the focus to its rail", async () => {
        const heard: string[] = [];
        mount({ start: library({ mode: "overlay" }), onKeyDown: (event) => { heard.push(event.key); }, children: <button type="button">IN MAIN</button> });
        expect(paneOf("start")).toEqual(["overlay", false]);
        const card = screen.getByRole("button", { name: "CARD" });
        card.focus();
        fireEvent.keyDown(card, { key: "Escape" });
        expect(paneOf("start")).toEqual(["overlay", true]);
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand Library" }));
        expect(heard).toEqual([]);

        await press("Expand Library");
        fireEvent.keyDown(screen.getByRole("button", { name: "IN MAIN" }), { key: "Escape" });
        expect(paneOf("start")).toEqual(["overlay", true]);
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Expand Library" }));
        // With no overlay pane open, the keys — Esc too — are the host's, from main and from a pane.
        fireEvent.keyDown(screen.getByRole("button", { name: "IN MAIN" }), { key: "Escape" });
        await press("Expand Library");
        await press("Collapse Library");
        fireEvent.keyDown(screen.getByRole("button", { name: "Expand Library" }), { key: "z", ctrlKey: true });
        expect(heard).toEqual(["Escape", "z"]);
    });

    test("one overlay pane is open at a time: opening one closes the other; both open at first, the start pane stays", async () => {
        mount({ start: library({ mode: "overlay" }), end: properties({ mode: "overlay", defaultCollapsed: true }) });
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", false], ["overlay", true]]);
        await press("Expand Properties");
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", true], ["overlay", false]]);
        await press("Expand Library");
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", false], ["overlay", true]]);
        cleanup();

        mount({ start: library({ mode: "overlay" }), end: properties({ mode: "overlay" }) });
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", false], ["overlay", true]]);
    });

    test("the scrim covers main while an auto pane overlays it open; a tap on it closes the pane; no scrim for a pinned pane or a closed one", async () => {
        mount({ start: library({ size: "300px" }) });
        frameAt(1200);
        expect([paneOf("start"), scrim()]).toEqual([["pinned", false], null]);
        frameAt(700);
        expect([paneOf("start"), scrim()]).toEqual([["overlay", true], null]);
        await press("Expand Library");
        expect(scrim()!.parentElement).toBe(slot("main"));
        await act(async () => { fireEvent.click(scrim()!); });
        expect([paneOf("start"), scrim()]).toEqual([["overlay", true], null]);
    });

    test("the scrim covers main while any overlay pane is open at 560px and narrower — and not on a wider frame", () => {
        mount({ start: library({ mode: "overlay" }) });
        frameAt(561);
        expect([paneOf("start"), scrim()]).toEqual([["overlay", false], null]);
        frameAt(560);
        expect(scrim()).not.toBeNull();
        frameAt(390);
        expect(scrim()).not.toBeNull();
        frameAt(900);
        expect(scrim()).toBeNull();
    });

    test("a tap on the scrim with the focus in the pane puts the focus on its rail", async () => {
        mount({ start: library({ mode: "overlay" }) });
        frameAt(390);
        screen.getByRole("button", { name: "CARD" }).focus();
        await act(async () => { fireEvent.click(scrim()!); });
        expect([paneOf("start"), document.activeElement]).toEqual([["overlay", true], screen.getByRole("button", { name: "Expand Library" })]);
    });

    test("an overlay pane on a wide frame floats over a live main: no scrim, a click in main is main's, and the pane stays open", () => {
        let clicks = 0;
        mount({ start: library({ mode: "overlay" }), children: <button type="button" onClick={() => { clicks += 1; }}>IN MAIN</button> });
        frameAt(1200);
        expect([paneOf("start"), sheet("start").style.width, scrim()]).toEqual([["overlay", false], "264px", null]);
        fireEvent.click(screen.getByRole("button", { name: "IN MAIN" }));
        fireEvent.click(screen.getByRole("button", { name: "IN MAIN" }));
        expect([clicks, paneOf("start")]).toEqual([2, ["overlay", false]]);
    });
});

/** A card of a library: a drag source, by the pointer. */
function Card() {
    const drag = useDragSourceItem({ library: "cards", key: "orders", label: "Orders" }, <span>Orders</span>);
    return <div data-testid="card" {...drag}>ORDERS</div>;
}

describe("BuilderFrame — a drag (#1125 F1)", () => {
    test("while a drag is under way an open overlay pane slides off main and its scrim lifts; both come back when it ends", async () => {
        mount({ start: library({ tabs: [{ key: "cards", label: "Cards", body: <Card /> }] }) });
        frameAt(390);
        await press("Expand Library");
        expect([sheet("start").style.transform, scrim() !== null]).toEqual(["", true]);

        // A card picked up in the pane, past the layer's 4px: the drag is under way.
        await act(async () => {
            fireEvent.pointerDown(screen.getByTestId("card"), { clientX: 0, clientY: 0 });
            pointAt(null);
            fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        });
        expect([sheet("start").style.transform, scrim(), paneOf("start")]).toEqual(["translateX(-100%)", null, ["overlay", false]]);

        await act(async () => { fireEvent.pointerUp(document, { clientX: 10, clientY: 10 }); });
        expect([sheet("start").style.transform, scrim() !== null, paneOf("start")]).toEqual(["", true, ["overlay", false]]);
    });

    test("an end pane slides off toward its own edge; a pinned pane never moves", async () => {
        mount({ start: library({ tabs: [{ key: "cards", label: "Cards", body: <Card /> }] }), end: properties({ mode: "overlay" }) });
        frameAt(1440);
        expect([paneOf("start"), paneOf("end")]).toEqual([["pinned", false], ["overlay", false]]);
        await act(async () => {
            fireEvent.pointerDown(screen.getByTestId("card"), { clientX: 0, clientY: 0 });
            pointAt(null);
            fireEvent.pointerMove(document, { clientX: 10, clientY: 10 });
        });
        expect([sheet("start").style.transform, sheet("end").style.transform]).toEqual(["", "translateX(100%)"]);
        await act(async () => { fireEvent.pointerUp(document, { clientX: 10, clientY: 10 }); });
        expect(sheet("end").style.transform).toBe("");
    });
});
