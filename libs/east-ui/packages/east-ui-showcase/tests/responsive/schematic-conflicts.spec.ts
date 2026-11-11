/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A conflict's Go to on the Schematic in a real browser, on the real in-page
 * e3 (#1585): a rack moved sideways here, then Someone else saves, is one
 * conflict; its Go to, the conflicts popover open over the canvas — and staying
 * open, at full width — flies the camera so the rack lands beside the popover,
 * in the part of the view it leaves clear, where a flight that centred it would
 * land it under the popover. The popover says where it lies; the Schematic
 * reads none of it from the page.
 *
 * And the same conflict in a phone's frame, at 390, 324 and 294px: the
 * toolbar's second row keeps its five squares, each 44 × 44 and in the row,
 * Save at its end — the conflicts have no button of their own there, which
 * took the count's room and pushed Save past a narrow row's end. The row's
 * Issues square counts the conflict and is named for it, the drafts' count
 * shows its number whole, and a press opens the conflicts in the frame's
 * bottom panel; chosen and closed, the focus is back on the square and Save
 * saves.
 *
 * Every wait is a poll on the page's state, never a fixed pause.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test schematic-conflicts --project desktop`.
 */

import { test, expect, type Locator, type Page } from "playwright/test";
import { editingMessages } from "@elaraai/east-ui-components/testing";
import { FILE, card, centred, collapseInspector, openSchematic, save, screenPoint, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** The racks you edit, and Someone else saves, which moves every one half a metre to the right. */
const CONFLICTS = `${FILE}/schematicConflicts`;

/** A box on the screen, in client px. */
interface Box {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

/** Whether two boxes share any of their area. */
const overlap = (a: Box, b: Box): boolean => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/** An element's box on the screen. */
const boxOf = (locator: Locator): Promise<Box> => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});

/**
 * The conflicts example with one conflict waiting, in a box 720px wide — the inspector folded to its rail for lack of
 * room: B01 moved sideways, then Someone else saves.
 *
 * @param page - The page
 * @returns The Schematic's root
 */
async function oneConflict(page: Page): Promise<Locator> {
    await page.setViewportSize({ width: 1440, height: 900 });
    const root = await openSchematic(page, CONFLICTS);
    await sizeTo(page, root, 720);
    await centred(page, root);
    await collapseInspector(page, root);
    const canvas = root.locator("[data-schematic-canvas]");
    // B01 moved sideways — half a metre to the left, and down into the open floor below its row: its x is yours.
    await root.locator("[data-frame-slot='toolbar']").getByRole("radio", { name: "Move" }).click();
    await expect(canvas).toHaveAttribute("data-tool", "move");
    const from = await screenPoint(root, 2.4, 8.6);
    const to = await screenPoint(root, 1.9, 10.6);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await settled(page);
    // Someone else saves every rack half a metre to the right: theirs and yours differ on B01's x.
    const entry = page.locator("[data-index]", { has: page.locator(`a[href="#${CONFLICTS}"]`) });
    await entry.getByRole("button", { name: "Someone else saves" }).click();
    await expect(root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: editingMessages.conflicts({ n: 1, count: "1" }), exact: true })).toBeVisible();
    return root;
}

test("a conflict's Go to lands its rack beside the conflicts popover open over the canvas, never under it, the popover where it hangs (#1585) @desktop", async ({ page }) => {
    // A box 720px wide: the popover, hung from the toolbar's end, covers the canvas's middle.
    const root = await oneConflict(page);
    const canvas = root.locator("[data-schematic-canvas]");
    await root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "1 conflict" }).click();
    const body = page.locator("[data-conflicts-body]");
    await expect(body.locator("[data-conflict-card]")).toHaveCount(1);
    await settled(page);
    const popover = page.locator("[data-scope='popover'][data-part='content']", { has: body });
    // Centred, the rack would land under the popover: the canvas's middle is under it.
    const [view, over] = [await boxOf(canvas), await boxOf(popover)];
    const middle = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
    expect(middle.x > over.left && middle.x < over.right && middle.y > over.top && middle.y < over.bottom, "the canvas's middle under the popover").toBe(true);

    await body.getByRole("button", { name: "Go to" }).click();
    // The flight over: the camera still across two frames.
    await expect.poll(() => canvas.evaluate(async (el) => {
        const layer = el.querySelector<HTMLElement>("[style*='--cam-ppu']")!;
        const camera = () => ["--cam-ppu", "--cam-tx", "--cam-ty"].map((name) => layer.style.getPropertyValue(name)).join(" ");
        const before = camera();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        return camera() === before;
    }), { message: "the camera at rest" }).toBe(true);
    await settled(page);
    // The rack, drawn as its card at the zoom the flight landed at, selected, wearing the conflict's ring.
    const rack = card(root, "racks", "B01");
    await expect(rack).toHaveAttribute("data-selected", "");
    await expect(rack).toHaveAttribute("data-conflict", "");
    // Beside the popover, open still where it hangs from its button: it had no need to hang by the frame's other side.
    expect([await body.getAttribute("data-hung"), overlap(await boxOf(rack), await boxOf(popover))], "the rack beside the popover, which stays where it hangs")
        .toEqual([null, false]);
});

/** What of a word shows under what clips it: all of it, none of it, or a part. */
type Shown = "whole" | "gone" | "cut" | "absent";

/** A phone's second row as the page lays it out. */
interface PhoneRow {
    /** Whether the frame holds a button of the conflicts' own. */
    readonly own: boolean;
    /** The row's buttons as drawn, by name, in order. */
    readonly squares: string[];
    /** What the Issues square counts. */
    readonly counted: string;
    /** What shows of the drafts' count: its number, then its noun. */
    readonly count: readonly [number: Shown, noun: Shown];
    /** Each fault of the row's buttons, in words: one not 44 × 44, off the row's centre, past the row or under something, or the last short of the row's end. */
    readonly faults: string[];
}

/**
 * A phone's frame's second row — `undefined` where the frame is no phone's.
 *
 * @param root - The Schematic's root
 * @returns The row as the page lays it out
 */
function phoneRow(root: Locator): Promise<PhoneRow | undefined> {
    return root.locator("[data-builder-frame]").first().evaluate((frame): PhoneRow | undefined => {
        const row = frame.querySelector<HTMLElement>(":scope > [data-frame-slot='sessionRow']");
        if (!frame.hasAttribute("data-phone") || row === null) return undefined;
        // A point is hit only in view.
        row.scrollIntoView({ block: "center", behavior: "instant" });
        const round = (n: number) => Math.round(n * 10) / 10;
        const r = row.getBoundingClientRect();
        const buttons = [...row.querySelectorAll<HTMLElement>("button")].filter((button) => button.getBoundingClientRect().width > 0);
        const faults: string[] = [];
        for (const button of buttons) {
            const b = button.getBoundingClientRect();
            const name = button.getAttribute("aria-label") ?? "?";
            if (Math.abs(b.width - 44) > 0.5 || Math.abs(b.height - 44) > 0.5) faults.push(`${name} ${round(b.width)} × ${round(b.height)}`);
            if (Math.abs(b.top + b.height / 2 - (r.top + r.height / 2)) > 0.5) faults.push(`${name} off the row's centre`);
            if (b.left < r.left - 0.5 || b.right > r.right + 0.5) faults.push(`${name} past the row`);
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name} does not take the pointer`);
        }
        const last = buttons.at(-1);
        const end = r.right - Number.parseFloat(getComputedStyle(row).paddingRight);
        if (last === undefined) faults.push("no button in the row");
        else if (Math.abs(end - last.getBoundingClientRect().right) > 0.5) faults.push(`the row's last control ${round(end - last.getBoundingClientRect().right)}px from its end`);
        // A word under everything that clips it, up to the row.
        const shows = (word: Element | null | undefined): Shown => {
            if (word === null || word === undefined) return "absent";
            const text = word.getBoundingClientRect();
            let shown: Shown = "whole";
            for (let at = word.parentElement; at !== null && at !== row.parentElement; at = at.parentElement) {
                const look = getComputedStyle(at);
                if (look.overflowX === "visible" && look.overflowY === "visible") continue;
                const clip = at.getBoundingClientRect();
                if (text.right <= clip.left || text.left >= clip.right || text.bottom <= clip.top || text.top >= clip.bottom) return "gone";
                if (text.left < clip.left - 0.5 || text.right > clip.right + 0.5 || text.top < clip.top - 0.5 || text.bottom > clip.bottom + 0.5) shown = "cut";
            }
            return shown;
        };
        const chip = row.querySelector("[data-history-summary] [data-changes]");
        return {
            own: frame.querySelector("[data-conflicts]") !== null,
            squares: buttons.map((button) => button.getAttribute("aria-label") ?? "?"),
            counted: row.querySelector("[data-history-issues]")?.textContent ?? "",
            count: [shows(chip?.querySelector(":scope > span:not([data-changes-noun])")), shows(chip?.querySelector("[data-changes-noun]"))],
            faults,
        };
    });
}

test("in a phone's frame a waiting conflict adds no button to the second row: its squares at 44px, the last at the row's end, at 390, 324 and 294px, the Issues square counting the conflict and opening it in the bottom panel, the focus back on it once chosen and closed @desktop", async ({ page }) => {
    const root = await oneConflict(page);
    const m = editingMessages;
    const one = m.conflicts({ n: 1, count: "1" });
    const five = [one, m.undo(), m.redo(), m.discard(), m.apply()];
    const six = [...five, m.autosaveButton()];
    // Each width a phone's frame takes: its own box, as wide as a 390px phone gives it in a card, and the narrowest a
    // builder is held to. The first two hold Save's chevron beside the five — the count beside them at the first, and
    // giving way to them at the second (ruled 11 Nov 2026: the buttons themselves wherever they fit); the narrowest is
    // short of a sixth square, so More stands in Discard's place, and the count's number shows in the room the row
    // leaves, its noun gone.
    const rows: Record<number, PhoneRow | undefined> = {};
    for (const width of [390, 324, 294]) {
        await sizeTo(page, root, width);
        rows[width] = await phoneRow(root);
    }
    expect(rows).toEqual({
        390: { own: false, squares: six, counted: "1", count: ["whole", "whole"], faults: [] },
        324: { own: false, squares: six, counted: "1", count: ["gone", "gone"], faults: [] },
        294: { own: false, squares: [one, m.undo(), m.redo(), m.more(), m.apply()], counted: "1", count: ["whole", "gone"], faults: [] },
    });

    // A press on the square opens the conflicts in the frame's bottom panel, over the pane strip: the row as it was.
    await sizeTo(page, root, 324);
    const square = root.locator("[data-frame-slot='sessionRow'] button").first();
    await expect(square).toHaveAttribute("aria-label", one);
    await square.click();
    const panel = root.locator("[data-builder-frame] > [data-frame-slot='bottomPanel'] [data-frame-panel]");
    await expect(panel.locator("[data-conflict-card]")).toHaveCount(1);
    await expect(square).toHaveAttribute("aria-expanded", "true");
    await settled(page);
    expect(await phoneRow(root)).toEqual({ own: false, squares: six, counted: "1", count: ["gone", "gone"], faults: [] });
    // The example's frame is short — 440px, under the toolbar's two rows and the conflict's banner: the panel takes what
    // they leave, its cards scrolling, so its close, its actions and the pane strip stand in the frame, none past its foot.
    const kept = await root.locator("[data-builder-frame]").first().evaluate((frame, actions) => {
        const f = frame.getBoundingClientRect();
        const inside = (el: Element | null | undefined) => {
            const box = el?.getBoundingClientRect();
            return box !== undefined && box.height > 0 && box.top >= f.top - 0.5 && box.bottom <= f.bottom + 0.5;
        };
        const panel = frame.querySelector(":scope > [data-frame-slot='bottomPanel'] [data-frame-panel]")!;
        const body = panel.querySelector<HTMLElement>("[data-conflicts-body]")!.parentElement!;
        return {
            close: inside(panel.querySelector("[data-frame-panel-close]")),
            actions: actions.map((name) => inside([...panel.querySelectorAll("button")].find((button) => button.textContent === name))),
            strip: inside(frame.querySelector(":scope > [data-frame-slot='paneStrip']")),
            // What of the cards the panel has no room for is a scroll away, never cut.
            scrolls: body.scrollHeight <= body.clientHeight + 0.5 || getComputedStyle(body).overflowY === "auto",
        };
    }, [m.conflictsKeepAll(), m.conflictsTakeAll()]);
    expect(kept).toEqual({ close: true, actions: [true, true], strip: true, scrolls: true });
    // Save waits for the choice, and says so.
    await expect(save(root)).toHaveAttribute("aria-disabled", "true");

    // Yours kept: nothing waits, the square the conflicts' still while they show, named as their own button is then.
    await panel.getByRole("button", { name: m.conflictsKeepAll(), exact: true }).click();
    await expect(square).toHaveAttribute("aria-label", m.conflictsSettled({ n: 1, count: "1" }));
    await expect(save(root)).not.toHaveAttribute("aria-disabled", "true");
    // Closed, the square has nothing left to open — and holds the focus the panel gave back, never the page.
    await panel.locator("[data-frame-panel-close]").click();
    await expect(panel).toHaveCount(0);
    await expect(square).toBeFocused();
    await expect(square).toHaveAttribute("aria-label", m.issues({ n: 0, count: "0" }));
    await expect(square).toHaveAttribute("aria-disabled", "true");
    await settled(page);
    expect((await phoneRow(root))?.faults).toEqual([]);

    // And Save saves yours over theirs: nothing left to save.
    await save(root).click();
    await expect(root.locator("[data-frame-slot='sessionRow'] [data-history-summary]")).toHaveText(m.historyChanges({ n: 0, count: "0" }));
    await settled(page);
    expect((await phoneRow(root))?.squares).toEqual([m.issues({ n: 0, count: "0" }), m.undo(), m.redo(), m.discard(), m.apply(), m.autosaveButton()]);
});
