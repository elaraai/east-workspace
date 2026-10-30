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
 * Measured at the page's widths — 1440, 1024, 768, 390 and 360, where the
 * showcase's own chrome takes its share — and in a 294px parent, in both
 * themes, over each builder's example, each optimiser example and the
 * DecisionQueue's. One test an area (#1397): its examples share a workspace,
 * which the page makes once.
 *
 * The eye of the Roster's and the Allocation's optimiser examples, whose View
 * bundles the period's controls on a phone, is a button in the row at 390 and
 * wider, and at 360 and in a 294px parent the View's entry: named as the eye
 * is, a run from it — the footer's line saying so — the entry then its Stop,
 * and Stop from it ending the run with nothing recorded; the history and Save
 * in the row throughout.
 *
 * Run: `pnpm exec playwright test toolbar-fit`.
 */

import { expect, test, type Locator, type Page } from "playwright/test";
import { sizeBuilder, visitBuilder } from "./builder-page";
import { holdE3, installE3Faults, releaseE3 } from "./e3-faults";
import { settled } from "./settle";

/** An area's builder examples, by their showcase routes: the builder's own, and its optimiser's where it has one. */
const AREAS: readonly { readonly name: string; readonly routes: readonly string[] }[] = [
    { name: "Sheet", routes: ["e3/sheet/sheet-records/sheetRecordIndexes", "e3/sheet/optimise/sheetOptimise"] },
    { name: "Plan", routes: ["e3/plan/plan-records/planRecordIndexes", "e3/plan/optimise/planOptimise"] },
    { name: "Roster", routes: ["e3/roster/roster/rosterWarehouse", "e3/roster/optimise/rosterOptimise"] },
    { name: "Calendar", routes: ["e3/calendar/calendar/calendarOperations", "e3/calendar/optimise/calendarOptimise"] },
    { name: "Allocation", routes: ["e3/allocation/allocation/allocationKilnYard", "e3/allocation/optimise/allocationOptimise"] },
    { name: "Flowchart", routes: ["e3/flowchart/flowchart/flowchartFlows"] },
    { name: "Studio", routes: ["e3/studio/studio/studioBuilder"] },
    { name: "Query", routes: ["e3/query/query/queryBuilder"] },
    { name: "Schematic", routes: ["e3/schematic/schematic/schematicDataCentre"] },
    { name: "DecisionQueue", routes: ["e3/decision/decision/decisionQueueOps"] },
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
        const r = row.getBoundingClientRect();
        const style = getComputedStyle(row);
        const left = r.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
        const right = r.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
        const faults: string[] = [];
        for (const item of row.querySelectorAll<HTMLElement>(":scope > [data-toolbar-item]")) {
            const b = item.getBoundingClientRect();
            if (b.width === 0) continue;
            const key = item.getAttribute("data-toolbar-item");
            if (b.right > right + 0.5) faults.push(`${key} runs ${(b.right - right).toFixed(1)}px past the row's end`);
            if (b.left < left - 0.5) faults.push(`${key} starts ${(left - b.left).toFixed(1)}px before the row's start`);
        }
        const item = row.querySelector<HTMLElement>(":scope > [data-toolbar-item='history']");
        if (item === null) {
            if (wanted) faults.push("the history item left the row");
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

/** Whether an entry's builder shows a history item now. */
function hasHistory(entry: Locator): Promise<boolean> {
    return entry.locator(ROOT).first().evaluate((frame) => frame.querySelector("[data-frame-slot='toolbar'] [data-toolbar] > [data-toolbar-item='history']") !== null);
}

/** Lets the builder's box take the page's width again, after a spec sized it. */
async function unsizeBuilder(page: Page, entry: Locator): Promise<void> {
    await entry.locator(ROOT).first().locator("xpath=..").evaluate((box) => { (box as HTMLElement).style.width = ""; });
    await settled(page);
}

/**
 * The optimiser examples whose builder's View — the chip that bundles the period's controls on a phone — takes the
 * Elara eye as its entry where the row's floor needs the eye's room (ruled 27 Oct 2026, "Into the View menu").
 */
const VIEW_EYES: readonly { readonly name: string; readonly route: string }[] = [
    { name: "Roster", route: "e3/roster/optimise/rosterOptimise" },
    { name: "Allocation", route: "e3/allocation/optimise/allocationOptimise" },
];

/** The page's widths at which the eye is a button in the row: 390 and wider. */
const EYE_IN_ROW = [1440, 1024, 768, 390] as const;

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
    const line = frame.locator("[data-frame-slot='footer'] [data-footer-line]");
    await expect(line, `${at}: the footer's line says the run`).toHaveAttribute("data-loading-line", "busy");
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

for (const theme of ["light", "dark"] as const) {
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
        test(`${eye.name}: the Elara eye never leaves the toolbar — a button in the row at 1440 / 1024 / 768 / 390, the View's entry at 360 and in a ${PARENT}px parent, a run and its Stop from there, the history and Save in the row (${theme})`, async ({ page }) => {
            await installE3Faults(page);
            await page.setViewportSize({ width: WIDTHS[0], height: 900 });
            const entry = await visitBuilder(page, eye.route, ROOT, theme);
            const button = entry.locator(ROOT).first().locator("[data-frame-slot='toolbar'] [data-optimise-button]");
            // The period read: the eye takes a run.
            await expect(button).toBeEnabled({ timeout: 30_000 });
            const named = (await button.getAttribute("aria-label")) ?? "";
            expect(named).toMatch(/^Optimise /);
            for (const width of EYE_IN_ROW) {
                await page.setViewportSize({ width, height: 900 });
                await settled(page);
                expect(await eyeInRowFaults(entry), `${width}px`).toEqual([]);
                expect(await rowFaults(entry, true), `${width}px`).toEqual([]);
            }
            await page.setViewportSize({ width: 360, height: 900 });
            await settled(page);
            await checkViewEye(page, entry, named, "360px");
            await page.setViewportSize({ width: WIDTHS[0], height: 900 });
            await sizeBuilder(page, entry, ROOT, PARENT);
            await checkViewEye(page, entry, named, `a ${PARENT}px parent`);
            await unsizeBuilder(page, entry);
            expect(await eyeInRowFaults(entry), `${WIDTHS[0]}px again`).toEqual([]);
        });
    }
}
