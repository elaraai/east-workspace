/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * `<Plan>`'s frame, measured in a real browser (#1193, `Plan Builder Spec.md`
 * §7, PB19–PB21): every Plan is its `BuilderFrame` — one toolbar row, main
 * holding the canvas, the footer — drawing no border of its own and no pane it
 * is not given: the library its `library` lists (#1195), and the inspector
 * (#1197). Its toolbar is one 44px row at every width from 1440px to 360px
 * and on a phone: the rail folds first, then the Plan's own steps and the
 * key search into its icon, the history item last. A declared height is the whole Plan's, and a host that
 * gives the frame a height bounds the canvas, which then scrolls its own rows
 * inside main. A selected event wears the brand's 1.5px ring, and the
 * inspector shows it, every line inside the pane. On a phone the library and
 * the inspector open from their rails over main, and the Series tab's search
 * is a 44px field. An event in an overlap pair wears a 1.5px warn ring, a
 * confirmed one keeping its own inside it; the toolbar's overlaps chip is the
 * warn chip, a 44px target on a phone by its halo, and its click brings the
 * pair's row into the canvas's view (#1198). Over event kinds the history
 * item (#1194) ends the row — Undo, Redo, Discard and Save, named by the
 * shared item's words — and is its ladder's last step at every width; the
 * banners under the row take no room while they have nothing to say; and a
 * job's field changed in the inspector is saved on the e3 the page runs, a
 * Plan mounted again showing it. Read at the desktop and phone widths, in
 * both themes.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test plan-frame`.
 */

import { test, expect, type Locator } from "playwright/test";
import { editingMessages } from "@elaraai/east-ui-components/testing";
import { PLAN_EXAMPLES, openExample, planBox, remount, rowSel, sizeBox, toolbarLadderFaults } from "./plan-page";
import { settled } from "./settle";

/** The event kinds' examples file (#1191). */
const EVENTS = "e3/plan/plan-events";

/** Plans of every source and chrome, each by its examples file and the panes
 *  it is given: a slice, its series picked in the library; editing over a keyed
 *  paged source, its palette the library; event kinds — the smallest builder
 *  and the print works — each with its library and its inspector; and the
 *  narrow layout, the flagship's box 360px wide. */
const FRAMED: ReadonlyArray<{ name: string; file: string; panes?: readonly string[]; box?: number }> = [
    { name: "planTargetState", file: PLAN_EXAMPLES, panes: ["start"] },
    { name: "planRowDrop", file: PLAN_EXAMPLES, panes: ["start"] },
    { name: "planEvents", file: EVENTS, panes: ["start", "end"] },
    { name: "planPrintWorks", file: EVENTS, panes: ["start", "end"] },
    { name: "planTargetState", file: PLAN_EXAMPLES, panes: ["start"], box: 360 },
];

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
        // The panes it is given — the library (#1195) and the inspector (#1197) — and no other.
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
        // The canvas draws no toolbar of its own, no chip row.
        if (main !== null && main.querySelector("[data-toolbar], [data-slot='narrowChips']") !== null) {
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

test.describe("the Plan's frame (#1193)", () => {
    for (const theme of ["light", "dark"] as const) {
        for (const { name, file, panes, box } of FRAMED) {
            test(`${name}${box === undefined ? "" : ` in a ${box}px box`} (${theme}): a BuilderFrame with no border, the panes it is given and no other; one toolbar row, its history last`, async ({ page }) => {
                const entry = await openExample(page, name, file, theme);
                if (box !== undefined) await sizeBox(page, planBox(entry), box);
                expect((await frameFaults(entry, panes)).bad).toEqual([]);
            });
        }
    }

    // A Plan with nothing to control draws no toolbar: the frame's DOM test holds
    // it (`plan-frame.dom.test.tsx`), over a canvas of read-only rows — every
    // Plan the showcase shows has a control.
    test("a Plan with a slice has a toolbar; the event kinds' Plan, whose jobs overlap, its overlaps chip and its history item", async ({ page }) => {
        const slice = await openExample(page, "planTargetState");
        expect((await frameFaults(slice)).toolbar).toBe(true);
        // Press B2's two jobs on the 20th overlap (#1198), and the jobs' session is the history item's (#1194).
        const overlapping = await openExample(page, "planEvents", EVENTS);
        expect((await frameFaults(overlapping)).toolbar).toBe(true);
        expect(await overlapping.locator("[data-builder-frame] > [data-frame-slot='toolbar'] [data-toolbar-item]")
            .evaluateAll((items) => items.map((item) => item.getAttribute("data-toolbar-item")))).toEqual(["overlaps", "history"]);
        await expect(overlapping.locator("[data-builder-frame] > [data-frame-slot='toolbar'] [data-plan-overlaps]")).toHaveText("1 overlap");
    });

    test("a declared fill is the whole Plan's: the frame takes its host's height, and the canvas scrolls its own rows in main", async ({ page }) => {
        const entry = await openExample(page, "planTargetState");
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
        expect(read).toEqual({ bound: true, frame: read.host, host: 720, scrolls: true });
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

    // A slice and its segments; editing over a keyed paged source, its key
    // search in the row; the print works' event kinds, their overlaps chip and
    // their history (#1194) — each folding on its own ladder.
    for (const { name, file } of [
        { name: "planTargetState", file: PLAN_EXAMPLES },
        { name: "planRowDrop", file: PLAN_EXAMPLES },
        { name: "planPrintWorks", file: EVENTS },
    ]) {
        test(`${name}: one 44px row from 1440px to 360px — nothing past its edge, nothing scrolled — folded as far as its own ladder says, the rail first and the history last, never less at a narrower frame`, async ({ page }) => {
            test.setTimeout(120_000);
            const entry = await openExample(page, name, file);
            expect(await toolbarLadderFaults(page, entry, [1440, 1280, 1024, 900, 768, 640, 560, 480, 420, 360])).toEqual([]);
        });
    }

    test("planRowDrop, at 360px: no review in the row — the key search an icon that opens its box in a popover with the focus in it, the history beside it", async ({ page }) => {
        const entry = await openExample(page, "planRowDrop");
        await sizeBox(page, planBox(entry), 360);
        const toolbar = entry.locator("[data-builder-frame] > [data-frame-slot='toolbar']");
        // A Plan approves and rejects nothing (#1260): no review item, no verdict menu.
        await expect(toolbar.locator("[data-toolbar-item='review'], [data-slot='reviewMenu'], [data-review-batch]")).toHaveCount(0);
        await expect(toolbar.locator("[data-toolbar-item='history'] [data-slot='history']")).toBeVisible();
        const icon = toolbar.locator("[data-key-search='icon']");
        await expect(icon).toHaveAttribute("aria-label", "Search keys");
        await icon.click();
        const input = page.locator("[data-key-search='popover'] input");
        await expect(input).toBeFocused();
    });
});

/** The history item's buttons (#1194), by the shared item's words: Undo, Redo, Discard and the commit. */
const HISTORY_BUTTONS = [editingMessages.undo(), editingMessages.redo(), editingMessages.discard(), editingMessages.apply()];

/**
 * What is wrong with a Plan's history item and its banners while nothing is
 * drafted, read in the page — each a line saying what: the item ends the row
 * and the ladder, each of its buttons is inside the band and the row and off,
 * and the banners under the row take no room.
 */
async function historyFaults(entry: Locator): Promise<string[]> {
    return entry.evaluate((root, names) => {
        const bad: string[] = [];
        const frame = root.querySelector("[data-plan-frame] > [data-builder-frame]");
        const band = frame?.querySelector(":scope > [data-frame-slot='toolbar']") ?? null;
        const row = band?.querySelector("[data-toolbar]") ?? null;
        const history = band?.querySelector("[data-toolbar-item='history']") ?? null;
        if (frame === null || band === null || row === null) return ["no toolbar"];
        if (history === null) return ["no history item"];
        // The row's end: no item drawn past it, and the last step its ladder folds.
        const end = history.getBoundingClientRect().right;
        for (const item of row.querySelectorAll("[data-toolbar-item]")) {
            const r = item.getBoundingClientRect();
            if (item !== history && r.width > 0 && r.right > end + 0.5) bad.push(`${item.getAttribute("data-toolbar-item")} ends at ${r.right.toFixed(1)}, past the history's ${end.toFixed(1)}`);
        }
        const ladder = (row.getAttribute("data-toolbar-ladder") ?? "").split(" ").filter((s) => s !== "");
        if (!(ladder[ladder.length - 1] ?? "").startsWith("history>")) bad.push(`the ladder's last step is ${ladder[ladder.length - 1] ?? "none"}`);
        const b = band.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        for (const name of names) {
            const button = history.querySelector<HTMLButtonElement>(`button[aria-label=${JSON.stringify(name)}]`);
            if (button === null) {
                bad.push(`no ${name}`);
                continue;
            }
            const t = button.getBoundingClientRect();
            if (t.top < b.top - 0.5 || t.bottom > b.bottom + 0.5) bad.push(`${name}: ${t.top.toFixed(1)}–${t.bottom.toFixed(1)} outside the band ${b.top.toFixed(1)}–${b.bottom.toFixed(1)}`);
            if (t.left < r.left - 0.5 || t.right > r.right + 0.5) bad.push(`${name}: ${t.left.toFixed(1)}–${t.right.toFixed(1)} past the row's ${r.left.toFixed(1)}–${r.right.toFixed(1)}`);
            if (!button.disabled) bad.push(`${name} is on, with nothing drafted`);
        }
        // Nothing to say: the banners take no room, and the body sits on the band.
        const banners = frame.querySelector(":scope > [data-frame-slot='banners']");
        const tall = banners === null ? 0 : banners.getBoundingClientRect().height;
        if (tall !== 0) bad.push(`the banners are ${tall}px tall, saying nothing`);
        const body = frame.querySelector(":scope > [data-frame-slot='body']")!.getBoundingClientRect();
        if (Math.abs(body.top - b.bottom) > 0.5) bad.push(`the body starts ${(body.top - b.bottom).toFixed(1)}px below the band`);
        return bad;
    }, HISTORY_BUTTONS);
}

test.describe("the Plan's history over its event kinds (#1194)", () => {
    for (const theme of ["light", "dark"] as const) {
        test(`planPrintWorks (${theme}): the history item ends the toolbar's one 44px row — Undo, Redo, Discard and Save in the shared item's words, every one inside the row, off with nothing drafted — the ladder's last step; the banners under the row take no room`, async ({ page }) => {
            const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
            expect(await historyFaults(entry)).toEqual([]);
        });
    }
});

test.describe("the Plan's Save on e3-web (#1194)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "saved once, at the desktop width");

    test("planPrintWorks: a job's customer changed in the inspector is a draft, the field tinted brand; Save commits it to the jobs record on the e3 the page runs — the draft retires, no banner — and the Plan mounted again shows it", async ({ page }) => {
        // The inspector pinned open beside main (#1220), in a box wide enough for both panes.
        const open = async (entry: Locator) => {
            await sizeBox(page, planBox(entry), 1440);
            await entry.locator(`${rowSel("presses.span", "Hall A", "a1")} [data-run]`, { hasText: "Spring catalogue" }).click();
            await settled(page);
            const frame = entry.locator("[data-builder-frame]").first();
            return {
                frame,
                save: frame.locator(":scope > [data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.apply(), exact: true }),
                customer: frame.locator(":scope > [data-frame-slot='body'] > [data-frame-slot='end'] [data-inspector-fields='form'] [data-field='customer']"),
            };
        };
        const { frame, save, customer } = await open(await openExample(page, "planPrintWorks", EVENTS));
        await expect(save).toBeDisabled();
        await expect(customer.getByRole("textbox")).toHaveValue("Alder & Finch");
        await customer.getByRole("textbox").fill("Alder & Finch Ltd");
        await customer.getByRole("textbox").press("Enter");
        await expect(save).toBeEnabled();
        await expect.poll(() => customer.evaluate((el) => {
            const probe = document.createElement("span");
            probe.style.background = "var(--chakra-colors-brand-tint)";
            document.body.appendChild(probe);
            const tint = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return [el.hasAttribute("data-dirty"), getComputedStyle(el).backgroundColor === tint];
        })).toEqual([true, true]);
        await save.click();
        // Confirmed by the record read back: Save off, the field the record's, no banner.
        await expect(save).toBeDisabled();
        await expect(customer).not.toHaveAttribute("data-dirty", /.*/);
        await expect(customer.getByRole("textbox")).toHaveValue("Alder & Finch Ltd");
        await expect(frame.locator(":scope > [data-frame-slot='banners'] [data-session-banner]")).toHaveCount(0);
        // Mounted afresh over the record: the job's customer is the one saved.
        const again = await open(await remount(page, "planPrintWorks", EVENTS));
        await expect(again.customer.getByRole("textbox")).toHaveValue("Alder & Finch Ltd");
        await expect(again.customer).not.toHaveAttribute("data-dirty", /.*/);
        await expect(again.save).toBeDisabled();
    });
});

/** What of the inspector's lines falls outside its pane's box, read in the page — the pane pinned beside main, or open over it. */
async function inspectorFaults(pane: Locator): Promise<string[]> {
    return pane.evaluate((slot) => {
        const box = (slot.querySelector("[data-orientation][data-side][data-surface]") ?? slot).getBoundingClientRect();
        const bad: string[] = [];
        const lines = slot.querySelectorAll("[data-inspector-title], [data-inspector-when], [data-fact], [data-field], [data-inspector-action], [data-count], [data-plan-inspector] li");
        if (lines.length === 0) bad.push("the inspector shows nothing");
        for (const el of lines) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            const what = el.getAttribute("data-fact") ?? el.getAttribute("data-field") ?? el.getAttribute("data-inspector-action") ?? el.getAttribute("data-count") ?? el.tagName.toLowerCase();
            if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`${what}: ${r.left.toFixed(1)}–${r.right.toFixed(1)} outside the pane's ${box.left.toFixed(1)}–${box.right.toFixed(1)}`);
        }
        return bad;
    });
}

test.describe("the Plan's inspector (#1197)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read open at the desktop width; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`planPrintWorks (${theme}): a selected job's bar wears a 1.5px ring in the brand just outside it, and the inspector shows the job, every line inside the pane`, async ({ page }) => {
            const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
            // A box wide enough for both panes beside main's 480px: the inspector pinned open, its lines laid out (#1220 —
            // at the desktop project's own width the inspector rests on its rail, and a collapsed pane has nothing to measure).
            await sizeBox(page, planBox(entry), 1440);
            const bar = entry.locator(`${rowSel("presses.span", "Hall A", "a1")} [data-run]`, { hasText: "Spring catalogue" });
            await bar.click();
            await settled(page);
            const ring = await bar.evaluate((el) => {
                const s = getComputedStyle(el);
                // The brand's ink, and 1.5px as this screen draws it (a width snaps to its device pixels), resolved as the page resolves them.
                const probe = document.createElement("span");
                probe.style.color = "var(--chakra-colors-brand-solid)";
                probe.style.outline = "1.5px solid";
                el.appendChild(probe);
                const brand = getComputedStyle(probe).color;
                const width = getComputedStyle(probe).outlineWidth;
                probe.remove();
                return { width: s.outlineWidth, style: s.outlineStyle, offset: s.outlineOffset, color: s.outlineColor, brand, want: width, pressed: el.getAttribute("aria-pressed") };
            });
            expect(ring).toEqual({ width: ring.want, style: "solid", offset: "1px", color: ring.brand, brand: ring.brand, want: ring.want, pressed: "true" });
            const pane = entry.locator("[data-builder-frame] > [data-frame-slot='body'] > [data-frame-slot='end']");
            await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
            await expect(pane).not.toHaveAttribute("data-collapsed", /.*/);
            await expect(pane.locator("[data-plan-inspector='event'] [data-inspector-title]")).toHaveText("Spring catalogue");
            expect(await inspectorFaults(pane)).toEqual([]);
        });
    }
});

/** The overlaps chip in a Plan's toolbar. */
const OVERLAPS_CHIP = "[data-builder-frame] > [data-frame-slot='toolbar'] [data-plan-overlaps]";

test.describe("the Plan's overlaps (#1198)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read on the desktop canvas's rows; a phone's canvas is its narrow list, its chip read below");

    for (const theme of ["light", "dark"] as const) {
        test(`planPrintWorks (${theme}): each job in an overlap pair wears a 1.5px warn ring just outside its bar — a confirmed job its inset brand ring inside it — a job in no pair none; the chip is the warn chip`, async ({ page }) => {
            const entry = await openExample(page, "planPrintWorks", EVENTS, theme);
            const rings = await entry.evaluate((root, row) => {
                // A shadow, and a colour, as this page resolves the tokens they are written in.
                const probe = (style: Partial<CSSStyleDeclaration>, read: "boxShadow" | "color" | "backgroundColor" | "borderTopColor") => {
                    const span = document.createElement("span");
                    Object.assign(span.style, style);
                    root.appendChild(span);
                    const value = getComputedStyle(span)[read];
                    span.remove();
                    return value;
                };
                const bar = (title: string) => [...root.querySelectorAll<HTMLElement>(`${row} [data-run]`)].find((el) => el.textContent?.startsWith(title))!;
                const chip = getComputedStyle(root.querySelector("[data-plan-overlaps]")!);
                return {
                    // Confirmed, and in the pair.
                    posters: getComputedStyle(bar("Market posters")).boxShadow,
                    // Proposed, and in the pair.
                    cards: getComputedStyle(bar("Loyalty cards")).boxShadow,
                    // Actual, on the same press on the 9th: in no pair.
                    timetables: getComputedStyle(bar("Timetables")).boxShadow,
                    ring: probe({ boxShadow: "0 0 0 1.5px var(--chakra-colors-status-warn)" }, "boxShadow"),
                    both: probe({ boxShadow: "inset 0 0 0 1.5px var(--chakra-colors-brand-solid), 0 0 0 1.5px var(--chakra-colors-status-warn)" }, "boxShadow"),
                    chip: { border: chip.borderTopColor, wash: chip.backgroundColor, ink: chip.color },
                    warn: {
                        border: probe({ borderTopColor: "var(--chakra-colors-status-warn)" }, "borderTopColor"),
                        wash: probe({ backgroundColor: "var(--chakra-colors-status-warn-subtle)" }, "backgroundColor"),
                        ink: probe({ color: "var(--chakra-colors-fg-warning)" }, "color"),
                    },
                };
            }, rowSel("presses.span", "Hall B", "b2"));
            expect(rings).toEqual({ ...rings, posters: rings.both, cards: rings.ring, timetables: "none", chip: rings.warn });
            await expect(entry.locator(OVERLAPS_CHIP)).toHaveText("1 overlap");
        });
    }

    test("planPrintWorks, in a host 420px tall: the chip's click selects the pair and brings Press B2's row into the canvas's view", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        await page.addStyleTag({
            content: "*:has(> [data-plan-frame]) { height: 420px; display: flex; flex-direction: column; } "
                + "*:has(> [data-plan-frame]) > :not([data-plan-frame]) { display: none; }",
        });
        await expect(entry.locator("[data-plan-body][data-plan-bounded]")).toHaveCount(1);
        await settled(page);
        const b2 = rowSel("presses.span", "Hall B", "b2");
        // Whether Press B2's row is drawn wholly inside the canvas's scroller.
        const inView = () => entry.evaluate((root, args) => {
            const scroller = root.querySelector<HTMLElement>(args.scroller)!.getBoundingClientRect();
            const row = root.querySelector(args.row);
            if (row === null) return false;
            const r = row.getBoundingClientRect();
            return r.top >= scroller.top - 0.5 && r.bottom <= scroller.bottom + 0.5;
        }, { scroller: SCROLLER, row: b2 });
        expect(await inView()).toBe(false);
        await entry.locator(OVERLAPS_CHIP).click();
        await settled(page);
        expect(await inView()).toBe(true);
        await expect(entry.locator(`${b2} [data-run][aria-pressed='true']`)).toHaveCount(2);
    });
});

test.describe("the Plan's overlaps chip on a phone (#1198)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planPrintWorks: the chip keeps its own size in the row and is a 44px tap target by its halo", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        const faults = await entry.locator(OVERLAPS_CHIP).evaluate((chip) => {
            const bad: string[] = [];
            const r = chip.getBoundingClientRect();
            if (r.height >= 43.5) bad.push(`the chip grew to ${r.height.toFixed(1)}px`);
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            for (const dy of [-21, 21]) {
                const hit = document.elementFromPoint(x, y + dy);
                if (hit === null || !chip.contains(hit)) bad.push(`a tap ${Math.abs(dy)}px ${dy < 0 ? "above" : "below"} its middle lands on ${hit === null ? "nothing" : hit.tagName.toLowerCase()}`);
            }
            return bad;
        });
        expect(faults).toEqual([]);
    });
});

test.describe("the Plan's library on a phone (#1195)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planPrintWorks: the library opens from its rail over main, its last tabs folded into +n, and its Series tab's search is a 44px field the box fills — a tap 20px above or below its middle lands in the box", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        const frame = entry.locator("[data-builder-frame]").first();
        await frame.getByRole("button", { name: "Expand Library" }).tap();
        await settled(page);
        // Four tabs in a phone's pane, beside the inspector's rail (#1197): Backlog, Series and Customers fold into the +n menu (#1210).
        const pane = frame.locator("[data-frame-slot='start']");
        await expect(pane.getByRole("tab")).toHaveText([/^Events/]);
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

test.describe("the Plan's inspector on a phone (#1197)", () => {
    test.skip(({ isMobile }) => !isMobile, "a coarse pointer: the phone projects");

    test("planPrintWorks: the inspector opens from its rail over main, the window's counts and hints in it, every line inside the pane", async ({ page }) => {
        const entry = await openExample(page, "planPrintWorks", EVENTS);
        const frame = entry.locator("[data-builder-frame]").first();
        await frame.getByRole("button", { name: "Expand Inspector" }).tap();
        await settled(page);
        const pane = frame.locator("[data-frame-slot='end']");
        await expect(pane).toHaveAttribute("data-pane-mode", "overlay");
        await expect(pane.locator("[data-plan-inspector='none'] [data-count='events']")).toBeVisible();
        expect(await inspectorFaults(pane)).toEqual([]);
    });
});
