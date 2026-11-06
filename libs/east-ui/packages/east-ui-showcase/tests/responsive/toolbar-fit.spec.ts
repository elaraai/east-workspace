/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Every builder's toolbar row holds what it shows, at every width (hand
 * retest, 27 Oct 2026): each item inside the row's content box, never past
 * its edge, and the history item — Undo, Redo, Discard and Save — in the row
 * and taking the pointer at each control's centre. At a phone's width the
 * Roster's and the Allocation's optimiser examples ran their row past its end,
 * Save beyond it, and every builder with a rail and a key search ran Save a few
 * px into the edge at 360: the ladder had no step left, and the row clipped at
 * its end. Below the ladder's last rung the row takes its floor
 * (`toolbar/fold.ts`' `FLOOR_RANK`): the rail's icon drops its caret, and only
 * where that is not enough does the Elara eye give its room — never leaving
 * the toolbar (ruled 27 Oct 2026, "Into the View menu").
 *
 * In a phone's frame — 560px or narrower (`Mobile Builder Frame Spec.md`, ruled
 * 3 Nov 2026) — the history is the toolbar's second row, and the Elara eye
 * before it: held there the same way, each item inside the row and each of
 * Undo, Redo, Discard and Save taking the pointer at its centre.
 *
 * Measured at the page's widths — 1440, 1024, 768, 390 and 360, where the
 * showcase's own chrome takes its share — and in a 294px parent, in both
 * themes, over each builder's example and each optimiser example. One test an
 * area (#1397): its examples share a workspace, which the page makes once.
 *
 * The eye of the Roster's and the Allocation's optimiser examples, whose View
 * bundles the period's controls on a phone, is a button in the first row while
 * the frame is wider than a phone's; in a phone's frame of 312px or more a
 * button in the second row before the history, never the View's entry; and in
 * a narrower one — a 360px page's 294px frame — the first row's again (ruled
 * 3 Nov 2026), a button there or, where the floor takes its room, the View's
 * entry. Wherever it is: named as the eye is, a run from it — the loading line
 * saying so — the eye then its Stop, and Stop from it ending the run with
 * nothing recorded; the history and Save in their row throughout.
 *
 * Run: `pnpm exec playwright test toolbar-fit`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { escapeLayer, settled } from "./settle";
import { LAYOUT_THEMES } from "./themes";

/** An area's builder examples, by their showcase routes: the builder's own, and its optimiser's where it has one. */
const AREAS: readonly { readonly name: string; readonly routes: readonly string[] }[] = [
    { name: "Sheet", routes: ["e3/sheet/sheet-records/sheetRecordIndexes", "e3/sheet/optimise/sheetOptimise"] },
    { name: "Plan", routes: ["e3/plan/plan-records/planRecordIndexes", "e3/plan/optimise/planOptimise"] },
    { name: "Roster", routes: ["e3/roster/roster/rosterWarehouse", "e3/roster/optimise/rosterOptimise"] },
    { name: "Calendar", routes: ["e3/calendar/calendar/calendarOperations", "e3/calendar/optimise/calendarOptimise"] },
    { name: "Allocation", routes: ["e3/allocation/allocation/allocationKilnYard", "e3/allocation/optimise/allocationOptimise"] },
    { name: "Flowchart", routes: ["e3/flowchart/flowchart/flowchartDepot"] },
    { name: "Studio", routes: ["e3/studio/studio/studioBuilder"] },
    { name: "Query", routes: ["e3/query/query/queryBuilder"] },
    { name: "Schematic", routes: ["e3/schematic/schematic/schematicDataCentre"] },
];

/** The page's widths, widest first. */
const WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** The parent the narrowest frame sits in: a 360px page's frame once the showcase's chrome has its share. */
const PARENT = 294;

/** Every builder renders in its frame. */
const ROOT = "[data-builder-frame]";

/**
 * What is wrong with the toolbar row of an entry's builder: an item past the row's content box, the history item gone
 * from the row where it showed, or one of its controls that does not take the pointer at its centre.
 *
 * @param entry - The example's entry
 * @param history - Whether the history item showed at the widest width: it must stay in the row at every width
 * @returns Each fault, in words; none when the row holds
 */
function rowFaults(entry: Locator, history: boolean): Promise<string[]> {
    return entry.locator(ROOT).first().evaluate((frame, wanted) => {
        const row = frame.querySelector<HTMLElement>("[data-frame-slot='toolbar'] [data-toolbar]");
        if (row === null) return ["no toolbar row"];
        row.scrollIntoView({ block: "center", inline: "nearest" });
        const faults: string[] = [];
        /** Each of a row's items — the given children of it — past its content box. */
        const inside = (box: HTMLElement, items: Iterable<Element>, name: string) => {
            const r = box.getBoundingClientRect();
            const style = getComputedStyle(box);
            const left = r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
            const right = r.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
            for (const item of items) {
                const b = item.getBoundingClientRect();
                if (b.width === 0) continue;
                const key = item.getAttribute("data-toolbar-item") ?? item.getAttribute("aria-label") ?? item.tagName.toLowerCase();
                if (b.right > right + 0.5) faults.push(`${key} runs ${(b.right - right).toFixed(1)}px past the ${name}'s end`);
                if (b.left < left - 0.5) faults.push(`${key} starts ${(left - b.left).toFixed(1)}px before the ${name}'s start`);
            }
        };
        inside(row, row.querySelectorAll(":scope > [data-toolbar-item]"), "row");
        // A phone's frame: the history is the second row's, never the first's.
        const phone = frame.hasAttribute("data-phone");
        const second = frame.querySelector<HTMLElement>(":scope > [data-frame-slot='sessionRow']");
        if (phone && second !== null) inside(second, second.querySelectorAll("button"), "second row");
        if (phone && row.querySelector(":scope > [data-toolbar-item='history']") !== null) faults.push("the history item is in a phone's first row");
        const item = phone
            ? second?.querySelector<HTMLElement>("[data-slot='history'][data-history-form='phone']") ?? null
            : row.querySelector<HTMLElement>(":scope > [data-toolbar-item='history']");
        if (item === null) {
            if (wanted) faults.push(phone ? "the history left a phone's second row" : "the history item left the row");
            return faults;
        }
        const names = ["Undo", "Redo", "Discard", "Save"];
        for (const name of names) {
            const button = item.querySelector<HTMLElement>(`button[aria-label='${name}']`);
            if (button === null) { faults.push(`no ${name} in the history item`); continue; }
            const b = button.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            if (hit === null || !button.contains(hit)) faults.push(`${name} does not take the pointer at its centre (${hit?.tagName.toLowerCase() ?? "nothing"} there)`);
        }
        return faults;
    }, history);
}

/** Whether an entry's builder shows a history item now: in the first row, or a phone's second. */
function hasHistory(entry: Locator): Promise<boolean> {
    return entry.locator(ROOT).first().evaluate((frame) => frame.querySelector("[data-frame-slot='toolbar'] [data-toolbar] > [data-toolbar-item='history']") !== null
        || frame.querySelector("[data-frame-slot='sessionRow'] [data-slot='history']") !== null);
}

/** Lets the builder's box take the page's width again, after a spec sized it. */
async function unsizeBuilder(page: Page, entry: Locator): Promise<void> {
    await entry.locator(ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.width = ""; });
    await settled(page);
}

/**
 * The optimiser examples whose builder's View — the chip that bundles the period's controls on a phone — took the Elara
 * eye as its entry where the row's floor needed the eye's room (ruled 27 Oct 2026, "Into the View menu"); in a phone's
 * frame the eye is the second row's, before the history (ruled 3 Nov 2026).
 */
const VIEW_EYES: readonly { readonly name: string; readonly route: string }[] = [
    { name: "Roster", route: "e3/roster/optimise/rosterOptimise" },
    { name: "Allocation", route: "e3/allocation/optimise/allocationOptimise" },
];

/** The page's widths the eye is checked at, widest first. */
const EYE_WIDTHS = [1440, 1024, 768, 390, 360] as const;

/** The narrowest frame whose second row takes the eye (east-ui-components' `EYE_SECOND_ROW_FROM`). */
const EYE_SECOND_ROW_FROM = 312;

/**
 * What is wrong with the eye in an entry's toolbar row, where it is a button there: no eye in the row, or one past the
 * row's content box.
 *
 * @param entry - The example's entry
 * @returns Each fault, in words; none when the eye is a button in the row
 */
function eyeInRowFaults(entry: Locator): Promise<string[]> {
    return entry.locator(ROOT).first().evaluate((frame) => {
        const row = frame.querySelector<HTMLElement>("[data-frame-slot='toolbar'] [data-toolbar]");
        if (row === null) return ["no toolbar row"];
        const eye = row.querySelector<HTMLElement>(":scope > [data-toolbar-item='optimise'] [data-optimise-button]");
        if (eye === null) return ["the eye is no button in the row"];
        const r = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const b = eye.getBoundingClientRect();
        const inside = b.left >= r.left + parseFloat(style.paddingLeft) - 0.5 && b.right <= r.right - parseFloat(style.paddingRight) + 0.5;
        return b.width > 0 && inside ? [] : ["the eye's button is outside the row's content box"];
    });
}

/**
 * The eye in a phone's frame: no button of it in the first row and no entry of it in the View, a button in the second
 * row before Issues, the history and Save in that row taking the pointer; named as the eye was; a run from it — its
 * call held on its way to e3, so the run stays out while the checks look — the loading line at the row's start saying
 * so and the eye its Stop; and Stop from it, the run over, the eye named for the period again, and nothing recorded.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param named - What the eye was named at the widest width: `Optimise W10`
 * @param at - Where the check is, for its messages
 */
async function checkPhoneEye(page: Page, entry: Locator, named: string, at: string): Promise<void> {
    const frame = entry.locator(ROOT).first();
    await expect(frame, `${at}: a phone's frame`).toHaveAttribute("data-phone", "");
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    const second = frame.locator("[data-frame-slot='sessionRow']");
    expect(await rowFaults(entry, true), at).toEqual([]);
    await expect(toolbar.locator("[data-optimise-button]"), `${at}: the eye is no button of the first row`).toHaveCount(0);
    // Where the first row shows its View, the View lists no eye.
    const viewChip = toolbar.getByRole("button", { name: "View", exact: true });
    if (await viewChip.count() > 0) {
        await viewChip.click();
        await expect(page.getByRole("dialog").locator("[data-optimise-entry]"), `${at}: the View lists no eye`).toHaveCount(0);
        await escapeLayer(page);
        await expect(page.getByRole("dialog"), `${at}: the View closed`).toHaveCount(0);
    }
    const eye = second.locator("[data-optimise-button]");
    await expect(eye, `${at}: the eye is the second row's`).toBeVisible();
    await expect(eye, at).toBeEnabled();
    await expect(eye, at).toHaveAccessibleName(named);
    // Before the history's Issues, in the row's order.
    const before = await second.evaluate((row) => {
        const eyeAt = row.querySelector("[data-optimise-button]")!.getBoundingClientRect().left;
        const issues = row.querySelector("[data-slot='history'] button")!.getBoundingClientRect().left;
        return eyeAt < issues;
    });
    expect(before, `${at}: the eye before Issues`).toBe(true);
    const hold = await holdE3(page, { kinds: ["call"] });
    await eye.click();
    const line = second.locator("[data-footer-line]");
    await expect(line, `${at}: the row's line says the run`).toHaveAttribute("data-loading-line", "busy");
    await expect(line.locator("[data-line-text]"), at).toHaveText(/^Optimising /);
    await expect(eye, `${at}: the eye is the run's Stop`).toHaveAccessibleName("Stop optimising");
    await eye.click();
    await expect(eye, `${at}: Stop ended the run`).toHaveAccessibleName(named);
    await expect(line, at).not.toHaveAttribute("data-loading-line", "busy");
    await releaseE3(page, hold);
    await settled(page);
    // A late answer is ignored: nothing landed, and the rows hold what they show still.
    await expect(frame.locator("[data-optimise-banner]"), at).toHaveCount(0);
    expect(await rowFaults(entry, true), at).toEqual([]);
}

/**
 * The entry as the page lays it out and paints it, once the View has finished opening — its scale-in done, so a box is
 * its laid-out size: whole inside the View's box, its mark the eye's at 14px, and the mark's colours — its ring and its
 * iris — beside the `elara` tokens' as the page resolves them in the theme.
 *
 * @param eye - The entry
 * @returns What it measures
 */
function entryLook(eye: Locator) {
    return eye.evaluate(async (el) => {
        const dialog = el.closest("[role='dialog']")!;
        const opening = dialog.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity);
        await Promise.all(opening.map((a) => a.finished.then(() => undefined, () => undefined)));
        const view = dialog.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        const mark = el.querySelector("[data-eye]")!.getBoundingClientRect();
        const token = (name: string) => {
            const probe = document.createElement("span");
            probe.style.color = `var(--chakra-colors-${name})`;
            document.body.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
        };
        return {
            inside: b.left >= view.left - 0.5 && b.right <= view.right + 0.5 && b.width > 0,
            mark: [mark.width, mark.height],
            ring: getComputedStyle(el.querySelector("[data-eye-ring]")!).fill,
            iris: getComputedStyle(el.querySelector("[data-eye-iris]")!).fill,
            elaraInk: token("elara-ink"),
            elara: token("elara"),
        };
    });
}

/**
 * The eye where the row's floor has taken its room: no button of it in the row, the history and Save in it taking the
 * pointer; the View's entry, named as the eye was, whole in the View, its mark the eye's; a run from it — its call held
 * on its way to e3, so the run stays out while the checks look — the footer's line saying so and the entry its Stop, its
 * mark in the eye's running colours; and Stop from it, the run over, the entry named for the period again, and nothing
 * recorded.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param named - What the eye was named at the widest width: `Optimise W10`
 * @param at - Where the check is, for its messages
 */
async function checkViewEye(page: Page, entry: Locator, named: string, at: string): Promise<void> {
    const frame = entry.locator(ROOT).first();
    const toolbar = frame.locator("[data-frame-slot='toolbar']");
    expect(await rowFaults(entry, true), at).toEqual([]);
    await expect(toolbar.locator("[data-optimise-button]"), `${at}: the eye is no button in the row`).toHaveCount(0);
    await toolbar.getByRole("button", { name: "View", exact: true }).click();
    const view = page.getByRole("dialog");
    const eye = view.locator("[data-optimise-entry]");
    await expect(eye, `${at}: the View lists the eye`).toBeVisible();
    await expect(eye, at).toBeEnabled();
    await expect(eye, at).toHaveAccessibleName(named);
    await expect(eye, at).toHaveText(named);
    const rest = await entryLook(eye);
    expect([rest.inside, rest.mark], `${at}: the entry whole in the View, its mark 14px`).toEqual([true, [14, 14]]);
    const hold = await holdE3(page, { kinds: ["call"] });
    await eye.click();
    // The loading line: a phone's is the second row's start, else the footer's.
    const line = frame.locator("[data-frame-slot='sessionRow'] [data-footer-line], [data-frame-slot='footer'] [data-footer-line]").first();
    await expect(line, `${at}: the loading line says the run`).toHaveAttribute("data-loading-line", "busy");
    await expect(line.locator("[data-line-text]"), at).toHaveText(/^Optimising /);
    await expect(eye, `${at}: the entry is the run's Stop`).toHaveText("Stop optimising");
    await expect(eye, at).toHaveAccessibleName("Stop optimising");
    const running = await entryLook(eye);
    expect([running.ring, running.iris], `${at}: the running mark in the elara tokens`).toEqual([running.elaraInk, running.elara]);
    await eye.click();
    await expect(eye, `${at}: Stop ended the run`).toHaveText(named);
    await expect(line, at).not.toHaveAttribute("data-loading-line", "busy");
    await releaseE3(page, hold);
    await page.keyboard.press("Escape");
    await expect(view, `${at}: the View closed`).toHaveCount(0);
    await settled(page);
    // A late answer is ignored: nothing landed, and the row holds what it shows still.
    await expect(frame.locator("[data-optimise-banner]"), at).toHaveCount(0);
    expect(await rowFaults(entry, true), at).toEqual([]);
}

/**
 * The eye in a frame too narrow for the second row to take it: in the first row, a button there — a run and its Stop
 * from it — or, where the row's floor has taken its room, the View's entry ({@link checkViewEye}); never the second row's.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param named - What the eye was named at the widest width
 * @param at - Where the check is, for its messages
 */
async function checkNarrowEye(page: Page, entry: Locator, named: string, at: string): Promise<void> {
    const frame = entry.locator(ROOT).first();
    await expect(frame.locator("[data-frame-slot='sessionRow'] [data-optimise-button]"), `${at}: the eye is no button of the second row`).toHaveCount(0);
    const button = frame.locator("[data-frame-slot='toolbar'] [data-optimise-button]");
    if (await button.count() === 0) { await checkViewEye(page, entry, named, at); return; }
    expect(await eyeInRowFaults(entry), at).toEqual([]);
    expect(await rowFaults(entry, true), at).toEqual([]);
    await expect(button, at).toHaveAccessibleName(named);
    const hold = await holdE3(page, { kinds: ["call"] });
    await button.click();
    const line = frame.locator("[data-frame-slot='sessionRow'] [data-footer-line], [data-frame-slot='footer'] [data-footer-line]").first();
    await expect(line, `${at}: the loading line says the run`).toHaveAttribute("data-loading-line", "busy");
    await expect(button, `${at}: the eye is the run's Stop`).toHaveAccessibleName("Stop optimising");
    await button.click();
    await expect(button, `${at}: Stop ended the run`).toHaveAccessibleName(named);
    await releaseE3(page, hold);
    await settled(page);
    await expect(frame.locator("[data-optimise-banner]"), at).toHaveCount(0);
    expect(await rowFaults(entry, true), at).toEqual([]);
}

/**
 * The eye where the frame's width puts it: the first row's above a phone's frame, the second row's in a phone's of
 * 312px or more, and the first row's again below that.
 *
 * @param page - The page
 * @param entry - The example's entry
 * @param named - What the eye was named at the widest width
 * @param at - Where the check is, for its messages
 */
async function checkEye(page: Page, entry: Locator, named: string, at: string): Promise<void> {
    const { phone, width } = await entry.locator(ROOT).first().evaluate((frame) => ({ phone: frame.hasAttribute("data-phone"), width: frame.getBoundingClientRect().width }));
    if (!phone) {
        expect(await eyeInRowFaults(entry), at).toEqual([]);
        expect(await rowFaults(entry, true), at).toEqual([]);
    } else if (width >= EYE_SECOND_ROW_FROM) await checkPhoneEye(page, entry, named, at);
    else await checkNarrowEye(page, entry, named, at);
}

for (const theme of LAYOUT_THEMES) {
    for (const area of AREAS) {
        test(`${area.name}: the toolbar row holds what it shows, the history and Save in it and taking the pointer, at 1440 / 1024 / 768 / 390 / 360 and in a ${PARENT}px parent (${theme})`, async ({ page }) => {
            const faults: Record<string, string[]> = {};
            for (const [i, route] of area.routes.entries()) {
                await page.setViewportSize({ width: WIDTHS[0], height: 900 });
                const entry = await visitBuilder(page, route, ROOT, i === 0 ? theme : undefined);
                const history = await hasHistory(entry);
                for (const width of WIDTHS) {
                    await page.setViewportSize({ width, height: 900 });
                    await settled(page);
                    const found = await rowFaults(entry, history);
                    if (found.length > 0) faults[`${route} at ${width}px`] = found;
                }
                await page.setViewportSize({ width: WIDTHS[0], height: 900 });
                await sizeBuilder(page, entry, ROOT, PARENT);
                const found = await rowFaults(entry, history);
                if (found.length > 0) faults[`${route} in a ${PARENT}px parent`] = found;
                await unsizeBuilder(page, entry);
            }
            expect(faults).toEqual({});
        });
    }

    for (const eye of VIEW_EYES) {
        test(`${eye.name}: the Elara eye never leaves the toolbar — the first row's above a phone's frame, the second row's in a phone's of ${EYE_SECOND_ROW_FROM}px or more, the first row's again below — a run and its Stop from it, at 1440 / 1024 / 768 / 390 / 360 and in a ${PARENT}px parent (${theme})`, async ({ page }) => {
            await installE3Faults(page);
            await page.setViewportSize({ width: WIDTHS[0], height: 900 });
            const entry = await visitBuilder(page, eye.route, ROOT, theme);
            const button = entry.locator(ROOT).first().locator("[data-frame-slot='toolbar'] [data-optimise-button]");
            // The period read: the eye takes a run.
            await expect(button).toBeEnabled({ timeout: 30_000 });
            const named = (await button.getAttribute("aria-label")) ?? "";
            expect(named).toMatch(/^Optimise /);
            for (const width of EYE_WIDTHS) {
                await page.setViewportSize({ width, height: 900 });
                await settled(page);
                await checkEye(page, entry, named, `${width}px`);
            }
            await page.setViewportSize({ width: WIDTHS[0], height: 900 });
            await sizeBuilder(page, entry, ROOT, PARENT);
            await checkNarrowEye(page, entry, named, `a ${PARENT}px parent`);
            await unsizeBuilder(page, entry);
            expect(await eyeInRowFaults(entry), `${WIDTHS[0]}px again`).toEqual([]);
        });
    }
}
