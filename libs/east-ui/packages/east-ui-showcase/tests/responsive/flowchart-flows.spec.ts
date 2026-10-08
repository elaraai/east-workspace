/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * The Flowchart's Flows tab in its pane, and its editing, measured in a real
 * browser (#1246, #1247, `Flowchart Builder Spec.md` decision 5, §7, §8,
 * FB12–FB15, FB17–FB21), on the depot's record of flows by name. The tab fills its pane: the cards over the foot,
 * the foot along the pane's bottom under its rule, "+ New flow" at its end —
 * Font Awesome's solid plus, the brand's mono caps — each card inside the
 * pane with its flow's icon, the open flow's placed, nothing past the pane's
 * edge and no border of the tab's own. At the desktop width the pane is
 * pinned open beside the canvas; on a phone it opens from its rail — which
 * counts the flows — over main, and there "+ New flow" is a 44px tap target
 * by its halo, whole inside the foot. In both themes. Over the record the toolbar ends with the history
 * item, which folds last: one row at every width from 1440px to 300px. And a
 * new flow made in the tab is committed to the e3 the page runs: named in its
 * popover — a name the record holds refused there — it opens with its one
 * lane, placed and Pending, and the history item's commit writes it through
 * the record's patch mutation, its Pending going once the record reads it
 * back. Where it edits, its gestures' controls are Font Awesome's solid icons
 * (#1247): each lane's × beside its header in the header's ink, off — faded —
 * while the lane holds states, and on a phone a 44px tap target by its halo;
 * "+ LANE"'s plus over its word at the band row's tail; the "+ STATE" ghost's
 * plus beside its word — no `+` or `×` drawn as text. A gesture there is a
 * draft of the e3 the page runs: ⌘Z undoes it and ⇧⌘Z redoes it from the
 * canvas, the footer counts it, and Save commits it through the record's
 * patch mutation. Every measurement is polled until it holds, on a page at
 * rest.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test flowchart-flows`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { settled } from "./settle";

const HASH = "e3/flowchart/flowchart/flowchartFlows";

/** Over the record: LR · TD folds into its chip, find state into its icon, and the history item folds last. */
const LADDER = "orientation>1 seek>1 history>1";

/** The library pane's width open (§8). */
const PANE = 272;

/** Open the depot's flows, at rest, and return the flowchart's root: the box its frame fills. */
async function openFlows(page: Page, theme: "light" | "dark" = "light"): Promise<Locator> {
    await page.goto(`/?theme=${theme}#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator("[data-builder-frame] [data-flowchart-node]").first()).toBeVisible({ timeout: 20_000 });
    await settled(page);
    return entry.locator("[data-flowchart-root]").first();
}

/** Size the flowchart's box and wait for the page to be at rest. */
async function sizeTo(page: Page, root: Locator, width: number): Promise<void> {
    await root.evaluate((el, w) => { (el as HTMLElement).style.width = `${w}px`; }, width);
    await settled(page);
}

/**
 * The Flows tab as the page lays it out in its pane: where its parts sit
 * against the pane's sheet and each other, each gap to a tenth of a pixel;
 * the foot's rule and "+ New flow"'s look beside the theme's tokens; the
 * cards; and what is drawn past the sheet's sides.
 */
function flowsTabOf(root: Locator) {
    return root.evaluate((el) => {
        const round = (n: number) => Math.round(n * 10) / 10;
        const slot = el.querySelector("[data-frame-slot='start']")!;
        const sheet = slot.firstElementChild!.getBoundingClientRect();
        const tab = slot.querySelector("[data-flowchart-flows]")!;
        const t = tab.getBoundingClientRect();
        const panel = tab.closest("[role='tabpanel']")!.getBoundingClientRect();
        const list = tab.firstElementChild!.getBoundingClientRect();
        const foot = tab.lastElementChild!;
        const f = foot.getBoundingClientRect();
        const button = foot.querySelector("[data-flowchart-new-flow]")!;
        const b = button.getBoundingClientRect();
        const ink = (token: string) => {
            const probe = document.createElement("div");
            probe.style.color = `var(--chakra-colors-${token})`;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const borders = (e: Element) => {
            const cs = getComputedStyle(e);
            return [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
        };
        const fs = getComputedStyle(foot);
        const bs = getComputedStyle(button);
        const icon = button.firstElementChild;
        return {
            mode: slot.getAttribute("data-pane-mode"),
            sheet: round(sheet.width),
            tabs: [...slot.querySelectorAll("[role='tab']")].map((tabEl) => tabEl.textContent),
            // The tab is its panel's whole box, the panel ending at the pane's bottom.
            tabInPanel: [t.left - panel.left, t.top - panel.top, t.right - panel.right, t.bottom - panel.bottom].map(round),
            panelToSheet: round(sheet.bottom - panel.bottom),
            // The cards over the foot, each the tab's width; the foot along the tab's bottom.
            list: [list.left - t.left, list.top - t.top, list.right - t.right, list.bottom - f.top].map(round),
            foot: [f.left - t.left, f.right - t.right, f.bottom - t.bottom, round(f.height)].map(round),
            // "+ New flow" at the foot's end, inside its padding, its middle the middle of the foot under its rule.
            button: [f.right - b.right, (b.top + b.bottom) / 2 - (f.top + 1 + f.bottom) / 2].map(round),
            borders: [...borders(tab), ...borders(tab.firstElementChild!)],
            rule: [fs.borderTopWidth, fs.borderTopStyle, fs.borderTopColor, fs.borderRightWidth, fs.borderBottomWidth, fs.borderLeftWidth],
            subtle: ink("border-subtle"),
            label: {
                text: button.textContent,
                icon: icon === null ? null : `${icon.tagName.toLowerCase()} ${icon.getAttribute("data-prefix")} ${icon.getAttribute("data-icon")}`,
                mono: bs.fontFamily.includes("Mono"),
                type: [bs.fontSize, bs.fontWeight, bs.textTransform, bs.letterSpacing],
                color: bs.color,
            },
            brand: ink("brand-solid"),
            cards: [...tab.querySelectorAll("[data-library-item]")].map((card) => {
                const c = card.getBoundingClientRect();
                const svg = card.querySelector("svg");
                return {
                    name: card.getAttribute("data-library-item"),
                    placed: card.hasAttribute("data-placed"),
                    icon: svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`,
                    inside: c.left >= list.left - 0.5 && c.right <= list.right + 0.5 && c.top >= list.top - 0.5 && c.bottom <= list.bottom + 0.5,
                };
            }),
            past: [...slot.firstElementChild!.querySelectorAll("*")].filter((e) => {
                const r = e.getBoundingClientRect();
                return r.width > 0 && (r.left < sheet.left - 0.5 || r.right > sheet.right + 0.5);
            }).map((e) => `${e.tagName.toLowerCase()} ${e.getAttribute("data-slot") ?? e.getAttribute("data-library-item") ?? ""}`.trim()),
        };
    });
}

/** What the Flows tab shows, wherever its pane is: the depot's two flows, the first by name open. */
function expectFlowsTab(read: Awaited<ReturnType<typeof flowsTabOf>>, footHeight: number): void {
    expect(read.tabs).toEqual(["Flows 2"]);
    expect([read.tabInPanel, read.panelToSheet]).toEqual([[0, 0, 0, 0], 0]);
    expect(read.list).toEqual([0, 0, 0, 0]);
    expect(read.foot).toEqual([0, 0, 0, footHeight]);
    expect(read.button).toEqual([14, 0]);
    expect(read.borders).toEqual(Array.from({ length: 8 }, () => "0px"));
    expect(read.rule).toEqual(["1px", "solid", read.subtle, "0px", "0px", "0px"]);
    expect(read.label).toEqual({ text: "New flow", icon: "svg fas plus", mono: true, type: ["10px", "600", "uppercase", "1.4px"], color: read.brand });
    expect(read.cards).toEqual([
        { name: "Inbound parcels", placed: true, icon: "fas diagram-project", inside: true },
        { name: "Returns", placed: false, icon: "fas diagram-project", inside: true },
    ]);
    expect(read.past).toEqual([]);
}

/**
 * The canvas's gesture controls as the page lays them out (#1247): each lane's
 * × — its icon, where it stands against its header, its size and ink, whether
 * it is off — "+ LANE"'s, and every text node of the canvas's drawing that is
 * a bare glyph — a `+` or a `×` — where an icon belongs.
 */
function gesturesOf(root: Locator) {
    return root.evaluate((el) => {
        const round = (n: number) => Math.round(n * 10) / 10;
        const ink = (token: string) => {
            const probe = document.createElement("div");
            probe.style.color = `var(--chakra-colors-${token})`;
            document.body.appendChild(probe);
            const color = getComputedStyle(probe).color;
            probe.remove();
            return color;
        };
        const icon = (e: Element) => {
            const svg = e.querySelector("svg");
            return svg === null ? null : `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`;
        };
        const wrap = el.querySelector("[data-flowchart-canvas]")!.parentElement!;
        const canvas = wrap.getBoundingClientRect();
        const lanes = [...el.querySelectorAll("[data-flowchart-lane]")].map((text) => {
            const key = text.getAttribute("data-flowchart-lane")!;
            const close = [...el.querySelectorAll("[data-flowchart-lane-delete]")].find((c) => c.getAttribute("data-flowchart-lane-delete") === key)!;
            const t = text.getBoundingClientRect();
            const c = close.getBoundingClientRect();
            const glyph = close.querySelector("svg")!.getBoundingClientRect();
            const cs = getComputedStyle(close);
            return {
                key,
                icon: icon(close),
                text: close.textContent,
                // Past the header's end, its middle the header's.
                gap: round(c.left - t.right),
                middle: round((c.top + c.bottom) / 2 - (t.top + t.bottom) / 2),
                size: [round(c.width), round(c.height), round(glyph.height)],
                // The glyph centred in its box.
                centred: Math.abs((glyph.left + glyph.right) / 2 - (c.left + c.right) / 2) <= 0.5 && Math.abs((glyph.top + glyph.bottom) / 2 - (c.top + c.bottom) / 2) <= 0.5,
                off: close.getAttribute("aria-disabled"),
                opacity: cs.opacity,
                color: cs.color,
            };
        });
        const add = el.querySelector("[data-flowchart-addlane]")!;
        const a = add.getBoundingClientRect();
        const plus = add.querySelector("svg")!.getBoundingClientRect();
        const word = add.querySelector("span")!.getBoundingClientRect();
        const as = getComputedStyle(add);
        const glyphs: string[] = [];
        const walker = document.createTreeWalker(el.querySelector("[data-flowchart-canvas]")!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const text = (walker.currentNode.textContent ?? "").trim();
            if (/^[+×✕]/u.test(text)) glyphs.push(text);
        }
        return {
            lanes,
            subtle: ink("fg-subtle"),
            strong: ink("border-strong"),
            add: {
                icon: icon(add),
                text: add.textContent,
                label: add.getAttribute("aria-label"),
                // The band row's tail: past the last lane, inside the canvas.
                inside: a.left >= canvas.left && a.right <= canvas.right + 0.5 && a.top >= canvas.top && a.bottom <= canvas.bottom + 0.5,
                // Its plus over its word, both centred across it.
                stacked: plus.bottom <= word.top + 0.5 && Math.abs((plus.left + plus.right) / 2 - (a.left + a.right) / 2) <= 0.5
                    && Math.abs((word.left + word.right) / 2 - (a.left + a.right) / 2) <= 0.5,
                border: [as.borderTopStyle, as.borderTopWidth, as.borderTopColor, as.borderTopLeftRadius],
                type: [as.fontSize, as.textTransform, as.letterSpacing, as.color],
            },
            glyphs,
        };
    });
}

/** What the toolbar says of itself: each item's form, the ladder, how many steps it took, and what runs past its row. */
function toolbarOf(root: Locator) {
    return root.evaluate((el) => {
        const band = el.querySelector("[data-frame-slot='toolbar']")!;
        const bar = band.querySelector("[data-toolbar]")!;
        const b = band.getBoundingClientRect();
        const row = bar.getBoundingClientRect();
        const past = [...bar.querySelectorAll("[data-toolbar-item]")].flatMap((item) => {
            const r = item.getBoundingClientRect();
            if (r.width === 0) return [];
            const key = item.getAttribute("data-toolbar-item");
            const out: string[] = [];
            if (r.right > row.right + 0.5) out.push(`${key} ends past the row`);
            if (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5) out.push(`${key} out of the band`);
            return out;
        });
        return {
            band: Math.round(b.height),
            rows: band.querySelectorAll("[data-toolbar]").length,
            state: bar.getAttribute("data-toolbar-state") ?? "",
            ladder: bar.getAttribute("data-toolbar-ladder") ?? "",
            folds: Number(bar.getAttribute("data-toolbar-folds")),
            past,
        };
    });
}

test.describe("The Flowchart's Flows tab (#1246)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "measured once, at the desktop width; the phone's below");

    for (const theme of ["light", "dark"] as const) {
        test(`pinned open beside the canvas: the cards over the foot, the foot along the pane's bottom under its rule, "+ New flow" at its end, nothing past the pane (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            // Room beside main: the pane pins, and opens.
            await sizeTo(page, root, 1200);
            await expect.poll(async () => { const read = await flowsTabOf(root); return [read.mode, read.sheet]; }).toEqual(["pinned", PANE]);
            expectFlowsTab(await flowsTabOf(root), 36);
        });

        test(`over the record the toolbar ends with the history item, which folds last: one row at every width from 1440px to 300px, nothing past its edge (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            const seen: number[] = [];
            for (const width of [1440, 1000, 640, 480, 400, 360, 320, 300]) {
                await sizeTo(page, root, width);
                const bar = await toolbarOf(root);
                expect(bar.ladder).toBe(LADDER);
                expect([bar.band, bar.rows, bar.past], `at ${width}px`).toEqual([44, 1, []]);
                // What it folded is the ladder's first steps: each item at the form they put it.
                const steps = LADDER.split(" ").slice(0, bar.folds);
                for (const part of bar.state.split(";")) {
                    const [key, of] = part.split("=");
                    expect(Number(of!.split("/")[0]), `at ${width}px: ${key}`).toBe(steps.filter((s) => s.startsWith(`${key}>`)).length);
                }
                seen.push(bar.folds);
            }
            // Unfolded with room, every step taken at the narrowest — the history item's last — and a narrower row never folds less.
            expect(seen[0]).toBe(0);
            expect(seen[seen.length - 1]).toBe(LADDER.split(" ").length);
            for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
        });
    }

    for (const theme of ["light", "dark"] as const) {
        test(`where it edits, the canvas's gestures are Font Awesome's solid icons: each lane's × beside its header in its ink, off while it holds states; + LANE's plus over its word; the + STATE ghost's plus beside its word; no glyph drawn as text (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            await sizeTo(page, root, 1200);
            // Every lane of the inbound flow holds states: each × is off, and faded.
            const read = await gesturesOf(root);
            expect(read.lanes.map((l) => l.key)).toEqual(["intake", "sort", "load"]);
            for (const lane of read.lanes) {
                expect([lane.icon, lane.text, lane.size, lane.centred, lane.off, lane.opacity, lane.color], lane.key)
                    .toEqual(["fas xmark", "", [14, 14, 10], true, "true", "0.4", read.subtle]);
                expect(lane.gap, `${lane.key}: past its header's end`).toBeGreaterThanOrEqual(4);
                expect(lane.gap, `${lane.key}: beside its header`).toBeLessThanOrEqual(16);
                expect(Math.abs(lane.middle), `${lane.key}: on its header's middle`).toBeLessThanOrEqual(2);
            }
            expect(read.add).toEqual({
                icon: "fas plus", text: "Lane", label: "Add lane", inside: true, stacked: true,
                border: ["dashed", "1px", read.strong, "6px"], type: ["9px", "uppercase", "2px", read.subtle],
            });
            expect(read.glyphs).toEqual([]);
            // A lane added: its × is on, in full ink.
            await root.locator("[data-flowchart-addlane]").click();
            await expect.poll(async () => (await gesturesOf(root)).lanes.map((l) => [l.key, l.off, l.opacity])).toEqual([
                ["intake", "true", "0.4"], ["sort", "true", "0.4"], ["load", "true", "0.4"], ["lane-4", null, "1"],
            ]);
            // The + STATE ghost, over a hovered lane: its plus beside its word, centred in the state's footprint.
            await root.locator("[data-flowchart-band='lane-4']").hover();
            const ghost = root.locator("[data-flowchart-ghoststate='lane-4']");
            await expect(ghost).toBeVisible();
            expect(await ghost.evaluate((g) => {
                const r = g.getBoundingClientRect();
                const svg = g.querySelector("svg")!;
                const s = svg.getBoundingClientRect();
                const w = g.querySelector("span")!.getBoundingClientRect();
                return {
                    icon: `${svg.getAttribute("data-prefix")} ${svg.getAttribute("data-icon")}`,
                    text: g.textContent,
                    size: [Math.round(r.width), Math.round(r.height)],
                    beside: s.right <= w.left + 0.5 && Math.abs((s.top + s.bottom) / 2 - (w.top + w.bottom) / 2) <= 1,
                    centred: Math.abs((s.left + w.right) / 2 - (r.left + r.right) / 2) <= 1,
                };
            })).toEqual({ icon: "fas plus", text: "state", size: [116, 40], beside: true, centred: true });
        });
    }

    test("a gesture is a draft of the e3 the page runs: ⌘Z undoes it and ⇧⌘Z redoes it from the canvas, the footer counts it, and Save commits it through the record's patch mutation", async ({ page }) => {
        const root = await openFlows(page);
        await sizeTo(page, root, 1200);
        const lanes = () => root.locator("[data-flowchart-lane]").allTextContents();
        const pending = root.locator("[data-flowchart-pending]");
        const card = root.locator("[data-frame-slot='start'] [data-library-item='Inbound parcels']");
        await expect(pending).toHaveText(" · 0 pending");
        await root.locator("[data-flowchart-addlane]").click();
        await expect.poll(lanes).toEqual(["INTAKE", "SORT", "LOAD", "LANE 4"]);
        await expect(pending).toHaveText(" · 1 pending");
        await expect(card.locator("[data-tone]")).toHaveText("Pending");
        // The history keys, heard in the canvas: a press on a state focuses it.
        await root.locator("[data-flowchart-node='ARV']").click();
        await page.keyboard.press("Control+z");
        await expect.poll(lanes).toEqual(["INTAKE", "SORT", "LOAD"]);
        await page.keyboard.press("Control+Shift+z");
        await expect.poll(lanes).toEqual(["INTAKE", "SORT", "LOAD", "LANE 4"]);
        // Save, the history item's last button: one patch through the record's patch mutation, read back.
        const commit = root.locator("[data-toolbar-item='history'] [data-slot='history'] button").last();
        await expect(commit).toBeEnabled();
        await commit.click();
        await expect(pending).toHaveText(" · 0 pending");
        await expect(card.locator("[data-tone]")).toHaveCount(0);
        await expect(commit).toBeDisabled();
        await expect(root.locator("[role='alert']")).toHaveCount(0);
        await expect.poll(lanes).toEqual(["INTAKE", "SORT", "LOAD", "LANE 4"]);
    });

    test("a new flow named in its popover — a name the record holds refused there — opens with its one lane, placed and Pending, and the history item's commit writes it to the record", async ({ page }) => {
        const root = await openFlows(page);
        await sizeTo(page, root, 1200);
        const card = (name: string) => root.locator(`[data-frame-slot='start'] [data-library-item="${name}"]`);
        const placed = (name: string) => card(name).evaluate((el) => el.hasAttribute("data-placed"));
        const tab = root.locator("[data-frame-slot='start'] [role='tab']");
        await expect(card("Returns")).toBeVisible();

        // Named in the popover hanging from the button: a name the record holds is refused there, with the reason.
        await root.locator("[data-flowchart-new-flow]").click();
        const popover = page.getByRole("dialog");
        const field = popover.getByRole("textbox", { name: "Flow name" });
        const create = popover.getByRole("button", { name: "Create flow" });
        await field.fill("Returns");
        await expect(popover.getByText("Returns is already a flow here.")).toBeVisible();
        await expect(create).toBeDisabled();
        await field.fill("Night shift");
        await create.click();
        await expect(popover).toHaveCount(0);

        // Open on the canvas with its one lane, its card placed and Pending, the tab counting it.
        await expect.poll(() => root.locator("[data-flowchart-lane]").allTextContents()).toEqual(["LANE 1"]);
        await expect(root.locator("[data-flowchart-node]")).toHaveCount(0);
        await expect.poll(() => placed("Night shift")).toBe(true);
        await expect(card("Night shift").locator("[data-tone]")).toHaveText("Pending");
        await expect(tab).toHaveText("Flows 3");

        // The history item's commit, its last button: one patch through the record's patch mutation.
        const commit = root.locator("[data-toolbar-item='history'] [data-slot='history'] button").last();
        await expect(commit).toBeEnabled();
        await commit.click();
        // e3 commits it, and the record reads it back holding the flow: the drafts retire, and with them Pending.
        await expect(card("Night shift").locator("[data-tone]")).toHaveCount(0);
        await expect(commit).toBeDisabled();
        await expect(root.locator("[role='alert']")).toHaveCount(0);
        expect(await placed("Night shift")).toBe(true);
        await expect(tab).toHaveText("Flows 3");
        await expect(root.locator("[data-flowchart-flow]")).toHaveText("Night shift");
        await expect.poll(() => root.locator("[data-flowchart-lane]").allTextContents()).toEqual(["LANE 1"]);
    });
});

test.describe("The Flowchart's Flows tab on a phone (#1246)", () => {
    test.skip(({ isMobile }) => !isMobile, "the phone projects");

    for (const theme of ["light", "dark"] as const) {
        test(`opened from its rail over main: the cards over the foot, the foot along the pane's bottom, "+ New flow" a 44px tap target by its halo, whole inside the foot (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            // Collapsed, the pane is its rail: its icon, the Flows tab's count and its name.
            await expect.poll(() => root.locator("[data-frame-slot='start'] [title='Library']")
                .evaluate((rail) => [...rail.children].map((part) => part.textContent))).toEqual(["", "2", "Library"]);
            await root.getByRole("button", { name: "Expand Library" }).click();
            await settled(page);
            await expect.poll(async () => { const read = await flowsTabOf(root); return [read.mode, read.sheet]; }).toEqual(["overlay", PANE]);
            // On a coarse pointer the foot is as tall as the button's halo and its rule.
            expectFlowsTab(await flowsTabOf(root), 45);
            // A tap 21px above or below its middle, or 2px inside either end, lands on it.
            const lands = await root.locator("[data-flowchart-new-flow]").evaluate((button) => {
                const b = button.getBoundingClientRect();
                const x = b.left + b.width / 2;
                const y = b.top + b.height / 2;
                return ([[x, y - 21], [x, y + 21], [b.left + 2, y], [b.right - 2, y]] as const).map(([px, py]) => {
                    const hit = document.elementFromPoint(px, py);
                    return hit !== null && button.contains(hit);
                });
            });
            expect(lands).toEqual([true, true, true, true]);
        });
    }

    for (const theme of ["light", "dark"] as const) {
        test(`over the record the row holds every item — LR · TD's chip, find state's icon and the history item whole — in its 44px band, nothing past its edge (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            const bar = await toolbarOf(root);
            expect([bar.band, bar.rows, bar.past, bar.ladder]).toEqual([44, 1, [], LADDER]);
            expect(bar.state).toBe("seek=1/2;orientation=1/2;history=0/2");
        });

        test(`each lane's × — Font Awesome's xmark beside its header — is a 44px tap target by its halo, and the drawing holds no glyph as text (${theme})`, async ({ page }) => {
            const root = await openFlows(page, theme);
            const read = await gesturesOf(root);
            expect(read.lanes.map((l) => [l.key, l.icon, l.size])).toEqual([
                ["intake", "fas xmark", [14, 14, 10]], ["sort", "fas xmark", [14, 14, 10]], ["load", "fas xmark", [14, 14, 10]],
            ]);
            expect([read.add.icon, read.glyphs]).toEqual(["fas plus", []]);
            // A tap 21px above, below or to either side of the first ×'s middle lands on it.
            const lands = await root.locator("[data-flowchart-lane-delete='intake']").evaluate((close) => {
                const b = close.getBoundingClientRect();
                const x = b.left + b.width / 2;
                const y = b.top + b.height / 2;
                return ([[x, y - 21], [x, y + 21], [x - 21, y], [x + 21, y]] as const).map(([px, py]) => {
                    const hit = document.elementFromPoint(px, py);
                    return hit !== null && close.contains(hit);
                });
            });
            expect(lands).toEqual([true, true, true, true]);
        });
    }
});
