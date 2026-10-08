/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Drag and drop in a real browser (#608) — the drag layer's pointer path,
 * where jsdom has no layout to measure it. `planRowDrop` is a Plan whose
 * palette is its own library panel (#1259), bounded shorter than its rows, so
 * the Hall 3 presses start below the fold. At the desktop project's width its
 * frame is too narrow to pin the library beside main (#1125: main keeps
 * 480px), so the library rests on its rail and opens over main, as a viewer
 * opens it — and slides off main while a card is carried; wider, it is pinned:
 *
 * - a card dragged from the library and held at the canvas's bottom edge
 *   scrolls it there, and drops on a press — the library opened over main and
 *   pinned beside it;
 * - content scrolled under a still pointer is read again — the row under the
 *   pointer is the one the drag rests over, never the one that scrolled away;
 * - a cell that refuses a card wears Font Awesome's ban, never a text glyph
 *   (#1261);
 * - a card dropped on a bucket row makes a tile no wider than its week's
 *   cell, which draws nothing of its text cut, and its hover says what it
 *   hides (#1266).
 *
 * And its runs move (#825): by the mouse, a run along its press and then its
 * end, each a draft the footer's journal names; by touch, a touch held on a
 * run picks it up after the long press, and a drag moves it — touch input
 * dispatched through Chromium's DevTools protocol, as a touchscreen delivers
 * it. On a phone the library opens from its rail over the narrow layout, which
 * draws no row to drop on, so its cards drag nowhere.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test drag-drop --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { faBan } from "@fortawesome/free-solid-svg-icons";
import { settled } from "./settle";
import { openExample, rowId, rowSel } from "./plan-page";
import { cutText } from "./plan-text";

/** A press of Hall 3's — below the fold — and the first press, above it. */
const P12 = rowSel("gpress", "hall3", "H3-P12");
const P03 = rowSel("press", "p03");
/** Van 1: a bucket row, which takes a delivery card as a tile in the week the pointer names. */
const VAN1 = rowSel("van", "van1");

/** The library panel: the frame's start pane. */
const panelOf = (entry: Locator) => entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='start']");

/** A palette card in the panel, by its name. */
const cardIn = (entry: Locator, name: string) => panelOf(entry).locator("[data-library-item]", { hasText: name });

/** The job card a press row takes. */
const poster = (entry: Locator) => cardIn(entry, "Poster run");

/** The canvas's scroll frame. */
const frameOf = (entry: Locator) => entry.locator('[data-virtual-rows="bounded"]');

/** A locator's box — it must be laid out. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error("not laid out");
    return box;
}

/** A locator's centre, in client px. */
async function centre(locator: Locator): Promise<{ x: number; y: number }> {
    const box = await boxOf(locator);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The band along a scroll container's edge where a resting pointer scrolls it (`dnd/auto-scroll.ts`). */
const EDGE = 48;

/** The frame's region at a point — `main`, or a pane's side — or `null` outside the frame. */
function regionAt(page: Page, at: { x: number; y: number }): Promise<string | null> {
    return page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest("[data-frame-slot]")?.getAttribute("data-frame-slot") ?? null, at);
}

/**
 * planRowDrop at rest, its canvas at its first row and its library open,
 * placed so the page's own scroller stays still: the Plan 70px under the
 * scroller's top, `card` shown in the library's list, and the whole drag — the
 * card, the canvas — clear of the scroller's edge bands. A pointer pressed
 * inside a band would scroll the page, and move the canvas away from the point
 * the drag was aimed at. A library resting on its rail is opened from it.
 */
async function open(page: Page, theme: "light" | "dark" = "light", card = "Poster run"): Promise<Locator> {
    const entry = await openExample(page, "planRowDrop", undefined, theme);
    await entry.locator("[data-plan-frame]").evaluate((frame) => {
        frame.scrollIntoView({ block: "start" });
        let scroller = frame.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        if (scroller !== null) scroller.scrollTop -= 70;
    });
    await settled(page);
    const pane = panelOf(entry);
    if (await pane.getAttribute("data-collapsed") !== null) {
        await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Expand Library" }).click();
    }
    await expect(pane).not.toHaveAttribute("data-collapsed", "");
    await settled(page);
    // The card in view in the library's own list, which scrolls inside the pane.
    await cardIn(entry, card).evaluate((el) => {
        let list = el.parentElement;
        while (list !== null && !(list.scrollHeight > list.clientHeight && /(auto|scroll)/.test(getComputedStyle(list).overflowY))) {
            list = list.parentElement;
        }
        if (list === null || list.closest("[data-frame-slot='start']") === null) return;
        const r = el.getBoundingClientRect();
        const l = list.getBoundingClientRect();
        list.scrollTop += r.top + r.height / 2 - (l.top + l.height / 2);
    });
    await settled(page);
    // The canvas opens at its first row (#944).
    const frame = frameOf(entry);
    await expect.poll(() => frame.evaluate((el) => el.scrollTop)).toBe(0);
    // The layout the drags rely on: the card below the scroller's top band,
    // the canvas above its bottom one.
    const clear = await cardIn(entry, card).evaluate((el, frameSel) => {
        let scroller = el.closest("[data-plan-frame]")!.parentElement;
        while (scroller !== null && !(scroller.scrollHeight > scroller.clientHeight && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        const s = (scroller ?? document.documentElement).getBoundingClientRect();
        const c = el.getBoundingClientRect();
        const f = el.closest("[data-index]")!.querySelector(frameSel)!.getBoundingClientRect();
        return { card: c.top + c.height / 2 - s.top, canvas: s.bottom - f.bottom };
    }, '[data-virtual-rows="bounded"]');
    expect(clear.card).toBeGreaterThan(EDGE);
    expect(clear.canvas).toBeGreaterThan(EDGE);
    return entry;
}

/** Press a card and carry it past the drag threshold — the drag is in flight. */
async function pickUp(page: Page, card: Locator): Promise<void> {
    const at = await centre(card);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 12, at.y + 12, { steps: 3 });
    await expect(card).toHaveAttribute("data-dragging", "");
}

/** The card carried from the library, held at the canvas's bottom edge until a press below the fold is in view, and dropped on it. */
async function dropBelowTheFold(page: Page, entry: Locator, placement: "overlay" | "pinned"): Promise<void> {
    const frame = frameOf(entry);
    const fold = await boxOf(frame);
    const bottom = fold.y + fold.height;
    const target = entry.locator(P12);
    const cell = target.locator("[data-drag-cell]");
    // Below the fold, and the frame not yet scrolled.
    const start = await target.boundingBox();
    expect(start === null || start.y + start.height > bottom).toBe(true);
    expect(await frame.evaluate((el) => el.scrollTop)).toBe(0);

    const from = await centre(poster(entry));
    await pickUp(page, poster(entry));
    // Open over main, the library slides off it while the card is carried, so
    // where the card lay is main; pinned, it stays where it is (#1125).
    await expect.poll(() => regionAt(page, from)).toBe(placement === "overlay" ? "main" : "start");
    // Over the plot column, 8px inside the frame's bottom edge — and held there.
    const plotX = (await centre(entry.locator(`${P03} [data-drag-cell]`))).x;
    await page.mouse.move(plotX, bottom - 8, { steps: 8 });
    // The frame scrolls to its end under the still pointer, and the
    // press comes into view.
    await expect.poll(() => frame.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
    await expect.poll(async () => {
        const box = await cell.boundingBox();
        return box !== null && box.y + box.height <= bottom + 0.5;
    }).toBe(true);

    // Onto it, and let go: the hall the press rides in is drafted with the job in it.
    const on = await centre(cell);
    await page.mouse.move(on.x, on.y, { steps: 4 });
    await expect(cell).toHaveAttribute("data-drop-active", "");
    await page.mouse.up();
    await expect(target).toHaveAttribute("data-draft", "");
    await expect(target.locator('[data-run="drop-job-poster-1"]')).toHaveCount(1);
    await expect(poster(entry)).not.toHaveAttribute("data-dragging", "");
    // The gesture, as the footer's journal heard it.
    await expect(entry.locator("[data-builder-frame] > [data-frame-slot='footer']")).toContainText("LAST GESTURE · drop · Drop job-poster on H3-P12");
    // The drag over, the library is back where it was (#1125).
    await expect.poll(() => regionAt(page, from)).toBe("start");
}

test.describe("Plan drag and drop (#608, #1259)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "the canvas lays out rows at the desktop width");

    for (const { placement, viewport } of [
        { placement: "overlay", viewport: undefined },
        { placement: "pinned", viewport: { width: 1600, height: 900 } },
    ] as const) {
        test(`${placement === "overlay"
            ? "the library opened over main from its rail, which it slides off while the card is carried"
            : "the library pinned beside main, where it stays"}: a card dragged from it and held at the bounded canvas's bottom edge scrolls the canvas to a press below the fold, and drops there`, async ({ page }) => {
            if (viewport !== undefined) await page.setViewportSize(viewport);
            const entry = await open(page);
            await expect(panelOf(entry)).toHaveAttribute("data-pane-mode", placement);
            await dropBelowTheFold(page, entry, placement);
        });
    }

    test("content scrolled under a still pointer is read again — the row under the pointer is where the drag rests", async ({ page }) => {
        const entry = await open(page);
        const frame = frameOf(entry);
        const p03 = entry.locator(`${P03} [data-drag-cell]`);
        await pickUp(page, poster(entry));
        const at = await centre(p03);
        await page.mouse.move(at.x, at.y, { steps: 8 });
        await expect(p03).toHaveAttribute("data-drop-active", "");

        // The wheel scrolls the canvas; the pointer stays.
        await page.mouse.wheel(0, 64);
        await expect.poll(() => frame.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        // Whatever lies under the pointer now is where the drag rests: lit
        // (taken or refused) when it is a destination, nothing lit when not.
        const rest = () => page.evaluate(({ x, y }) => {
            const row = document.elementFromPoint(x, y)?.closest("[data-plan-row]") ?? null;
            const lit = document.querySelector("[data-drop-active], [data-drop-invalid]")?.closest("[data-plan-row]") ?? null;
            const destination = row !== null && row.querySelector("[data-drag-cell]") !== null ? row : null;
            return { under: row?.getAttribute("data-plan-row") ?? null, agrees: lit === destination };
        }, at);
        await expect.poll(async () => {
            const now = await rest();
            return now.under !== rowId("press", "p03") && now.agrees;
        }).toBe(true);
        await page.keyboard.press("Escape");
        await expect(poster(entry)).not.toHaveAttribute("data-dragging", "");
        await page.mouse.up();
    });

    for (const theme of ["light", "dark"] as const) {
        test(`a refused cell wears Font Awesome's solid ban — a 14px mask of its own path in the danger mark, never a text glyph (#1261, ${theme})`, async ({ page }) => {
            const entry = await open(page, theme, "PALLET");
            // PALLET is of a family no row takes: every row refuses it.
            const pallet = cardIn(entry, "PALLET");
            await pickUp(page, pallet);
            const cell = entry.locator(`${P03} [data-drag-cell]`);
            const on = await centre(cell);
            await page.mouse.move(on.x, on.y, { steps: 6 });
            await expect(cell).toHaveAttribute("data-drop-invalid", "");
            const badge = await cell.evaluate((el) => {
                const s = getComputedStyle(el, "::after");
                const probe = document.createElement("div");
                probe.style.color = "var(--chakra-colors-status-neg)";
                document.body.appendChild(probe);
                const neg = getComputedStyle(probe).color;
                probe.remove();
                return { content: s.content, width: s.width, height: s.height, fill: s.backgroundColor, neg, mask: s.maskImage };
            });
            expect({ content: badge.content, width: badge.width, height: badge.height, fill: badge.fill })
                .toEqual({ content: '""', width: "14px", height: "14px", fill: badge.neg });
            // The mask is the icon's own path.
            expect(decodeURIComponent(badge.mask)).toContain(faBan.icon[4] as string);
            await page.keyboard.press("Escape");
            await expect(pallet).not.toHaveAttribute("data-dragging", "");
            await page.mouse.up();
        });
    }

    for (const width of [1280, 1024] as const) {
        for (const theme of ["light", "dark"] as const) {
            test(`planRowDrop at ${width}px (${theme}): a van card dropped on an empty week of Van 1 makes a proposal tile inside its week's cell — its grip whole, its "plan" hidden or cut to a letter and the ellipsis, and said on hover — and no bar, chip, tile or band draws a partial glyph (#1266)`, async ({ page }) => {
                await page.setViewportSize({ width, height: 800 });
                const entry = await open(page, theme, "Van 3");
                const row = entry.locator(VAN1);
                const plot = await boxOf(row.locator("[data-plan-plot]"));
                await pickUp(page, cardIn(entry, "Van 3"));
                // W33, the seventh of the window's twelve weeks, where Van 1 has nothing.
                await page.mouse.move(plot.x + (plot.width * 6.5) / 12, plot.y + plot.height / 2, { steps: 8 });
                await expect(row.locator("[data-drag-cell]")).toHaveAttribute("data-drop-active", "");
                await page.mouse.up();
                const tile = row.locator('[data-event="drop-dlv-van-1"]');
                await expect(tile).toHaveCount(1);
                await expect(entry.locator("[data-builder-frame] > [data-frame-slot='footer']")).toContainText("LAST GESTURE · drop · Drop dlv-van on Van 1");
                // The library back over main, where it was: closed, so nothing covers the tile.
                const pane = panelOf(entry);
                if (await pane.getAttribute("data-pane-mode") === "overlay") {
                    await entry.locator("[data-builder-frame]").first().getByRole("button", { name: "Collapse Library" }).click();
                    await expect(pane).toHaveAttribute("data-collapsed", "");
                }
                await settled(page);
                const drawn = () => tile.evaluate((el) => {
                    const b = el.getBoundingClientRect();
                    const cs = getComputedStyle(el);
                    const c = el.closest("[data-plan-cell]")!.getBoundingClientRect();
                    // On the tile's line, inside its border, where it clips: what has no room there lies below it.
                    const [top, bottom] = [b.top + Number.parseFloat(cs.borderTopWidth), b.bottom - Number.parseFloat(cs.borderBottomWidth)];
                    const on = (part: Element | null) => {
                        if (part === null) return null;
                        const r = part.getBoundingClientRect();
                        return getComputedStyle(part).display !== "none" && r.top < bottom - 0.5 && r.bottom > top + 0.5;
                    };
                    const word = el.querySelector<HTMLElement>(":scope > [data-plan-label]");
                    return {
                        inCell: b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5,
                        grip: on(el.querySelector(":scope > [data-plan-icon]")),
                        // Its word whole on its line — which a week's cell has no room for here.
                        wordWhole: word !== null && on(word) === true && word.scrollWidth <= word.clientWidth,
                    };
                });
                await expect.poll(drawn).toEqual({ inCell: true, grip: true, wordWhole: false });
                await expect.poll(() => entry.evaluate(cutText)).toEqual([]);
                await tile.hover();
                await expect(page.locator('[data-plan-overlay="tooltip"]')).toHaveText("plan");
            });
        }
    }
});

test.describe("Plan moves (#825)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "elements move at the desktop width — the narrow layout takes no moves");

    test("a run dragged along its press moves it two weeks, and its end dragged a week on resizes it — each a draft the footer's journal names", async ({ page }) => {
        const entry = await openExample(page, "planRowDrop");
        const row = entry.locator(P03);
        const plot = row.locator("[data-plan-plot]");
        const run = row.locator('[data-run="j4642"]');
        // The press mid-window, clear of the page's and the canvas's edge bands.
        await row.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await settled(page);
        const week = (await boxOf(plot)).width / 12;
        // J-4642 spans W28–W30 of a twelve-week window: pressed inside its first week, carried two on.
        const bar = await boxOf(run);
        const at = { x: bar.x + week / 2, y: bar.y + bar.height / 2 };
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + 2 * week, at.y, { steps: 10 });
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await page.mouse.up();
        await expect(row).toHaveAttribute("data-draft", "");
        await expect(run).toHaveAttribute("aria-label", /Jul 20, 2026 – Aug 10, 2026/);
        const footer = entry.locator("[data-builder-frame] > [data-frame-slot='footer']");
        await expect(footer).toContainText("LAST GESTURE · move · Move RUN · J-4642");
        // Its end, carried a week on.
        const end = await centre(run.locator("[data-plan-edge='end']"));
        await page.mouse.move(end.x, end.y);
        await page.mouse.down();
        await page.mouse.move(end.x + week, end.y, { steps: 8 });
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await page.mouse.up();
        await expect(run).toHaveAttribute("aria-label", /Jul 20, 2026 – Aug 17, 2026/);
        await expect(footer).toContainText("LAST GESTURE · resize · Resize RUN · J-4642");
    });

    test("a touch held on a run picks it up, and a drag along its press moves it two weeks — Chromium's own touch input", async ({ page }) => {
        const entry = await openExample(page, "planRowDrop");
        const row = entry.locator(P03);
        const plot = row.locator("[data-plan-plot]");
        const run = row.locator('[data-run="j4642"]');
        await row.scrollIntoViewIfNeeded();
        await settled(page);
        await expect(run).toHaveAttribute("data-draggable", "");
        // J-4642 spans W28–W30 of a twelve-week window: pressed inside its first week.
        const bar = await boxOf(run);
        const week = (await boxOf(plot)).width / 12;
        const at = { x: bar.x + week / 2, y: bar.y + bar.height / 2 };
        // Touch input as the browser delivers it — touch events, and the
        // pointer events Chromium derives from them — through the DevTools
        // protocol, since the desktop page has no touchscreen of its own.
        const cdp = await page.context().newCDPSession(page);
        const touch = (type: "touchStart" | "touchMove" | "touchEnd", x?: number) =>
            cdp.send("Input.dispatchTouchEvent", { type, touchPoints: x === undefined ? [] : [{ x, y: at.y }] });
        // When the run is picked up, as the page's clock has it.
        await run.evaluate((el) => {
            const w = window as { pickedUpAt?: number };
            delete w.pickedUpAt;
            new MutationObserver((_records, observer) => {
                if (!el.hasAttribute("data-dragging")) return;
                w.pickedUpAt = performance.now();
                observer.disconnect();
            }).observe(el, { attributes: true, attributeFilter: ["data-dragging"] });
        });
        const pressedAt = await page.evaluate(() => performance.now());
        await touch("touchStart", at.x);
        // Held still, the touch picks the run up once the long press has
        // elapsed — on the sensor's own clock, polled here, never paused for.
        await expect(run).toHaveAttribute("data-dragging", "");
        // Never on contact: a touch picks up only after its 300ms hold (#608),
        // so a drift first scrolls the page. The hold can only make this later.
        const heldFor = await page.evaluate((t0) => (window as { pickedUpAt?: number }).pickedUpAt! - t0, pressedAt);
        expect(heldFor).toBeGreaterThanOrEqual(299);
        for (let i = 1; i <= 8; i++) await touch("touchMove", at.x + (2 * week * i) / 8);
        await expect(plot).toHaveAttribute("data-drop-active", "");
        await touch("touchEnd");
        // A draft, drawn where it was made: two weeks on, marked pending.
        await expect(row).toHaveAttribute("data-draft", "");
        await expect(row.locator('[data-run="j4642"]')).toHaveAttribute("aria-label", /Jul 20, 2026 – Aug 10, 2026/);
        await expect(row.locator('[data-run="j4642"]')).not.toHaveAttribute("data-dragging", "");
    });
});

test.describe("Plan's palette on a phone (#1259)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planRowDrop: the library opens from its rail over the narrow layout, every card inside the pane — and, with no row there to drop on, none drags", async ({ page }) => {
        const entry = await openExample(page, "planRowDrop");
        const frame = entry.locator("[data-builder-frame]").first();
        // The canvas is the narrow layout's: no row takes a card.
        await expect(entry.locator("[data-plan-body][data-plan-narrow]")).toHaveCount(1);
        await frame.getByRole("button", { name: "Expand Library" }).tap();
        await settled(page);
        const pane = panelOf(entry);
        await expect(pane).toHaveAttribute("data-pane-mode", "overlay");
        await expect(pane.locator("[data-library-item]")).toHaveCount(6);
        // Every card inside the pane's box.
        const outside = await pane.evaluate((slot) => {
            const box = (slot.querySelector("[data-orientation][data-side][data-surface]") ?? slot).getBoundingClientRect();
            return [...slot.querySelectorAll("[data-library-item]")].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && (r.left < box.left - 0.5 || r.right > box.right + 0.5);
            }).map((el) => el.getAttribute("data-library-item"));
        });
        expect(outside).toEqual([]);
        await expect(pane.locator("[data-draggable]")).toHaveCount(0);
    });
});
