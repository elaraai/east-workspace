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
import { pointAt } from "../../testing/drag-layer.js";
import type { ToolbarItem } from "../../toolbar/index.js";
import { BuilderFrame, type BuilderFrameDock, type BuilderFrameProps } from "./index.js";
import { LoadingLine, type LoadingLineValue } from "./loading-line.js";
import { keptName } from "../../platform/kept.js";

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

/** Press a pane's collapse or expand control, as a pointer does: the focus on it, then its click. */
async function press(name: string): Promise<void> {
    const control = screen.getByRole("button", { name });
    await act(async () => { control.focus(); fireEvent.click(control); });
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

    test("a persisted pane keeps only what the viewer chose: closed for lack of room, it is open on a wide frame after a remount (#1184)", async () => {
        const narrow = mount({ start: library({ persist: "local" }), end: properties({ persist: "local" }) });
        frameAt(700);
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", true], ["overlay", true]]);
        // The frame closed them: nothing is written.
        expect([localStorage.getItem(keptName("frame-test.start.dock.collapsed")), localStorage.getItem(keptName("frame-test.end.dock.collapsed"))]).toEqual([null, null]);
        narrow.unmount();

        mount({ start: library({ persist: "local" }), end: properties({ persist: "local" }) });
        frameAt(1440);
        expect([paneOf("start"), paneOf("end")]).toEqual([["pinned", false], ["pinned", false]]);
        // The viewer's own collapse is kept.
        await press("Collapse Properties");
        expect(localStorage.getItem(keptName("frame-test.end.dock.collapsed"))).toBe("true");
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
        mount({ start: library({ size: "560px" }), end: properties({ size: "540px" }) });
        // A 600px frame: both panes overlay, each on its rail.
        frameAt(600);
        expect([paneOf("start"), paneOf("end")]).toEqual([["overlay", true], ["overlay", true]]);
        // The 540px Properties take the frame less the Library's 44px rail, less the 48px strip.
        await press("Expand Properties");
        expect([paneOf("end"), slot("end").style.width, sheet("end").style.width]).toEqual([["overlay", false], "44px", "508px"]);
        // So do the 560px Library, beside the Properties' rail.
        await press("Expand Library");
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["overlay", false], "44px", "508px"]);
        // On a wider frame the Library has the room: its own width.
        frameAt(700);
        expect([paneOf("start"), sheet("start").style.width]).toEqual([["overlay", false], "560px"]);
        // Pinned, a pane is its own width in the flow.
        frameAt(1800);
        expect([paneOf("start"), slot("start").style.width, sheet("start").style.width]).toEqual([["pinned", false], "560px", ""]);
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

    test("an overlay pane opened from its rail takes the focus — its open tab, or its first control — so Esc, pressed next, closes it and lifts the scrim (#1584)", async () => {
        mount({ start: library(), end: properties({ mode: "overlay", defaultCollapsed: true }) });
        frameAt(700);
        await press("Expand Library");
        expect([paneOf("start"), document.activeElement]).toEqual([["overlay", false], screen.getByRole("tab", { name: "Cards" })]);
        fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        expect([paneOf("start"), scrim(), document.activeElement]).toEqual([["overlay", true], null, screen.getByRole("button", { name: "Expand Library" })]);
        // A pane of one body: its first control.
        await press("Expand Properties");
        expect([paneOf("end"), document.activeElement]).toEqual([["overlay", false], screen.getByRole("button", { name: "Collapse Properties" })]);
    });

    test("an overlay pane closed by its own collapse gives the focus back to its rail, as Esc's close does — floating over a live main or over the scrim (#1584)", async () => {
        mount({ start: library({ mode: "overlay" }), end: properties() });
        frameAt(1200);
        expect(paneOf("start")).toEqual(["overlay", false]);
        await press("Collapse Library");
        expect([paneOf("start"), document.activeElement]).toEqual([["overlay", true], screen.getByRole("button", { name: "Expand Library" })]);
        // An auto pane overlaying for lack of room, its scrim over main.
        frameAt(700);
        await press("Expand Properties");
        await press("Collapse Properties");
        expect([paneOf("end"), scrim(), document.activeElement]).toEqual([["overlay", true], null, screen.getByRole("button", { name: "Expand Properties" })]);
    });

    test("an overlay pane its host opens and closes from code — its control clicked with the focus in main, as a selection in main opens the Inspector — leaves the focus in main (#1584)", async () => {
        mount({ start: library(), end: properties({ mode: "overlay", defaultCollapsed: true }), children: <button type="button">IN MAIN</button> });
        frameAt(1200);
        const inMain = screen.getByRole("button", { name: "IN MAIN" });
        act(() => { inMain.focus(); });
        await act(async () => { screen.getByRole("button", { name: "Expand Properties" }).click(); });
        await told();
        expect([paneOf("end"), document.activeElement]).toEqual([["overlay", false], inMain]);
        await act(async () => { screen.getByRole("button", { name: "Collapse Properties" }).click(); });
        await told();
        expect([paneOf("end"), document.activeElement]).toEqual([["overlay", true], inMain]);
    });

    test("Esc in a layer laid in the open overlay pane that takes Esc itself (`data-escape-layer`) is the layer's; anywhere else in the pane it closes the pane", () => {
        const closed: string[] = [];
        const layer = (
            <div data-escape-layer="">
                <input aria-label="FIND" onKeyDown={(event) => { if (event.key === "Escape") { closed.push("FIND"); event.preventDefault(); event.stopPropagation(); } }} />
            </div>
        );
        mount({ start: library({ mode: "overlay", tabs: [{ key: "cards", label: "Cards", body: <>{layer}<button type="button">CARD</button></> }] }) });
        expect(paneOf("start")).toEqual(["overlay", false]);
        fireEvent.keyDown(screen.getByRole("textbox", { name: "FIND" }), { key: "Escape" });
        expect([paneOf("start"), closed]).toEqual([["overlay", false], ["FIND"]]);
        fireEvent.keyDown(screen.getByRole("button", { name: "CARD" }), { key: "Escape" });
        expect([paneOf("start"), closed]).toEqual([["overlay", true], ["FIND"]]);
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

    test("an overlay pane open at 560px and narrower is a phone's view over the whole builder, needing no scrim — and on a wider frame no scrim at all", () => {
        mount({ start: library({ mode: "overlay" }) });
        frameAt(561);
        expect([paneOf("start"), scrim()]).toEqual([["overlay", false], null]);
        frameAt(560);
        expect([scrim(), drawerOf("start").hasAttribute("data-open")]).toEqual([null, true]);
        frameAt(390);
        expect([scrim(), drawerOf("start").hasAttribute("data-open")]).toEqual([null, true]);
        frameAt(900);
        expect(scrim()).toBeNull();
    });

    test("a tap on the scrim with the focus in the pane puts the focus on its rail", async () => {
        mount({ start: library() });
        frameAt(700);
        await press("Expand Library");
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

describe("BuilderFrame — drawn again by its host (#1398, CL9)", () => {
    test("drawn again — as a builder's frame is at every window landing — it works out none of its recipe's styles again, nor its toolbar's, and the toolbar handed the same items draws and measures nothing again; new items it measures", () => {
        // Each slot recipe's styles worked out from here on, by the recipe's class name: each call of a recipe `sva` made.
        const worked: string[] = [];
        const sva = system.sva.bind(system);
        vi.spyOn(system, "sva").mockImplementation((config) => {
            const styles = sva(config);
            return Object.assign((props?: Parameters<typeof styles>[0]) => {
                worked.push(String(config.className));
                return styles(props);
            }, styles);
        });
        // Each element the toolbar measures.
        const measured: Element[] = [];
        const rectOf = Element.prototype.getBoundingClientRect;
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            if (this.closest("[data-toolbar]") !== null) measured.push(this);
            return rectOf.call(this);
        });
        const items: ToolbarItem[] = [
            { key: "name", forms: [<span>Untitled</span>] },
            { key: "save", side: "end", forms: [<button type="button">Save</button>] },
        ];
        let toolbar = items;
        let draw = (): void => undefined;
        function Host() {
            const [, setDrawn] = useState(0);
            draw = () => setDrawn((n) => n + 1);
            return <BuilderFrame storageKey="frame-test" toolbar={toolbar} start={library()}>{MAIN}</BuilderFrame>;
        }
        render(<ChakraProvider value={system}><Host /></ChakraProvider>);
        expect(slot("toolbar").querySelector("[data-toolbar-item=name]")!.textContent).toBe("Untitled");
        const ofFrame = () => worked.filter((name) => name === "elara-builder-frame" || name === "elara-toolbar");
        worked.length = 0;
        measured.length = 0;
        // Drawn again twice, its items the same.
        act(() => { draw(); });
        act(() => { draw(); });
        expect(ofFrame()).toEqual([]);
        expect(measured).toEqual([]);
        // Items made anew may have moved: the toolbar measures them.
        toolbar = [...items];
        act(() => { draw(); });
        expect(measured.length).toBeGreaterThan(0);
        expect(ofFrame()).toEqual([]);
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
        frameAt(700);
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

// ── A phone's frame (Mobile Builder Frame Spec.md, ruled 3 Nov 2026) ──────────

/** A pane's drawer on a phone. */
const drawerOf = (side: "start" | "end"): HTMLElement => frame().querySelector<HTMLElement>(`[data-frame-drawer][data-frame-slot="${side}"]`)!;
/** Which drawers are open. */
const drawersOpen = () => (["start", "end"] as const).map((side) => drawerOf(side).hasAttribute("data-open"));
/** A pane's tab on the strip. */
const stripTab = (side: "start" | "end"): HTMLElement => frame().querySelector<HTMLElement>(`[data-pane-tab="${side}"]`)!;

/** Items as a builder lists them: a name, the Elara eye and the history, each of the last two drawing a second row's form. */
const phoneItems: ToolbarItem[] = [
    { key: "name", forms: [<span>Untitled</span>] },
    { key: "optimise", side: "end", forms: [<button type="button">EYE</button>], secondRow: <button type="button">EYE ROW</button> },
    { key: "history", side: "end", forms: [<button type="button">SAVE</button>], secondRow: <span>HISTORY ROW</span> },
];

describe("BuilderFrame — a phone's frame (Mobile Builder Frame Spec.md FR1, FR4–FR6)", () => {
    test("at 560px and narrower the frame stacks: the toolbar, its second row, main the whole width, the pane strip — the items that draw a second row leave the first for it, in item order", () => {
        mount({ toolbar: phoneItems, start: library(), end: properties(), footer: <div>STATUS</div> });
        frameAt(1440);
        expect([regions(), across()]).toEqual([["toolbar", "body", "footer"], ["start", "main", "end"]]);
        expect([...slot("toolbar").querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"))).toEqual(["name", "optimise", "history"]);
        frameAt(560);
        expect(frame().hasAttribute("data-phone")).toBe(true);
        // The footer keeps its place: a phone's lays only what speaks over main's foot (its CSS). Each pane is a view over
        // the whole builder, at the frame's root, and the overlay slot over every region.
        expect([regions(), across()]).toEqual([["toolbar", "sessionRow", "sessionBand", "body", "bottomPanel", "paneStrip", "footer", "start", "end", "overlay"], ["main"]]);
        expect([...slot("toolbar").querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"))).toEqual(["name"]);
        expect(slot("sessionRow").textContent).toBe("EYE ROWHISTORY ROW");
        frameAt(561);
        expect([regions(), frame().hasAttribute("data-phone")]).toEqual([["toolbar", "body", "footer"], false]);
    });

    test("the footer's loading line stays the footer's on a phone, in the form its fit gives it, and the second row holds the items' own alone (ruled 7 Nov 2026)", () => {
        const line: LoadingLineValue = { kind: "failed", text: "Couldn't read rows 1–40", short: "Couldn't read", onRetry: () => undefined };
        mount({ toolbar: phoneItems, start: library(), footer: <div><span>LEGEND</span><LoadingLine value={line} shown form="full" /></div> });
        frameAt(1440);
        expect(slot("footer").querySelector("[data-footer-line]")?.getAttribute("data-form")).toBe("full");
        frameAt(390);
        expect([slot("footer").querySelector("[data-footer-line]")?.getAttribute("data-form"), slot("sessionRow").querySelector("[data-footer-line]"), slot("sessionRow").textContent])
            .toEqual(["full", null, "EYE ROWHISTORY ROW"]);
        frameAt(1440);
        expect([slot("footer").querySelector("[data-footer-line]") !== null, regions()]).toEqual([true, ["toolbar", "body", "footer"]]);
    });

    test("a builder with no item of the second row's draws no second row on a phone: a read never adds one over main, its line the footer's", () => {
        const line: LoadingLineValue = { kind: "loading", text: "Loading rows 41–80", short: "Loading…" };
        mount({ footer: <div><LoadingLine value={line} shown form="full" /></div> });
        frameAt(390);
        expect([regions(), slot("footer").querySelector("[data-footer-line]")?.textContent]).toEqual([["body", "bottomPanel", "footer", "overlay"], expect.stringContaining("Loading rows 41–80")]);
    });

    test("a phone's footer that speaks is laid over main's foot, with no height of its own in the flow, so main never resizes for it; one with a pane's view open says over the view only what a gesture there was refused for", () => {
        // jsdom lays nothing out: the recipe says it, and the showcase's phone specs measure it.
        const footer = (system.getSlotRecipe("builderFrame") as { base: { footer: Record<string, Record<string, Record<string, unknown>>> } }).base.footer;
        const speaks = footer["[data-phone] > &"]!["&:has([data-footer-line], [data-footer-live])"]!;
        expect([speaks.height, speaks.justifyContent, speaks.position]).toEqual(["0", "flex-end", "relative"]);
        const overView = footer["[data-phone]:has(> [data-frame-drawer][data-open]) > &"]!["&:has([data-footer-live]:not([data-footer-ambient]))"]!;
        expect([overView.position, overView["& [data-footer-line], & [data-footer-ambient]"]]).toEqual(["absolute", { display: "none" }]);
    });

    test("each described pane is a tab of the strip — its icon, its label and its detail or badge — and opens as a drawer from it; again, it closes, the focus back on the tab", async () => {
        mount({ start: library({ badge: 3 }), end: properties({ detail: "WO-1042", active: true }) });
        frameAt(390);
        expect(slot("paneStrip").getAttribute("role")).toBe("tablist");
        expect([stripTab("start").textContent, stripTab("end").textContent]).toEqual(["Library 3", "Properties WO-1042"]);
        expect([stripTab("start").querySelector("svg[data-icon=book]") !== null, stripTab("end").hasAttribute("data-active")]).toEqual([true, true]);
        // Both closed at first: an auto pane overlaying closes.
        expect([drawersOpen(), stripTab("start").getAttribute("aria-selected"), drawerOf("start").getAttribute("aria-hidden")]).toEqual([[false, false], "false", "true"]);
        await act(async () => { fireEvent.click(stripTab("start")); });
        expect([drawersOpen(), stripTab("start").getAttribute("aria-selected"), drawerOf("start").getAttribute("role"), drawerOf("start").getAttribute("aria-label")])
            .toEqual([[true, false], "true", "region", "Library"]);
        // The focus moves in, onto its open tab; the view covers the builder, no scrim (ruled 3 Nov 2026).
        expect([document.activeElement, scrim()]).toEqual([screen.getByRole("tab", { name: "Cards" }), null]);
        await act(async () => { fireEvent.click(stripTab("start")); });
        expect([drawersOpen(), document.activeElement]).toEqual([[false, false], stripTab("start")]);
    });

    test("one drawer is open at a time; Esc and its collapse each close it, the focus back on its tab", async () => {
        mount({ start: library(), end: properties() });
        frameAt(390);
        await act(async () => { fireEvent.click(stripTab("start")); });
        await act(async () => { fireEvent.click(stripTab("end")); });
        expect(drawersOpen()).toEqual([false, true]);
        await told();
        expect(drawersOpen()).toEqual([false, true]);

        fireEvent.keyDown(document.activeElement!, { key: "Escape" });
        expect([drawersOpen(), document.activeElement]).toEqual([[false, false], stripTab("end")]);

        await act(async () => { fireEvent.click(stripTab("start")); });
        // Its collapse, at its head, points down toward the strip.
        const collapse = screen.getByRole("button", { name: "Collapse Library" });
        expect(collapse.querySelector("svg[data-icon=angles-down]")).not.toBeNull();
        await act(async () => { fireEvent.click(collapse); });
        await told();
        expect([drawersOpen(), document.activeElement]).toEqual([[false, false], stripTab("start")]);
    });

    test("a drawer keeps the pane's open tab across the width, under the same storage key", async () => {
        mount({ start: library() });
        frameAt(1440);
        await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Pages" })); });
        frameAt(390);
        await act(async () => { fireEvent.click(stripTab("start")); });
        expect(openTab("start")).toEqual(["Pages"]);
        expect(drawerOf("start").textContent).toContain("PAGES");
    });

    test("an item takes the second row only from its `secondRowFrom` up: the eye below a 312px frame stays in the first row, folding there (ruled 3 Nov 2026)", () => {
        const items: ToolbarItem[] = [
            phoneItems[0]!,
            { ...phoneItems[1]!, secondRowFrom: 312 },
            phoneItems[2]!,
        ];
        mount({ toolbar: items });
        const firstRow = () => [...slot("toolbar").querySelectorAll("[data-toolbar-item]")].map((el) => el.getAttribute("data-toolbar-item"));
        frameAt(390);
        expect([firstRow(), slot("sessionRow").textContent]).toEqual([["name"], "EYE ROWHISTORY ROW"]);
        frameAt(311);
        expect([firstRow(), slot("sessionRow").textContent]).toEqual([["name", "optimise"], "HISTORY ROW"]);
        frameAt(312);
        expect(firstRow()).toEqual(["name"]);
    });

    test("The rail's button and Search Records, placed by their phone order, stand at the first row's end, the slack before them — unless view tabs take it, or the builder's own items end the row (FR2)", () => {
        const turn: ToolbarItem = { key: "turn", forms: [<button type="button">LR</button>] };
        const rail: ToolbarItem = { key: "rail", forms: [<span>CHIPS</span>], phone: { form: <button type="button">RAIL</button>, order: 1 } };
        const count: ToolbarItem = { key: "count", side: "end", forms: [<span>3 ROWS</span>], phone: { form: <span>3 ROWS</span>, shrink: true } };
        const search: ToolbarItem = { key: "search", forms: [<input aria-label="FIND" />], phone: { form: <button type="button">SEARCH</button>, order: 2 } };
        /** The first row's items, by key, the one the row's slack stands before (`data-toolbar-end`) marked. */
        const firstRow = () => [...slot("toolbar").querySelectorAll("[data-toolbar-item]")]
            .map((el) => `${el.hasAttribute("data-toolbar-end") ? "| " : ""}${el.getAttribute("data-toolbar-item")}`);
        // No rail: Search Records at the row's end, after the builder's own item; on a wider frame, the row as listed.
        mount({ toolbar: [search, turn] });
        frameAt(390);
        expect(firstRow()).toEqual(["turn", "| search"]);
        frameAt(1440);
        expect(firstRow()).toEqual(["search", "turn"]);
        cleanup();
        // The count gives way before the rail's button, which leads the row's end, Search Records after it.
        mount({ toolbar: [turn, rail, count, search] });
        frameAt(390);
        expect(firstRow()).toEqual(["turn", "count", "| rail", "search"]);
        cleanup();
        // View tabs that grow take the slack; an end item of the builder's own keeps the row's end.
        mount({ toolbar: [{ key: "tabs", forms: [<span>TABS</span>], phone: { form: <span>TABS</span>, grow: true } }, turn, search] });
        frameAt(390);
        expect(firstRow()).toEqual(["tabs", "turn", "search"]);
        cleanup();
        mount({ toolbar: [turn, search, { key: "publish", side: "end", forms: [<button type="button">PUBLISH</button>] }] });
        frameAt(390);
        expect(firstRow()).toEqual(["turn", "search", "| publish"]);
    });

    test("a pane that never collapses and an { element } pane stay pinned at their sides on a phone, with no strip tab", () => {
        mount({ start: library({ collapsible: false }), end: { element: <aside>OWN PANE</aside> } });
        frameAt(390);
        expect([across(), slot("paneStrip")]).toEqual([["start", "main", "end"], null]);
    });
});
