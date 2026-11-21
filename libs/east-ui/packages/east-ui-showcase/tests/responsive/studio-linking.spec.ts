/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Linking two visuals in the Studio's builder (#1673, LNK-3 to LNK-7),
 * measured in a real browser over the showcase's builder of a page of
 * content — a note, revenue by region as columns and the regions as a list
 * over the sales, a developer's KPI rail, and refunds by reason as bars and
 * the items returned over the returns:
 *
 *  - K1 what the builder does to a selected visual stands on its tile's
 *    frame, in one row with its Edit, Duplicate and Remove — its menu a
 *    reader's, Show rows and Export CSV — and its Link on the canvas puts the
 *    canvas in pick mode: a
 *    banner in the builder frame's banners slot, under its toolbar and inside
 *    the slot, as every builder's banners stand — never over the toolbar —
 *    saying what to do; each visual that can lead — the list, and the bars
 *    over the other source — outlined dashed `--brand-d` on `--brand-tint`
 *    with a pointer's hand; the visual being linked as it was; every other
 *    placement dimmed.
 *  - K2 Esc leaves the mode, nothing linked.
 *  - K3 a click on the leader links: the mode is left, the canvas's selection
 *    is still the follower, its tile's eyebrow says whom it follows, and the
 *    leader's how many follow it.
 *  - K4 the Configure tab's Follows block then shows the leader, the match —
 *    two boxes sharing the row, 32px, an equals sign between — what it shows
 *    with nothing selected, and Stop following, all inside the tab's width;
 *    Stop following takes the link off, tile and block alike.
 *  - K5 a leader's frame's Add a linked visual places a new chart in a row of
 *    its own after the leader's row, at the row's start, selected, its
 *    eyebrow saying it follows; one Undo takes it back.
 *
 * Every measurement is taken from the laid-out page.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test studio-linking --project desktop`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { settled } from "./settle";

/** The showcase's builder over a page of content, whose visuals read two sources. */
const HASH = "e3/studio/studio/studioContent";
/** The columns, which follow; the list, whose click selects. */
const FOLLOWER = "s-revenue";
const LEADER = "s-top";

/** Opens the builder, its visuals drawn, at rest. */
async function openBuilder(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/?theme=light#${HASH}`);
    await page.waitForSelector("header", { timeout: 20_000 });
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${HASH}"]`) });
    await entry.scrollIntoViewIfNeeded();
    await expect(entry.locator(`[data-snap-grid-tile="${FOLLOWER}"] [data-studio-chart]`).first()).toBeVisible({ timeout: 30_000 });
    await expect(entry.locator(`[data-snap-grid-tile="${LEADER}"] [data-studio-list-row]`).first()).toBeVisible({ timeout: 30_000 });
    await settled(page);
    return entry;
}

/** Selects a placement's tile, as a pointer does: a press on its eyebrow. */
async function selectTile(entry: Locator, key: string) {
    await entry.locator(`[data-snap-grid-tile="${key}"] [data-studio-visual-head]`).click();
    await expect(entry.locator(`[data-snap-grid-tile="${key}"]`)).toHaveAttribute("data-selected", "");
}

/** Starts linking the columns from their tile's frame: selected, then its Link on the canvas. */
async function startLinking(page: Page, entry: Locator) {
    await selectTile(entry, FOLLOWER);
    await entry.locator(`[data-snap-grid-tile="${FOLLOWER}"]`).getByRole("button", { name: "Link on the canvas" }).click();
    await expect(entry.locator("[data-studio-canvas]")).toHaveAttribute("data-linking", "");
    await settled(page);
}

/** Each tile of the canvas, as pick mode draws it. */
const tiles = (entry: Locator) => entry.locator("[data-snap-grid-tile]").evaluateAll((els) => els.map((el) => {
    const style = getComputedStyle(el);
    return {
        key: el.getAttribute("data-snap-grid-tile"), pick: el.querySelector("[data-pick]")?.getAttribute("data-pick") ?? null,
        opacity: style.opacity, outline: style.outlineStyle, cursor: style.cursor,
    };
}));

test.describe("Linking two visuals on the Studio's canvas (#1673)", () => {
    test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, "read once, at the desktop width");

    test("K1, K2: the builder's actions on a visual stand on its tile's frame, its menu a reader's; Link puts the canvas in pick mode — a banner in the frame's banners slot under its toolbar, the leader outlined dashed on the tint with a pointer's hand, the rest dimmed — and Esc leaves it", async ({ page }) => {
        const entry = await openBuilder(page);
        const paper = await entry.locator(`[data-snap-grid-tile="${LEADER}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
        // What the builder does to a visual stands on its tile's frame, in one row with its Edit, Duplicate and Remove; its
        // menu is a reader's, as on a page (#1673).
        await selectTile(entry, FOLLOWER);
        const bar = await entry.locator(`[data-snap-grid-tile="${FOLLOWER}"] [data-snap-grid-tile-bar]`).evaluate((el) => {
            const buttons = [...el.querySelectorAll("button")];
            return { names: buttons.map((b) => b.getAttribute("aria-label")), oneRow: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size === 1 };
        });
        expect(bar).toEqual({ names: ["Edit", "Link on the canvas", "Add a linked visual", "Duplicate", "Remove from page"], oneRow: true });
        await entry.locator(`[data-snap-grid-tile="${FOLLOWER}"]`).getByRole("button", { name: "Visual menu" }).click();
        await expect(page.getByRole("menuitem")).toHaveText(["Show rows", "Export CSV"]);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menuitem")).toHaveCount(0);
        await startLinking(page, entry);
        const banner = await entry.locator("[data-studio-linking]").evaluate((el) => {
            const box = el.getBoundingClientRect();
            const slot = el.closest("[data-frame-slot=banners]");
            const toolbar = el.closest("[data-builder-frame]")?.querySelector(":scope > [data-frame-slot=toolbar]")?.getBoundingClientRect();
            const room = slot?.getBoundingClientRect();
            return {
                text: el.textContent, inSlot: slot !== null, under: toolbar !== undefined && box.top >= toolbar.bottom - 0.5,
                inside: room !== undefined && box.left >= room.left - 0.5 && box.right <= room.right + 0.5,
            };
        });
        expect(banner.text).toContain("Click the visual Revenue by region should follow");
        expect(banner.text).toContain("The outlined visuals can lead. Esc cancels.");
        // In the frame's banners slot, under its toolbar and inside the slot, as every builder's banners stand.
        expect([banner.inSlot, banner.under, banner.inside]).toEqual([true, true, true]);
        // Once the dimmed ones have faded: the note, the developer's component and the KPI, none of which can lead; the
        // bars over the returns can, as the list over the sales can.
        await expect.poll(async () => (await tiles(entry)).map((tile) => [tile.key, tile.pick, tile.opacity])).toEqual([
            ["s-note", null, "0.4"], [FOLLOWER, "follower", "1"], [LEADER, "leader", "1"], ["s-kpi", null, "0.4"],
            ["s-reasons", "leader", "1"], ["s-returned", null, "0.4"],
        ]);
        const leader = (await tiles(entry)).find((tile) => tile.key === LEADER)!;
        expect([leader.outline, leader.cursor]).toEqual(["dashed", "pointer"]);
        expect(await entry.locator(`[data-snap-grid-tile="${LEADER}"]`).evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(paper);

        await page.keyboard.press("Escape");
        await expect(entry.locator("[data-studio-canvas]")).not.toHaveAttribute("data-linking", "");
        await settled(page);
        expect(await entry.locator("[data-studio-linking]").count()).toBe(0);
        // Every tile as it was, once the dimmed ones have come back.
        await expect.poll(async () => (await tiles(entry)).map((tile) => [tile.pick, tile.opacity])).toEqual([
            [null, "1"], [null, "1"], [null, "1"], [null, "1"], [null, "1"], [null, "1"],
        ]);
        expect(await entry.locator(`[data-snap-grid-tile="${FOLLOWER}"] [data-studio-visual-follow]`).count()).toBe(0);
    });

    test("K3, K4: a click on the leader links — the follower still selected, its eyebrow saying what it follows — and the Follows block shows the leader, the match, what it shows with nothing selected and Stop following, inside the tab", async ({ page }) => {
        const entry = await openBuilder(page);
        await startLinking(page, entry);
        await entry.locator(`[data-snap-grid-tile="${LEADER}"]`).click({ position: { x: 20, y: 60 } });
        await expect(entry.locator("[data-studio-canvas]")).not.toHaveAttribute("data-linking", "");
        await settled(page);
        const follow = entry.locator(`[data-snap-grid-tile="${FOLLOWER}"] [data-studio-visual-follow]`);
        // On the canvas a follower names its leader, and the leader says how many follow it.
        await expect(follow).toHaveText("follows Regions");
        await expect(entry.locator(`[data-snap-grid-tile="${LEADER}"] [data-studio-visual-leads]`)).toHaveText("leads 1");
        // The canvas's selection is the follower's still: the inspector, opened from its rail, shows its Configure tab.
        const expand = entry.getByRole("button", { name: "Expand Inspector" });
        if (await expand.count() > 0) await expand.click();
        const tab = entry.locator("[data-studio-configure]");
        await expect(tab.locator("[data-configure=fields] [data-field-row]").first()).toBeVisible({ timeout: 20_000 });
        const section = tab.locator("[data-configure-section=follows]");
        await section.scrollIntoViewIfNeeded();
        await settled(page);
        const read = await section.evaluate((el) => {
            const box = (selector: string) => {
                const found = el.querySelector(selector)!.getBoundingClientRect();
                return { x: found.left - el.getBoundingClientRect().left, w: found.width, h: found.height, right: found.right };
            };
            const [leader, from, to, seg, stop] = ["[data-configure-follows]", "[data-configure-match-from]", "[data-configure-match-to]", "[data-seg-strip]", "[data-configure-stop-following]"].map(box);
            return {
                words: [el.querySelector("[data-configure-follows]")!.textContent, el.querySelector("[data-configure-match-from]")!.textContent, el.querySelector("[data-configure-match-to]")!.textContent],
                heights: [leader!.h, from!.h, to!.h, seg!.h],
                // The match's two boxes share the row evenly, an equals sign between them.
                even: Math.abs(from!.w - to!.w) <= 0.5, row: from!.x === leader!.x && Math.abs(to!.right - leader!.right) <= 0.5, equals: el.querySelector("[data-configure-match]")!.textContent!.includes("="),
                stop: [stop!.x === leader!.x, stop!.w < leader!.w],
                fits: el.scrollWidth <= el.clientWidth,
                hints: [...el.querySelectorAll("[data-configure-hint]")].map((hint) => hint.textContent),
                changed: [...el.querySelectorAll("[data-changed]")].length,
            };
        });
        expect(read.words).toEqual(["Regions", "Region", "Region"]);
        expect(read.heights).toEqual([32, 32, 32, 24]);
        expect([read.even, read.row, read.equals, read.stop, read.fits]).toEqual([true, true, true, [true, true], true]);
        expect(read.hints).toEqual(["Sales' Region against Sales' Region."]);
        // The link is an edit not yet saved: each of its fields is tinted.
        expect(read.changed).toBe(3);

        await section.locator("[data-configure-stop-following]").click();
        await settled(page);
        expect(await follow.count()).toBe(0);
        expect(await section.locator("[data-configure-follows]").textContent()).toBe("Nothing");
        expect(await section.locator("[data-configure-match]").count()).toBe(0);
    });
    test("K5: Add a linked visual places a new chart in a row of its own after its leader's, selected and following; one Undo takes it back", async ({ page }) => {
        const entry = await openBuilder(page);
        /** The canvas's rows: each its tiles' keys, in order. */
        const rows = () => entry.locator("[data-snap-grid-rows] [data-snap-grid-row]").evaluateAll((els) => els.map((row) => [...row.querySelectorAll(":scope > [data-snap-grid-tile]")].map((tile) => tile.getAttribute("data-snap-grid-tile"))));
        const before = await rows();
        const at = before.findIndex((row) => row.includes(LEADER));
        await selectTile(entry, LEADER);
        await entry.locator(`[data-snap-grid-tile="${LEADER}"]`).getByRole("button", { name: "Add a linked visual" }).click();
        await expect.poll(async () => (await rows()).length).toBe(before.length + 1);
        await settled(page);
        const after = await rows();
        // A row of its own, right after the leader's row; every other row as it was.
        expect(after[at + 1]).toHaveLength(1);
        expect([...after.slice(0, at + 1), ...after.slice(at + 2)]).toEqual(before);
        const added = entry.locator(`[data-snap-grid-tile="${after[at + 1]![0]}"]`);
        await expect(added).toHaveAttribute("data-selected", "");
        await expect(added.locator("[data-studio-visual-follow]")).toHaveText("follows Regions");
        // Its tile stands at its row's start, a whole number of pixels tall and wide.
        const box = await added.evaluate((el) => {
            const tile = el.getBoundingClientRect();
            return { left: tile.left - el.parentElement!.getBoundingClientRect().left, height: tile.height, width: tile.width };
        });
        expect([box.left, Number.isInteger(box.height), Number.isInteger(box.width), box.width > 0]).toEqual([0, true, true, true]);

        // One gesture of the page's session: its history's Undo takes it back.
        await entry.getByRole("button", { name: "Undo" }).click();
        await expect.poll(rows).toEqual(before);
    });
});
