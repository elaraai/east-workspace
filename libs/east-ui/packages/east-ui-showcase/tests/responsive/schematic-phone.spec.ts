/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Schematic on a phone (#1394, `Schematic Builder Spec.md` §6.1, §9, D15,
 * SC24, SC25), on the data centre floor in a real browser. At 390px and 360px,
 * and in a 294px parent, in both themes: the toolbar's one row holds the rail's
 * icon, the View and the history; below 480px of main nothing registers to
 * drag — no library card drags and the canvas is no drop cell — and the View's
 * tools hold no Move or Connect; a rack tapped, the inspector opened from its
 * rail shows its Position, its Connect to… and its Delete, each a 44px tap
 * target by its box or its halo and inside the pane, Connect to…'s list opening
 * inside the window; nothing scrolls the page sideways. One finger pans the
 * canvas and two pinch it about their midpoint. The inspector's actions go
 * through Save and a remount: a run Connect to… records and a Backlog card's
 * Place, each read back from e3. In a wide window a box narrowed to 294px is
 * narrow too, and widened again keeps the selection and the drafts.
 *
 * Every wait is a poll on the page's state, never a fixed pause; nothing reads
 * a screenshot.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-phone`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { leaveBuilder } from "./builder-page";
import { DATA_CENTRE, centred, discard, libraryCard, openSchematic, openTab, pane, printedRef, save, screenPoint, sizeTo, type Point } from "./schematic-page";
import { settled } from "./settle";

/** What nothing on a narrow main may carry: a drag source or a drop target. */
const DRAG = "[data-draggable], [data-drag-cell]";

/** The page scrolls sideways by this much: nothing may. */
const pageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The inspector's pane. */
const inspector = (root: Locator): Locator => root.locator("[data-frame-slot='end']");

/** Opens a pane from its rail where it is collapsed, by its name — `Library`, `Inspector` — with a tap. */
async function expand(page: Page, slot: Locator, name: string): Promise<void> {
    if (await slot.getAttribute("data-collapsed") !== null) {
        await slot.getByRole("button", { name: `Expand ${name}` }).tap();
        await expect(slot).not.toHaveAttribute("data-collapsed", "");
    }
    await settled(page);
}

/** Collapses a pane to its rail where it is open, by its name, with a tap. */
async function collapse(page: Page, slot: Locator, name: string): Promise<void> {
    if (await slot.getAttribute("data-collapsed") === null) {
        await slot.getByRole("button", { name: `Collapse ${name}` }).tap();
        await expect(slot).toHaveAttribute("data-collapsed", "");
    }
    await settled(page);
}

/** The inspector's open tab: the pane's body, floating over main on a phone, its rail in the flow. */
const inspectorBody = (root: Locator): Locator => inspector(root).locator("[role='tabpanel']:not([hidden])");

/** What Details shows, in the inspector's open tab. */
const details = (root: Locator): Locator => inspectorBody(root).locator("[data-schematic-inspector]");

/** The runs an item Details shows is joined to. */
const runs = (root: Locator): Locator => details(root).locator("[data-inspector-join^='(kind=\"fibre\"']");

/**
 * What is wrong with a control as a tap target under a touch pointer, and any part of it past the pane's body: a button
 * a tap 21px above or below whose middle misses it — 44px tall by its box, or by its halo — or an input whose field is
 * under 44px tall, or a tap 20px above or below whose middle misses the input that fills it, its 1px border either side.
 */
async function targetFaults(control: Locator, root: Locator, what: string, input = false): Promise<string[]> {
    await control.scrollIntoViewIfNeeded();
    const body = await inspectorBody(root).boundingBox();
    if (body === null) return [`${what}: the pane is not laid out`];
    return control.evaluate((el, [name, b, isInput]) => {
        const t = el.getBoundingClientRect();
        const bad: string[] = [];
        const field = isInput ? (el.closest("[data-field-line] > *") ?? el).getBoundingClientRect() : t;
        if (isInput && field.height < 43.5) bad.push(`${name}: its field is ${field.height.toFixed(1)}px tall`);
        for (const dy of isInput ? [-20, 20] : [-21, 21]) {
            const hit = document.elementFromPoint(t.left + t.width / 2, field.top + field.height / 2 + dy);
            if (hit === null || !el.contains(hit)) bad.push(`${name}: a tap ${dy < 0 ? "above" : "below"} its middle lands on ${hit === null ? "nothing" : hit.tagName.toLowerCase()}`);
        }
        if (t.left < b.x - 0.5 || t.right > b.x + b.width + 0.5) bad.push(`${name}: ${t.left.toFixed(1)}–${t.right.toFixed(1)}, past the pane's ${b.x.toFixed(1)}–${(b.x + b.width).toFixed(1)}`);
        return bad;
    }, [what, body, input] as const);
}

/** Taps a world point of the drawing, as a finger does. */
async function tapAt(page: Page, root: Locator, x: number, y: number): Promise<void> {
    const at = await screenPoint(root, x, y);
    await page.touchscreen.tap(at.x, at.y);
    await settled(page);
}

/** Picks a choice of a Chooser in Details by its words, with taps; its list, the window's to keep inside. */
async function choose(page: Page, trigger: Locator, option: string): Promise<Locator> {
    await trigger.tap();
    const list = page.locator(`[id=${JSON.stringify(await trigger.getAttribute("aria-controls"))}]`);
    const choice = list.getByRole("option", { name: option });
    await expect(choice).toBeVisible();
    return choice;
}

/** The canvas's camera, as its card layer carries it: px a world unit, and where the world's origin stands on the page. */
function cameraOf(root: Locator): Promise<{ ppu: number; x: number; y: number }> {
    return root.evaluate((el) => {
        const layer = el.querySelector<HTMLElement>("[data-schematic-cards]")!;
        const box = layer.getBoundingClientRect();
        return {
            ppu: Number(layer.style.getPropertyValue("--cam-ppu")),
            x: box.left + parseFloat(layer.style.getPropertyValue("--cam-tx")),
            y: box.top + parseFloat(layer.style.getPropertyValue("--cam-ty")),
        };
    });
}

/** Touches the screen with fingers that move together, a frame a step: each finger's path, from its first point to its last. */
async function touch(page: Page, paths: readonly (readonly [Point, Point])[]): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    const at = (t: number) => paths.map(([from, to], id) => ({ id, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(i / 8) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await settled(page);
}

/** The data centre unmounted and mounted again, as a viewer leaving it and coming back does: what it shows read back from e3. */
async function remount(page: Page): Promise<Locator> {
    await leaveBuilder(page);
    await page.evaluate((hash) => { location.hash = `#${hash}`; }, DATA_CENTRE);
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${DATA_CENTRE}"]`) });
    await entry.scrollIntoViewIfNeeded();
    const root = entry.locator("[data-schematic]").first();
    await expect(root.locator("[data-builder-frame]")).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
    await expect(root.locator("[data-schematic-canvas] > canvas")).toBeVisible();
    await settled(page);
    return root;
}

/**
 * At one width: the phone's row — the rail's icon, the View and the history; narrow, nothing registered to drag with
 * the library open, the View's tools Select, Zoom box and Marquee alone; a rack tapped, Details over it with its
 * Position, its Connect to… and its Delete, each a tap target in the pane, Connect to…'s list inside the window; nothing
 * past the page's edge.
 */
async function phoneAt(page: Page, root: Locator, at: string, rack: { readonly x: number; readonly key: string }): Promise<void> {
    await centred(page, root);
    await expect(root, at).toHaveAttribute("data-schematic-layout", "narrow");
    // The row: the rail's icon, the View and the history, no tool or zoom of its own.
    await expect(root.locator("[data-toolbar-item='record-slices'] [data-rail-rung='icon']"), at).toBeVisible();
    await expect(root.locator("[data-toolbar-item='seek'] [data-key-search='icon']"), at).toHaveAttribute("aria-label", "View");
    await expect(root.locator("[data-toolbar-item='history']"), at).toBeVisible();
    await expect(root.locator("[data-frame-slot='toolbar'] [data-schematic-tools], [data-frame-slot='toolbar'] [data-schematic-zoom]"), at).toHaveCount(0);
    // Nothing to drag, the library open.
    await expand(page, pane(root), "Library");
    await expect(root.locator(DRAG), at).toHaveCount(0);
    await collapse(page, pane(root), "Library");
    // The View's tools: no Move or Connect, the inspector's here.
    const view = root.locator("[data-toolbar-item='seek'] [data-key-search='icon']");
    await view.tap();
    const tools = page.locator("[data-schematic-view] [data-schematic-seg='tools'] [role='radio']");
    await expect(tools.first(), at).toBeVisible();
    expect(await tools.evaluateAll((radios) => radios.map((radio) => radio.getAttribute("aria-label"))), at).toEqual(["Select", "Zoom box", "Marquee"]);
    await page.keyboard.press("Escape");
    await expect(view).toHaveAttribute("data-state", "closed");
    // A rack tapped, and the inspector opened: its Position, its Connect to… and its Delete, tap targets inside the pane.
    await tapAt(page, root, rack.x, 2.9);
    await expand(page, inspector(root), "Inspector");
    await expect(details(root), at).toHaveAttribute("data-schematic-inspector", "item");
    await expect(details(root).locator("[data-inspector-title]"), at).toHaveText(rack.key);
    const position = details(root).locator("[data-inspector-fields='position']");
    const to = details(root).locator("[data-inspector-fields='connect'] [data-field='to'] [data-scope='select'][data-part='trigger']");
    const faults = [
        ...await targetFaults(position.locator("[data-field='x'] input"), root, "x", true),
        ...await targetFaults(position.locator("[data-field='y'] input"), root, "y", true),
        ...await targetFaults(to, root, "Connect to"),
        ...await targetFaults(details(root).locator("[data-inspector-action='delete']"), root, "Delete"),
    ];
    expect(faults, at).toEqual([]);
    // Connect to…'s list inside the window, let go with nothing chosen.
    const choice = await choose(page, to, "MMR-1 · Network frame");
    expect(await choice.evaluate((el) => { const b = el.closest("[role='listbox']")!.getBoundingClientRect(); return b.left >= -0.5 && b.right <= window.innerWidth + 0.5; }),
        `${at}: the list inside the window`).toBe(true);
    await page.keyboard.press("Escape");
    await collapse(page, inspector(root), "Inspector");
    expect(await pageOverflow(page), `${at}: the page`).toBeLessThanOrEqual(0);
}

test.describe("The Schematic on a phone (#1394)", () => {
    test.skip(({ isMobile }) => !isMobile, "a touch pointer: the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`at 390px and 360px, and in a 294px parent: the row holds the rail's icon, the View and the history; nothing registers to drag; the View's tools hold no Move or Connect; and Details' Position, Connect to… and Delete are tap targets inside the pane, Connect to…'s list inside the window (SC24, SC25, D15, ${theme})`, async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 844 });
            const root = await openSchematic(page, DATA_CENTRE, theme);
            await phoneAt(page, root, "at 390px", { x: 6.0, key: "A02" });
            await page.setViewportSize({ width: 360, height: 740 });
            await settled(page);
            await phoneAt(page, root, "at 360px", { x: 9.6, key: "A03" });
            await sizeTo(page, root, 294);
            await phoneAt(page, root, "in a 294px parent", { x: 13.2, key: "A04" });
        });
    }

    test("one finger pans the canvas and two pinch it about their midpoint, the point of the drawing under it standing still (D15)", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        const root = await openSchematic(page, DATA_CENTRE);
        await centred(page, root);
        // The hot aisle's floor, clear of every item: a drag there pans.
        const from = await screenPoint(root, 10.0, 13.3);
        const before = await cameraOf(root);
        await touch(page, [[from, { x: from.x + 60, y: from.y - 20 }]]);
        const panned = await cameraOf(root);
        expect([Math.round(panned.x - before.x), Math.round(panned.y - before.y), panned.ppu]).toEqual([60, -20, before.ppu]);
        // Two fingers 40px either side of a point, drawn apart to 80px: the zoom doubles about the point between them.
        const mid = await screenPoint(root, 14.0, 7.0);
        const world = (camera: { ppu: number; x: number; y: number }) => ({ x: (mid.x - camera.x) / camera.ppu, y: (mid.y - camera.y) / camera.ppu });
        const under = world(panned);
        await touch(page, [
            [{ x: mid.x - 40, y: mid.y }, { x: mid.x - 80, y: mid.y }],
            [{ x: mid.x + 40, y: mid.y }, { x: mid.x + 80, y: mid.y }],
        ]);
        const pinched = await cameraOf(root);
        expect(pinched.ppu / panned.ppu).toBeCloseTo(2, 2);
        // Each finger's move lands a moment apart, the midpoint between them shifting half a step meanwhile: the point
        // stands within 2px — a zoom about the canvas's middle would carry it the pan's 63px.
        const still = world(pinched);
        expect(Math.abs(still.x - under.x) * pinched.ppu, "the point under the midpoint, in px").toBeLessThan(2);
        expect(Math.abs(still.y - under.y) * pinched.ppu, "the point under the midpoint, in px").toBeLessThan(2);
        expect(await discard(root).isDisabled()).toBe(true);
    });

    test("the inspector's actions through Save and a remount: a run from A05 to MMR-1 by Connect to…, and A06 placed from the Backlog by its Place, at the canvas's centre — each read back from e3 (SC25, SC13)", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        let root = await openSchematic(page, DATA_CENTRE);
        await centred(page, root);
        // A05, which no run joins: Connect to… MMR-1 records one.
        await tapAt(page, root, 16.8, 2.9);
        await expand(page, inspector(root), "Inspector");
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A05");
        await expect(runs(root)).toHaveCount(0);
        await (await choose(page, details(root).locator("[data-inspector-fields='connect'] [data-field='to'] [data-scope='select'][data-part='trigger']"), "MMR-1 · Network frame")).tap();
        await expect(runs(root)).toHaveCount(1);
        await expect(discard(root)).toBeEnabled();
        await collapse(page, inspector(root), "Inspector");
        // A06, from the Backlog: tapped, Details shows it with no position; its Place puts it at the canvas's centre, selected.
        await expand(page, pane(root), "Library");
        await openTab(page, root, "Backlog");
        const a06 = libraryCard(root, printedRef("racks", "A06"));
        await expect(a06).not.toHaveAttribute("data-draggable", "");
        await a06.tap();
        await expand(page, inspector(root), "Inspector");
        await expect(details(root)).toHaveAttribute("data-schematic-inspector", "unplaced");
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A06");
        await expect(details(root).locator("[data-inspector-when]")).toHaveText("Not placed");
        const place = details(root).locator("[data-inspector-action='place']");
        expect(await targetFaults(place, root, "Place")).toEqual([]);
        await place.tap();
        await expect(details(root)).toHaveAttribute("data-schematic-inspector", "item");
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A06");
        await expect(details(root).locator("[data-inspector-fields='row'] [data-field='owner'] input")).toBeEditable();
        await collapse(page, inspector(root), "Inspector");
        // Save writes both; the floor mounted again reads them back: the run joins A05, and A06 stands at the floor's middle.
        await save(root).tap();
        await expect(discard(root)).toBeDisabled();
        root = await remount(page);
        await centred(page, root);
        await expect(root).toHaveAttribute("data-schematic-layout", "narrow");
        await tapAt(page, root, 16.8, 2.9);
        await expand(page, inspector(root), "Inspector");
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A05");
        await expect(runs(root)).toHaveCount(1);
        await collapse(page, inspector(root), "Inspector");
        await tapAt(page, root, 14.0, 7.0);
        await expand(page, inspector(root), "Inspector");
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A06");
        await expect(details(root).locator("[data-inspector-when]")).toHaveText(/14\.00, 7\.00 m$/u);
        await collapse(page, inspector(root), "Inspector");
        await expand(page, pane(root), "Library");
        await expect(pane(root).getByRole("tab", { name: /^Backlog/ })).toHaveText("Backlog 1");
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
});

test.describe("The Schematic narrowed in a wide window (#1394)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "a box narrowed inside a wide window: the desktop project");

    test("a box narrowed to 294px is narrow — nothing to drag — and widened again is wide, its cards dragging again, A03 still selected and its draft waiting on Save (SC25)", async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1000 });
        const root = await openSchematic(page, DATA_CENTRE);
        await sizeTo(page, root, 1440);
        await centred(page, root);
        await expect(root).toHaveAttribute("data-schematic-layout", "wide");
        await expect(root.locator(DRAG)).not.toHaveCount(0);
        const radios = root.locator("[data-frame-slot='toolbar'] [data-schematic-seg='tools'] [role='radio']");
        expect(await radios.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent))).toEqual(["Select", "Zoom box", "Marquee", "Connect", "Move"]);
        // A03, clicked where it stands — beside both panes its rack draws as its pin: its owner retyped in Details, one
        // change waiting on Save.
        const end = inspector(root);
        if (await end.getAttribute("data-collapsed") !== null) await end.getByRole("button", { name: "Expand Inspector" }).click();
        const a03 = await screenPoint(root, 9.6, 2.9);
        await page.mouse.click(a03.x, a03.y);
        await settled(page);
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A03");
        const owner = details(root).locator("[data-inspector-fields='row'] [data-field='owner'] input");
        await owner.fill("Harbour Labs");
        await owner.press("Enter");
        await expect(discard(root)).toBeEnabled();
        const standing = async () => [await details(root).locator("[data-inspector-title]").textContent(), await details(root).locator("[data-inspector-marks] > [data-state]").textContent()];
        expect(await standing()).toEqual(["A03", "Pending"]);
        // Narrowed: nothing to drag; Details, opened over main, on A03 still, pending.
        await sizeTo(page, root, 294);
        await expect(root).toHaveAttribute("data-schematic-layout", "narrow");
        await expect(root.locator(DRAG)).toHaveCount(0);
        if (await end.getAttribute("data-collapsed") !== null) await end.getByRole("button", { name: "Expand Inspector" }).click();
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A03");
        expect(await standing()).toEqual(["A03", "Pending"]);
        await expect(discard(root)).toBeEnabled();
        // Widened again: wide, the cards dragging and the canvas the drops' cell again, A03 selected, its draft waiting.
        await sizeTo(page, root, 1440);
        await expect(root).toHaveAttribute("data-schematic-layout", "wide");
        await expect(root.locator(DRAG)).not.toHaveCount(0);
        if (await end.getAttribute("data-collapsed") !== null) await end.getByRole("button", { name: "Expand Inspector" }).click();
        await expect(details(root).locator("[data-inspector-title]")).toHaveText("A03");
        expect(await standing()).toEqual(["A03", "Pending"]);
        await expect(discard(root)).toBeEnabled();
    });
});
