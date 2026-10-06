/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * `<Plan>`'s frame, measured in a real browser (#1193, `Plan Builder Spec.md`
 * §7, PB19–PB21): every Plan is its `BuilderFrame` — one toolbar row, main
 * holding the canvas, the footer — drawing no border of its own and no pane it
 * is not given: the library its `library` lists (#1195). Its toolbar is one
 * 44px row at every width from 1440px to 360px and on a phone: the rail folds
 * first, then the Plan's own steps, the review's buttons into their menu and
 * the key search into its icon, the history item last. A declared height is
 * the whole Plan's, and a host that gives the frame a height bounds the
 * canvas, which then scrolls its own rows inside main. On a phone the library
 * opens from its rail over main, and its Series tab's search is a 44px field.
 * Read at the desktop and phone widths, in both themes.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-frame`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { PLAN_EXAMPLES, openExample } from "./plan-page";
import { settled } from "./settle";

/** The event kinds' examples file (#1191). */
const EVENTS = "e3/plan/plan-events";

/** Plans of every source and chrome, each by its examples file and the panes
 *  it is given: a slice and a review; a review and editing over a keyed paged
 *  source; event kinds, with and without a library; the narrow layout's box. */
const FRAMED: ReadonlyArray<{ name: string; file: string; panes?: readonly string[] }> = [
    { name: "planTargetState", file: PLAN_EXAMPLES },
    { name: "planReview", file: PLAN_EXAMPLES },
    { name: "planEditing", file: PLAN_EXAMPLES },
    { name: "planEvents", file: EVENTS },
    { name: "planPrintWorks", file: EVENTS, panes: ["start"] },
    { name: "planLibrary", file: EVENTS, panes: ["start"] },
    { name: "planNarrow", file: PLAN_EXAMPLES },
];

/** The rail's clusters: every step of theirs folds before any of the Plan's own. */
const RAIL = ["cluster", "range"];

/** The canvas's own scroller in main: the rows' bounded viewport, or the narrow layout's list. */
const SCROLLER = "[data-frame-slot='main'] [data-virtual-rows='bounded'], [data-frame-slot='main'] [data-slot='narrowList']";

/** What the eye checks of one Plan's frame, read in the page, given the panes it is given — each a line saying what is wrong. */
async function frameFaults(entry: Locator, panes: readonly string[] = []): Promise<{ bad: string[]; toolbar: boolean }> {
    return entry.evaluate((root, given) => {
        const bad: string[] = [];
        const wrapper = root.querySelector("[data-plan-frame]");
        const frame = wrapper?.querySelector(":scope > [data-builder-frame]") ?? null;
        if (wrapper === null || frame === null) return { bad: ["no Plan frame"], toolbar: false };
        const borderless = (el: Element, what: string) => {
            const s = getComputedStyle(el);
            for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
                const w = Number.parseFloat(s[`border${side}Width`]);
                if (w > 0 && s[`border${side}Style`] !== "none") bad.push(`${what}: a ${w}px ${side.toLowerCase()} border`);
            }
        };
        // PB19: the Plan draws no border of its own — not its box, its frame, main or the canvas.
        borderless(wrapper, "the Plan's box");
        borderless(frame, "the frame");
        const main = frame.querySelector(":scope > [data-frame-slot='body'] > [data-frame-slot='main']");
        if (main === null) bad.push("no main");
        else {
            borderless(main, "main");
            const body = main.querySelector(":scope > [data-plan-body]");
            if (body === null) bad.push("main holds no canvas");
            else borderless(body, "the canvas");
        }
        // The panes it is given — the library (#1195) — and no other (#1197 adds the inspector).
        for (const side of ["start", "end"]) {
            const drawn = frame.querySelector(`:scope > [data-frame-slot='body'] > [data-frame-slot='${side}']`) !== null;
            if (drawn && !given.includes(side)) bad.push(`a ${side} pane it was not given`);
            if (!drawn && given.includes(side)) bad.push(`no ${side} pane, though it was given one`);
        }
        // PB20/PB21: one toolbar row — its band 44px, every item inside it, none past the row's edge.
        const band = frame.querySelector(":scope > [data-frame-slot='toolbar']");
        if (band !== null) {
            const b = band.getBoundingClientRect();
            if (Math.abs(b.height - 44) > 0.5) bad.push(`the toolbar band is ${b.height}px, want 44px`);
            const row = band.querySelector("[data-toolbar]")!.getBoundingClientRect();
            for (const item of band.querySelectorAll("[data-toolbar-item]")) {
                const r = item.getBoundingClientRect();
                if (r.width === 0) continue;
                const key = item.getAttribute("data-toolbar-item");
                if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) bad.push(`toolbar item ${key}: ${r.top.toFixed(1)}–${r.bottom.toFixed(1)} outside the band ${b.top.toFixed(1)}–${b.bottom.toFixed(1)}`);
                if (r.left < row.left - 0.5 || r.right > row.right + 0.5) bad.push(`toolbar item ${key}: ${r.left.toFixed(1)}–${r.right.toFixed(1)} past the row's ${row.left.toFixed(1)}–${row.right.toFixed(1)}`);
            }
        }
        // The canvas draws no toolbar of its own, no review foot, no chip row.
        if (main !== null && main.querySelector("[data-toolbar], [data-slot='reviewFoot'], [data-slot='narrowChips']") !== null) {
            bad.push("main holds a toolbar of its own");
        }
        // The history item, where there is one, folds last.
        const ladder = (band?.querySelector("[data-toolbar]")?.getAttribute("data-toolbar-ladder") ?? "").split(" ").filter((s) => s !== "");
        if (ladder.some((s) => s.startsWith("history>")) && !ladder[ladder.length - 1]!.startsWith("history>")) {
            bad.push(`the history item folds before ${ladder[ladder.length - 1]}`);
        }
        return { bad, toolbar: band !== null };
    }, panes);
}

/** Sets the box the frame fills to a width, and waits for the page to be at rest. */
async function sizeTo(page: Page, box: Locator, width: number): Promise<void> {
    await box.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

test.describe("the Plan's frame (#1193)", () => {
    for (const theme of ["light", "dark"] as const) {
        for (const { name, file, panes } of FRAMED) {
            test(`${name} (${theme}): a BuilderFrame with no border, the panes it is given and no other; one toolbar row, its history last`, async ({ page }) => {
                const entry = await openExample(page, name, file, theme);
                expect((await frameFaults(entry, panes)).bad).toEqual([]);
            });
        }
    }

    test("a Plan with a slice and a review has a toolbar; one with nothing to control has none", async ({ page }) => {
        const slice = await openExample(page, "planTargetState");
        expect((await frameFaults(slice)).toolbar).toBe(true);
        const bare = await openExample(page, "planEvents", EVENTS);
        expect((await frameFaults(bare)).toolbar).toBe(false);
    });

    test("a declared fill is the whole Plan's: the frame takes its host's height, and the canvas scrolls its own rows in main", async ({ page }) => {
        const entry = await openExample(page, "planFill");
        const read = await entry.evaluate((root, scroller) => {
            const wrapper = root.querySelector("[data-plan-frame]")!;
            const host = wrapper.parentElement!.getBoundingClientRect();
            const frame = wrapper.querySelector(":scope > [data-builder-frame]")!.getBoundingClientRect();
            const rows = root.querySelector<HTMLElement>(scroller);
            return {
                bound: wrapper.hasAttribute("data-plan-bound"),
                frame: Math.round(frame.height),
                host: Math.round(host.height),
                scrolls: rows !== null && rows.scrollHeight > rows.clientHeight,
            };
        }, SCROLLER);
        expect(read).toEqual({ bound: true, frame: read.host, host: 240, scrolls: true });
    });

    test("a host that gives the frame a height bounds a canvas that declares none: it fills main and scrolls its own rows there", async ({ page }) => {
        // The event kinds' Plan declares no height, and grows with its rows.
        const entry = await openExample(page, "planEvents", EVENTS);
        await expect(entry.locator("[data-plan-body]:not([data-plan-bounded])")).toHaveCount(1);
        // Its host — holding the Plan alone — is given a height shorter than the canvas: the frame fills it.
        await page.addStyleTag({
            content: "*:has(> [data-plan-frame]) { height: 200px; display: flex; flex-direction: column; } "
                + "*:has(> [data-plan-frame]) > :not([data-plan-frame]) { display: none; }",
        });
        await expect(entry.locator("[data-plan-body][data-plan-bounded]")).toHaveCount(1);
        await settled(page);
        const read = await entry.evaluate((root, scroller) => {
            const wrapper = root.querySelector("[data-plan-frame]")!;
            const host = wrapper.parentElement!;
            const pad = getComputedStyle(host);
            const frame = wrapper.querySelector(":scope > [data-builder-frame]")!.getBoundingClientRect();
            const main = wrapper.querySelector("[data-frame-slot='main']")!.getBoundingClientRect();
            const rows = root.querySelector<HTMLElement>(scroller)!;
            return {
                declared: wrapper.hasAttribute("data-plan-bound"),
                // The host's content box: its 200px less its border and its padding.
                fills: Math.round(frame.height) === Math.round(host.clientHeight - Number.parseFloat(pad.paddingTop) - Number.parseFloat(pad.paddingBottom)),
                // The canvas's scroller sits inside main, never past it.
                inside: rows.getBoundingClientRect().bottom <= main.bottom + 0.5,
                scrolls: rows.scrollHeight > rows.clientHeight,
            };
        }, SCROLLER);
        expect(read).toEqual({ declared: false, fills: true, inside: true, scrolls: true });
    });
});

test.describe("the Plan's frame — its toolbar at every width (#1193, PB21)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "swept once, at the desktop project");

    // A slice, its segments and a one-verb review; a review and editing over a
    // keyed paged source, its key search in the row — each folding on its own ladder.
    for (const name of ["planTargetState", "planReview", "planEditing"]) {
        test(`${name}: one 44px row from 1440px to 360px — nothing past its edge, nothing scrolled — folded as far as its own ladder says, the rail first and the history last, never less at a narrower frame`, async ({ page }) => {
            test.setTimeout(120_000);
            const entry = await openExample(page, name);
            const box = entry.locator("[data-plan-frame]").first().locator("xpath=..");
            const toolbar = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar'] [data-toolbar]");
            const bad: string[] = [];
            let last: { keys: string; folds: number } | undefined;
            for (const width of [1440, 1280, 1024, 900, 768, 640, 560, 480, 420, 360]) {
                await sizeTo(page, box, width);
                const at = await toolbar.evaluate((row) => {
                    const band = row.closest("[data-frame-slot='toolbar']")!.getBoundingClientRect();
                    const items = [...row.children].map((el) => el.getBoundingClientRect());
                    return {
                        state: row.getAttribute("data-toolbar-state") ?? "",
                        ladder: row.getAttribute("data-toolbar-ladder") ?? "",
                        folds: Number(row.getAttribute("data-toolbar-folds")),
                        band: Math.round(band.height),
                        inBand: items.every((b) => b.top >= band.top - 0.5 && b.bottom <= band.bottom + 0.5),
                        scrolls: row.scrollWidth > row.clientWidth + 0.5,
                        fits: items.every((b) => b.right <= row.getBoundingClientRect().right + 0.5),
                    };
                });
                if (at.band !== 44 || !at.inBand || at.scrolls || !at.fits) {
                    bad.push(`at ${width}px: band ${at.band}px, ${at.inBand ? "" : "an item out of the band, "}${at.scrolls ? "scrolled, " : ""}${at.fits ? "" : "past the row's edge"} — ${at.state}`);
                }
                const state = new Map(at.state.split(";").filter((p) => p !== "").map((p) => {
                    const [key, of] = p.split("=");
                    return [key!, Number(of!.split("/")[0])] as const;
                }));
                const ladder = at.ladder.split(" ").filter((s) => s !== "").map((s) => s.split(">")[0]!);
                // What it folded is its ladder's first steps, each item at the form they put it.
                for (const [key, form] of state) {
                    const want = ladder.slice(0, at.folds).filter((k) => k === key).length;
                    if (form !== want) bad.push(`at ${width}px: ${key} at form ${form}, where the ladder's first ${at.folds} steps put it at ${want}`);
                }
                // The rail's steps first; the history's last.
                const firstOwn = ladder.findIndex((k) => !RAIL.includes(k));
                if (firstOwn >= 0 && ladder.slice(firstOwn).some((k) => RAIL.includes(k))) bad.push(`at ${width}px: a rail step after the Plan's own — ${at.ladder}`);
                if (ladder.includes("history") && ladder[ladder.length - 1] !== "history") bad.push(`at ${width}px: the history item folds before the last step — ${at.ladder}`);
                // Never less folded at a narrower frame with the same items (the narrow layout drops the grain).
                const keys = [...state.keys()].join(",");
                if (last !== undefined && last.keys === keys && at.folds < last.folds) bad.push(`at ${width}px: ${at.folds} folds, fewer than the wider frame's ${last.folds}`);
                last = { keys, folds: at.folds };
            }
            expect(bad).toEqual([]);
        });
    }

    test("planEditing, at 360px: the review's verbs in their menu, the key search an icon that opens its box in a popover with the focus in it, the history beside them", async ({ page }) => {
        const entry = await openExample(page, "planEditing");
        const box = entry.locator("[data-plan-frame]").first().locator("xpath=..");
        await sizeTo(page, box, 360);
        const toolbar = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']");
        await expect(toolbar.locator("[data-slot='reviewMenu']")).toBeVisible();
        await expect(toolbar.locator("[data-review-batch]")).toHaveCount(0);
        await expect(toolbar.locator("[data-toolbar-item='history'] [data-slot='history']")).toBeVisible();
        const icon = toolbar.locator("[data-key-search='icon']");
        await expect(icon).toHaveAttribute("aria-label", "Search keys");
        await icon.click();
        const input = page.locator("[data-key-search='popover'] input");
        await expect(input).toBeFocused();
        // The review's menu holds its verbs.
        await page.keyboard.press("Escape");
        await toolbar.locator("[data-slot='reviewMenu']").click();
        await expect(page.locator("[role='menu'] [role='menuitem'][data-review-batch]")).toHaveText([/^Reject /, /^Approve /]);
    });
});

test.describe("the Plan's library on a phone (#1195)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planPrintWorks: the library opens from its rail over main, its last tabs folded into +n, and its Series tab's search is a 44px field the box fills — a tap 20px above or below its middle lands in the box", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        const frame = entry.locator("[data-builder-frame]").first();
        await frame.getByRole("button", { name: "Expand Library" }).tap();
        await settled(page);
        // Four tabs in a phone's pane: Series and Customers fold into the +n menu (#1210).
        const pane = frame.locator("[data-frame-slot='start']");
        await expect(pane.getByRole("tab")).toHaveText([/^Events/, /^Backlog/]);
        await pane.locator("[data-dock-more]").tap();
        await page.getByRole("menuitem", { name: /^Series/ }).tap();
        // The menu closes over the pane's head and its search: measured once it has gone.
        await expect(page.locator('[role="menu"]')).toHaveCount(0);
        await settled(page);
        const search = frame.locator("[data-slot='pickSearch'] input");
        await search.evaluate((el) => el.scrollIntoView({ block: "center" }));
        const faults = await search.evaluate((input) => {
            const bad: string[] = [];
            // The pill around the box is its field.
            const field = input.parentElement!.getBoundingClientRect();
            if (field.height < 43.5) bad.push(`the field is ${field.height.toFixed(1)}px tall`);
            const x = field.left + field.width / 2;
            const y = field.top + field.height / 2;
            for (const dy of [-20, 20]) {
                const hit = document.elementFromPoint(x, y + dy);
                if (hit === null || !input.contains(hit)) bad.push(`a tap ${Math.abs(dy)}px ${dy < 0 ? "above" : "below"} its middle lands on ${hit === null ? "nothing" : hit.tagName.toLowerCase()}`);
            }
            return bad;
        });
        expect(faults).toEqual([]);
        // The pane lies over main, which keeps its place.
        await expect(frame.locator("[data-frame-slot='start'][data-pane-mode='overlay']")).toHaveCount(1);
    });
});
