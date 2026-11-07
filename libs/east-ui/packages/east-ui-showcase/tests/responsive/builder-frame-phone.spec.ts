/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A phone's builder frame (`Mobile Builder Frame Spec.md`, ruled 3 Nov 2026),
 * measured in the page over every builder's phone-sized example — each in a
 * 390px box — and again in a 294px parent, in both themes, a test a builder
 * (each area starts a workspace of its own, #1397):
 *
 * - FR1: the frame stacks — the toolbar, its second row, main the frame's
 *   whole width, the pane strip — and no pane takes width at a side;
 * - FR6: the second row is 56px under the first (the designer's
 *   `WorkOrdersPhone` session bar, less its safe area), padded 0 12 0 16, the
 *   history there and not in the first row: Issues, Undo, Redo, Discard and
 *   Save each 44 × 44 on a 6px radius, centred on the row and taking the
 *   pointer at its centre; one that does not act drawn in `--rule` and
 *   `--ink-5`, never faded;
 * - FR4: the pane strip is 44px on the frame's bottom edge, one equal tab a
 *   pane, each the strip's height, in `--ink-3` until it is open;
 * - FR5 (as the Filters view opens, ruled 3 Nov 2026): a tab opens its pane
 *   as a view over the whole frame, edge to edge; Esc closes it, the focus
 *   back on its tab; one at a time.
 *
 * Every word in it is whole or not there at all (3 Nov 2026) — cut by nothing,
 * over no other word, in its chrome against no control — at 324px too, as wide as a 390px phone gives it
 * in the showcase's card; a set Filters button's fill stands clear of its row;
 * the first row's controls reach its end; a Schematic's scale and minimap
 * stand clear of the footer's band laid over main's foot; and the Plan's now
 * line runs behind the ruler's labels. On a touch screen every field in the
 * page is set at 16px or more — a builder's key search open, its Library's
 * search — so iOS Safari never zooms the page into one (the touch floor).
 *
 * And the Flowchart's lane pager (`narrow.lanes`, ruled 3 Nov 2026): over the
 * depot's editing example, whose cards draw no details, its window shows two
 * lanes, the default, each half of main's width, and ‹ › step it a lane, the
 * readout following. Where the details draw on the cards (R40, D24) — the
 * depot's in full — at 390, 360 and in a 294px parent, the window holds one
 * lane: after each step, and as the window resizes, its card stands whole in
 * the window's middle, as it does at 390 after a Find's pick, and no label
 * stands on a card.
 *
 * Run: `pnpm exec playwright test builder-frame-phone`.
 */

import { expect, type Locator } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { FLOWCHARTS, laneWindowFaults } from "./flowchart-page";
import { settled } from "./settle";

const ROOT = "[data-builder-frame]";

/** Every builder's phone-sized example, by its showcase route. */
const PHONES: readonly (readonly [name: string, route: string])[] = [
    ["Sheet", "e3/sheet/sheet-actions/sheetActionsPhone"],
    ["Plan", "e3/plan/plan-records/planRecordIndexesMobile"],
    ["Roster", "e3/roster/roster/rosterMobile"],
    ["Calendar", "e3/calendar/calendar/calendarMobile"],
    ["Allocation", "e3/allocation/allocation/allocationMobile"],
    ["Schematic", "e3/schematic/schematic-records/schematicRecordIndexesMobile"],
    ["Flowchart", "e3/flowchart/flowchart/flowchartDepotPhone"],
    ["Studio", "e3/studio/studio/studioBuilderMobile"],
    ["Query", "e3/query/query/queryBuilderMobile"],
];

/** What is wrong with a phone's frame, as the page lays it out: each fault, in words. */
function phoneFaults(entry: Locator, name: string): Promise<string[]> {
    return entry.locator(ROOT).first().evaluate((frame, builder) => {
        const faults: string[] = [];
        const round = (n: number) => Math.round(n * 10) / 10;
        if (!frame.hasAttribute("data-phone")) return ["not a phone's frame"];
        // A point is hit only in view: resized, the page may have moved it out.
        frame.scrollIntoView({ block: "center", behavior: "instant" });
        const f = frame.getBoundingClientRect();
        const regions = [...frame.children].map((el) => el.getAttribute("data-frame-slot")).filter((slot) => slot !== null);
        const want = ["toolbar", "sessionRow", "body", "paneStrip"];
        // In this order, each there — the banners, while a session has one, between the rows and the body.
        const at = want.map((slot) => regions.indexOf(slot));
        if (at.some((i, k) => i < 0 || (k > 0 && i < at[k - 1]!))) faults.push(`regions ${regions.join(", ")}`);
        const slot = (name: string) => frame.querySelector<HTMLElement>(`:scope > [data-frame-slot='${name}']`);
        // FR1: main the whole width, no pane at a side.
        const body = slot("body")!;
        const main = body.querySelector<HTMLElement>(":scope > [data-frame-slot='main']")!.getBoundingClientRect();
        if (Math.abs(main.width - f.width) > 0.5) faults.push(`main ${round(main.width)}px of a ${round(f.width)}px frame`);
        if (body.querySelector(":scope > [data-pane-mode]") !== null) faults.push("a pane at a side");
        // FR6: the second row, the history there.
        const second = slot("sessionRow")!;
        const s = second.getBoundingClientRect();
        if (Math.abs(s.height - 56) > 0.5) faults.push(`second row ${round(s.height)}px`);
        const rowStyle = getComputedStyle(second);
        if (rowStyle.paddingLeft !== "16px" || rowStyle.paddingRight !== "12px") faults.push(`second row padded ${rowStyle.padding}`);
        /** A token's colour as the page resolves it. */
        const token = (name: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(--chakra-colors-${name})`;
            frame.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
        };
        if (frame.querySelector("[data-frame-slot='toolbar'] [data-toolbar-item='history']") !== null) faults.push("the history in the first row");
        const history = second.querySelector("[data-slot='history'][data-history-form='phone']");
        if (history === null) faults.push("no history in the second row");
        for (const button of history?.querySelectorAll<HTMLElement>("button") ?? []) {
            const b = button.getBoundingClientRect();
            const name = button.getAttribute("aria-label") ?? "?";
            if (b.width === 0) continue;
            if (Math.abs(b.width - 44) > 0.5 || Math.abs(b.height - 44) > 0.5) faults.push(`${name} ${round(b.width)} × ${round(b.height)}`);
            const look = getComputedStyle(button);
            if (look.borderTopLeftRadius !== "6px") faults.push(`${name} radius ${look.borderTopLeftRadius}`);
            const off = button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true";
            if (off && (look.borderTopColor !== token("border-subtle") || look.color !== token("fg-faint") || look.opacity !== "1")) {
                faults.push(`${name}, off, drawn ${look.borderTopColor} / ${look.color} at ${look.opacity}`);
            }
            if (Math.abs(b.top + b.height / 2 - (s.top + s.height / 2)) > 0.5) faults.push(`${name} off the row's centre`);
            if (b.left < s.left - 0.5 || b.right > s.right + 0.5) faults.push(`${name} past the row`);
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name} does not take the pointer`);
        }
        // FR4: the strip on the bottom edge, its tabs equal.
        const strip = slot("paneStrip");
        if (strip === null) return [...faults, "no pane strip"];
        const p = strip.getBoundingClientRect();
        if (Math.abs(p.height - 44) > 0.5) faults.push(`strip ${round(p.height)}px`);
        if (Math.abs(p.bottom - f.bottom) > 0.5) faults.push("the strip off the frame's bottom edge");
        const tabs = [...strip.querySelectorAll<HTMLElement>("[data-pane-tab]")].map((tab) => tab.getBoundingClientRect());
        if (tabs.some((t) => Math.abs(t.width - tabs[0]!.width) > 1 || Math.abs(t.height - p.height) > 2.5)) faults.push(`tabs ${tabs.map((t) => `${round(t.width)} × ${round(t.height)}`).join(", ")}`);
        for (const tab of strip.querySelectorAll<HTMLElement>("[data-pane-tab][aria-selected='false']")) {
            if (getComputedStyle(tab).color !== token("fg-muted")) faults.push(`${tab.textContent} tab in ${getComputedStyle(tab).color}`);
        }
        // Every word of the frame whole, or not there at all: none cut by what clips it, none over another, none run into a
        // control beside it in the chrome.
        const seen: { words: string; at: DOMRect }[] = [];
        for (const region of ["toolbar", "sessionRow", "body", "paneStrip", "footer"]) {
            const box = slot(region);
            if (box === null) continue;
            const controls = region === "body" ? [] : [...box.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0);
            const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
                const words = node.textContent?.trim() ?? "";
                if (words === "" || words === "·") continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const text = range.getBoundingClientRect();
                const host = node.parentElement!;
                if (text.width === 0 || getComputedStyle(host).visibility === "hidden" || host.closest("svg, [aria-hidden='true']") !== null) continue;
                let hidden = false;
                let cut = false;
                for (let el: HTMLElement | null = host; el !== null && el !== frame; el = el.parentElement) {
                    const style = getComputedStyle(el);
                    // What scrolls shows the rest of it; only what clips cuts it.
                    if ((style.overflowX === "visible" && style.overflowY === "visible") || style.overflowX === "auto" || style.overflowX === "scroll") continue;
                    const clip = el.getBoundingClientRect();
                    if (text.right <= clip.left || text.left >= clip.right || text.bottom <= clip.top || text.top >= clip.bottom) { hidden = true; break; }
                    if (text.left < clip.left - 0.5 || text.right > clip.right + 0.5) cut = true;
                }
                if (hidden || text.bottom > f.bottom || text.top < f.top) continue;
                // Each line of it, where it wraps: the range's box would take in the words beside it.
                if (range.getClientRects().length === 1) for (const other of seen) {
                    if (Math.min(other.at.right, text.right) - Math.max(other.at.left, text.left) > 1 && Math.min(other.at.bottom, text.bottom) - Math.max(other.at.top, text.top) > 2) faults.push(`"${words}" over "${other.words}"`);
                }
                if (range.getClientRects().length === 1) seen.push({ words, at: text });
                if (cut || text.right > f.right + 0.5) faults.push(`${region}: "${words}" cut`);
                for (const control of controls) {
                    if (control.contains(host)) continue;
                    const b = control.getBoundingClientRect();
                    if (Math.min(b.bottom, text.bottom) - Math.max(b.top, text.top) > 2 && Math.max(b.left, text.left) - Math.min(b.right, text.right) < 4) {
                        faults.push(`${region}: "${words}" against ${control.getAttribute("aria-label") ?? control.textContent}`);
                    }
                }
            }
        }
        // What main keeps at its foot, a Schematic's scale and minimap, stands clear of the footer's band laid over main's
        // foot (ruled 7 Nov 2026).
        const footer = slot("footer");
        if (footer !== null && footer.getBoundingClientRect().height < 0.5) {
            const parts = [...footer.children].map((part) => part.getBoundingClientRect()).filter((part) => part.height > 0);
            const band = Math.min(...parts.map((part) => part.top));
            for (const kept of body.querySelectorAll<HTMLElement>("[data-schematic-scale], [data-schematic-minimap]")) {
                const k = kept.getBoundingClientRect();
                if (k.width > 0 && k.bottom > band + 0.5) faults.push(`${kept.hasAttribute("data-schematic-scale") ? "the scale" : "the minimap"} ${round(k.bottom - band)}px under the footer's band`);
            }
        }
        // The count line never goes blank while it has room for its first figures (review of #1481, finding 4): a
        // line short of room drops a noun before its figures, so it says `368 of 630` rather than nothing.
        for (const box of frame.querySelectorAll<HTMLElement>("[data-toolbar-count]")) {
            const first = box.querySelector<HTMLElement>("[data-count-figures], [role=status] > span");
            if (first === null) continue;
            const b = box.getBoundingClientRect(), t = first.getBoundingClientRect();
            if (b.width >= t.width && (t.top >= b.bottom - 0.5 || t.bottom <= b.top + 0.5)) faults.push(`the count line blank in ${round(b.width)}px: "${box.textContent}"`);
        }
        // The first row's controls reach its end, past the count's slack.
        const row = slot("toolbar")?.querySelector("[data-toolbar]");
        const last = row === null || row === undefined ? undefined : [...row.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0).at(-1);
        const clear = row && last !== undefined ? row.getBoundingClientRect().right - last.getBoundingClientRect().right : 4;
        // The query builder's Run stands 12 from the edge (QP1), and Studio's Publish (ST1).
        if (clear > (builder === "Query" || builder === "Studio" ? 12.5 : 8)) faults.push("the first row's controls short of its end");
        if (clear < 3.5) faults.push(`the first row's last control ${round(clear)}px from its end`);
        // A Filters button that is set: a 44px target, its fill clear of the row's edges.
        const set = frame.querySelector<HTMLElement>("[data-rail-phone][data-active]");
        if (set !== null) {
            const b = set.getBoundingClientRect();
            const inset = Number.parseFloat(getComputedStyle(set, "::before").top);
            const top = slot("toolbar")!.getBoundingClientRect();
            if (getComputedStyle(set).boxShadow !== "none") faults.push("set Filters rings its whole target");
            if (b.height < 44 || !(b.top + inset - top.top >= 4) || !(top.bottom - (b.bottom - inset) >= 4)) faults.push(`set Filters, ${round(b.height)}px with its fill ${inset}px in`);
        }
        // The Plan's ruler: each label clear of the rules beside it, the now line behind it.
        const ruler = frame.querySelector("[data-slot='narrowRuler']");
        const now = ruler?.querySelector("[data-ruler-now]");
        for (const label of ruler?.querySelectorAll<HTMLElement>("[data-tick-label]") ?? []) {
            const look = getComputedStyle(label);
            if (look.visibility === "hidden") continue;
            if (Number.parseFloat(look.paddingLeft) < 3) faults.push(`${label.textContent} on its rule`);
            if (now && Number(look.zIndex) <= Number(getComputedStyle(now).zIndex)) faults.push(`the now line over ${label.textContent}`);
            // Its words clear of the paper of any label beside it.
            const words = document.createRange();
            words.selectNodeContents(label);
            const text = words.getBoundingClientRect();
            for (const other of label.closest("[data-time-ruler]")?.querySelectorAll<HTMLElement>("[data-tick-label]") ?? []) {
                if (other === label || getComputedStyle(other).visibility === "hidden") continue;
                const paper = other.getBoundingClientRect();
                if (paper.left < text.right - 0.5 && paper.right > text.left + 0.5) faults.push(`${other.textContent} covers ${label.textContent}`);
            }
        }
        return faults;
    }, name);
}

/** A pane's view as the page lays it out, against the frame. */
function drawerAt(entry: Locator, side: string) {
    return entry.locator(ROOT).first().evaluate((frame, at) => {
        const drawer = frame.querySelector<HTMLElement>(`[data-frame-drawer][data-frame-slot='${at}']`)!;
        const d = drawer.getBoundingClientRect(), f = frame.getBoundingClientRect();
        return {
            open: drawer.hasAttribute("data-open"),
            height: Math.abs(d.top - f.top) <= 0.5 && Math.abs(d.bottom - f.bottom) <= 0.5,
            width: Math.abs(d.left - f.left) <= 0.5 && Math.abs(d.right - f.right) <= 0.5,
        };
    }, side);
}

for (const theme of ["light", "dark"] as const) {
    for (const [name, route] of PHONES) {
        test(`${name}: a phone's frame stacks its regions, the history the second row's 44px buttons, the panes a strip of views over the whole frame — in its 390px box and a 294px parent (${theme})`, async ({ page }) => {
            const faults: Record<string, string[]> = {};
            await test.step(route, async () => {
                await page.setViewportSize({ width: 1440, height: 900 });
                const entry = await visitBuilder(page, route, ROOT, theme);
                const found = await phoneFaults(entry, name);
                if (found.length > 0) faults[`${route} in its box`] = found;
                const frame = entry.locator(ROOT).first();
                const tabs = frame.locator("[data-pane-tab]");
                const keys = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-pane-tab")!));
                for (const key of keys) {
                    // A strip tab per pane, or, a single pane's, one per its own tabs: `start:query`.
                    const side = key.split(":")[0]!;
                    const tab = frame.locator(`[data-pane-tab='${key}']`);
                    await tab.click();
                    await settled(page);
                    expect(await drawerAt(entry, side), `${route}: ${side}'s drawer open`).toEqual({ open: true, height: true, width: true });
                    await expect(tab).toHaveAttribute("aria-selected", "true");
                    // One at a time.
                    expect(await frame.locator("[data-frame-drawer][data-open]").count(), route).toBe(1);
                    // A tooltip the view's first control raised as it took the focus takes the first Esc, as any layer does.
                    for (let i = 0; i < 2 && (await drawerAt(entry, side)).open; i++) {
                        await page.keyboard.press("Escape");
                        await settled(page);
                    }
                    expect((await drawerAt(entry, side)).open, `${route}: Esc closed ${side}'s drawer`).toBe(false);
                    await expect(tab).toBeFocused();
                }
                // The pointer off the tab it last pressed, whose hover draws its ink.
                await page.mouse.move(0, 0);
                // As wide as it is on a 390px phone in the showcase's card, and in a 294px parent.
                await sizeBuilder(page, entry, ROOT, 324);
                const card = await phoneFaults(entry, name);
                if (card.length > 0) faults[`${route} at 324px`] = card;
                await sizeBuilder(page, entry, ROOT, 294);
                const narrow = await phoneFaults(entry, name);
                if (narrow.length > 0) faults[`${route} in a 294px parent`] = narrow;
                await entry.locator(ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.width = ""; });
                await settled(page);
            });
            expect(faults).toEqual({});
        });
    }
}

/** What takes words typed: the fields iOS zooms the page into when one is set under 16px. */
const TYPED = "input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=button], [type=submit], [type=reset], [type=image], [type=hidden]), textarea, select, [contenteditable]:not([contenteditable=false])";

for (const [name, route] of PHONES) {
    test(`${name}: on a touch screen every field in the page — its key search's open, its Library's — is set at 16px or more, so iOS never zooms the page into one @mobile`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, route, ROOT, "light");
        const search = entry.locator(ROOT).first().locator("[data-key-search='icon']").first();
        if (await search.count() > 0) {
            await search.click();
            await settled(page);
        }
        const small = await page.evaluate((typed) => [...document.querySelectorAll<HTMLElement>(typed)]
            .map((field) => ({ field, size: Number.parseFloat(getComputedStyle(field).fontSize) }))
            .filter(({ size }) => size < 16)
            .map(({ field, size }) => `${field.getAttribute("aria-label") ?? field.getAttribute("placeholder") ?? field.tagName} at ${size}px`), TYPED);
        expect(small).toEqual([]);
    });
}

test("Sheet: narrowed, its Filters set, its tabs and its count stay whole beside the button", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, "e3/sheet/sheet-actions/sheetActionsPhone", ROOT, "light");
    const frame = entry.locator(ROOT).first();
    const button = frame.locator("[data-rail-phone]").first();
    await button.click();
    const view = page.locator("[data-slice-filters-view]").first();
    await view.locator("button[data-slice-section]").first().click();
    await view.locator("[data-slice-filters-editor] button").first().click();
    for (let i = 0; i < 2 && await view.isVisible(); i++) {
        await page.keyboard.press("Escape");
        await settled(page);
    }
    await expect(button).toHaveAttribute("data-active", "");
    for (const width of [390, 324, 294]) {
        await sizeBuilder(page, entry, ROOT, width);
        expect(await phoneFaults(entry, "Sheet"), `at ${width}px`).toEqual([]);
    }
});

/** The depot's four records bound editable, its cards drawing no details: a phone's window shows two lanes. */
const EDITING = `${FLOWCHARTS}/flowchartDepotEditing`;

test("Flowchart: a phone shows two lanes across main, and the pager's steps move the window a lane, 44px each, off at each end", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, EDITING, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    const frame = entry.locator(ROOT).first();
    const pager = frame.locator("[data-flowchart-lane-pager]");
    const readout = pager.locator("[data-slot='pagerReadout']");
    const previous = pager.locator("[data-slot='pagerPrevious']");
    const next = pager.locator("[data-slot='pagerNext']");
    await expect(readout).toHaveText("Lanes 1–2 of 5");
    await expect(previous).toHaveAttribute("aria-disabled", "true");
    for (const step of [previous, next]) {
        const box = await step.boundingBox();
        expect([box?.width, box?.height]).toEqual([44, 44]);
    }
    const scroll = frame.locator("[data-flowchart-scroll]");
    const width = await scroll.evaluate((el) => el.clientWidth);
    const lane = Math.floor(width / 2);
    await next.click();
    await expect(readout).toHaveText("Lanes 2–3 of 5");
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(lane);
    // On to the last two lanes, a lane a step, each step waiting for the last to show.
    await next.click();
    await expect(readout).toHaveText("Lanes 3–4 of 5");
    await next.click();
    await expect(readout).toHaveText("Lanes 4–5 of 5");
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(3 * lane);
    // One more goes on to "+ LANE", past the last lane, as a swipe does; its end is the step's.
    await next.click();
    await expect(next).toHaveAttribute("aria-disabled", "true");
    const add = frame.locator("[data-flowchart-addlane]");
    const [addBox, scrollBox] = await Promise.all([add.boundingBox(), scroll.boundingBox()]);
    expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width + 1);
    await expect(readout).toHaveText("Lanes 4–5 of 5");
    await previous.click();
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(3 * lane);
    for (const range of ["3–4", "2–3", "1–2"]) {
        await previous.click();
        await expect(readout).toHaveText(`Lanes ${range} of 5`);
    }
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBe(0);
    await expect(previous).toHaveAttribute("aria-disabled", "true");
});

test("Flowchart: a frame too narrow for the lanes it is told to show shows as many whole lanes as it holds, the readout saying so", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, EDITING, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 220);
    const frame = entry.locator(ROOT).first();
    await expect(frame.locator("[data-flowchart-lane-pager] [data-slot='pagerReadout']")).toHaveText("Lanes 1 of 5");
    const scroll = frame.locator("[data-flowchart-scroll]");
    const [node, box] = await Promise.all([frame.locator("[data-flowchart-node]").first().boundingBox(), scroll.boundingBox()]);
    expect(node!.x + node!.width).toBeLessThanOrEqual(box!.x + box!.width);
});

/** The depot in full: every read the cards show drawn on them, 272 wide, and lines under its labels. */
const DETAILED = `${FLOWCHARTS}/flowchartDepot`;

/** What is wrong with the Flowchart's window, resting on a lane. */
const windowFaults = (entry: Locator, lane: number): Promise<string[]> => laneWindowFaults(entry.locator(ROOT).first(), lane);

for (const width of [390, 360, 294]) {
    test(`Flowchart: where the details draw on the cards, a ${width}px frame's window holds one lane, each step bringing its card whole to the window's middle, no label on a card`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const entry = await visitBuilder(page, DETAILED, ROOT, "light");
        await sizeBuilder(page, entry, ROOT, width);
        const pager = entry.locator(ROOT).first().locator("[data-flowchart-lane-pager]");
        const readout = pager.locator("[data-slot='pagerReadout']");
        await expect(readout).toHaveText("Lanes 1 of 5");
        await expect.poll(() => windowFaults(entry, 0)).toEqual([]);
        for (const lane of [1, 2, 3, 4]) {
            await pager.locator("[data-slot='pagerNext']").click();
            await expect(readout).toHaveText(`Lanes ${lane + 1} of 5`);
            await expect.poll(() => windowFaults(entry, lane)).toEqual([]);
        }
        for (const lane of [3, 2, 1, 0]) {
            await pager.locator("[data-slot='pagerPrevious']").click();
            await expect(readout).toHaveText(`Lanes ${lane + 1} of 5`);
            await expect.poll(() => windowFaults(entry, lane)).toEqual([]);
        }
        await expect(pager.locator("[data-slot='pagerPrevious']")).toHaveAttribute("aria-disabled", "true");
    });
}

test("Flowchart: where the details draw on the cards, a state Find picks opens the window on its lane, its card whole in the middle", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, DETAILED, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    const frame = entry.locator(ROOT).first();
    const readout = frame.locator("[data-flowchart-lane-pager] [data-slot='pagerReadout']");
    await expect(readout).toHaveText("Lanes 1 of 5");
    await frame.locator("[data-toolbar-item='seek'] [data-key-search='icon']").click();
    const search = page.locator("[data-key-search-phone]");
    await search.getByRole("textbox").fill("LDD");
    await search.locator("[data-key-search-row]").filter({ hasText: "LDD" }).click();
    await settled(page);
    // Loaded stands in Dispatch, the last of the depot's five lanes: the window opens on it, its card in the middle.
    await expect(readout).toHaveText("Lanes 5 of 5");
    await expect.poll(() => windowFaults(entry, 4)).toEqual([]);
});

test("Flowchart: where the details draw on the cards, a window resized keeps the lane it rests on, its card in the middle", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const entry = await visitBuilder(page, DETAILED, ROOT, "light");
    await sizeBuilder(page, entry, ROOT, 390);
    const pager = entry.locator(ROOT).first().locator("[data-flowchart-lane-pager]");
    const readout = pager.locator("[data-slot='pagerReadout']");
    await expect(readout).toHaveText("Lanes 1 of 5");
    for (const lane of [2, 3]) {
        await pager.locator("[data-slot='pagerNext']").click();
        await expect(readout).toHaveText(`Lanes ${lane} of 5`);
    }
    await expect.poll(() => windowFaults(entry, 2)).toEqual([]);
    for (const width of [294, 360]) {
        await sizeBuilder(page, entry, ROOT, width);
        await expect(readout).toHaveText("Lanes 3 of 5");
        await expect.poll(() => windowFaults(entry, 2), `at ${width}px`).toEqual([]);
    }
});
