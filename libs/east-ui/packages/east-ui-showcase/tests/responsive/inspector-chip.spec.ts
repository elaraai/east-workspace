/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * A draft's chip arriving moves nothing under it (#1584). A view's first edit
 * draws its Pending chip in the row its head keeps for it, so the choice just
 * pressed stays under the pointer, and a second press where another choice
 * stood lands on that choice — read on the bakery's flowchart
 * (`flowchartBakery`), step 20's portion: Sliced, then By weight where it
 * stood, pinned beside main; on the Record's joinery (`recordFinishes`), the
 * hall door's finish: Stain, then Bare where it stood, pinned beside main and
 * in a phone's own Details; and on the Schematic's data centre floor, whose
 * head is the schedule builders' own, a fibre run's cable — a head with no
 * status: Logical, then Fibre where it stood. Each press is the pointer's,
 * where the choice stood, never a locator's, which would find the choice
 * wherever it went. A view no edit reaches keeps no row for a chip that can't
 * come: the depot's states read only through their sources
 * (`flowchartDepotDimmed`), and the skills matrix read only
 * (`recordSkillsReadOnly`), pinned beside main and in a phone's own Details.
 *
 * Run: `make test-responsive` (libs/east-ui), or
 * `pnpm exec playwright test inspector-chip`.
 */

import { expect, type Locator, type Page } from "playwright/test";
import { test } from "./kept-page";
import { visitBuilder } from "./builder-page";
import { openFlowchart } from "./flowchart-page";
import { DATA_CENTRE, centred, openSchematic, printedRef, screenPoint, sizeTo } from "./schematic-page";
import { settled } from "./settle";

/** Each of a choice field's choices by its words, and where it stands: its middle, in client px, to the hundredth. */
async function choicesOf(page: Page, field: Locator): Promise<Record<string, { x: number; y: number }>> {
    await field.scrollIntoViewIfNeeded();
    await settled(page);
    return field.locator("[data-part=item]").evaluateAll((items) => Object.fromEntries(items.map((item) => {
        const r = item.getBoundingClientRect();
        return [item.textContent ?? "", { x: Math.round((r.left + r.width / 2) * 100) / 100, y: Math.round((r.top + r.height / 2) * 100) / 100 }];
    })));
}

/**
 * How far a view's head reaches past the last of its parts that holds anything, its padding and its rule aside: the
 * row it keeps for a chip while there is none, or nothing.
 */
function slackOf(head: Locator): Promise<number> {
    return head.evaluate((el) => {
        const s = getComputedStyle(el);
        const held = [...el.children].filter((part) => part.childElementCount > 0 || (part.textContent ?? "").trim() !== "");
        const last = Math.max(...held.map((part) => part.getBoundingClientRect().bottom));
        return Math.round((el.getBoundingClientRect().bottom - last - parseFloat(s.paddingBottom) - parseFloat(s.borderBottomWidth)) * 100) / 100;
    });
}

/** A press where the pointer is — a click, or a tap on a phone — and the page at rest after it. */
async function pressAt(page: Page, at: { x: number; y: number } | undefined, phone: boolean): Promise<void> {
    if (at === undefined) throw new Error("no choice stands there");
    if (phone) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await settled(page);
}

test.describe("A draft's chip arriving moves nothing under it (#1584)", () => {
    test("the bakery's flowchart: step 20's portion pressed Sliced draws its Pending chip with every choice where it stood, and By weight pressed where it stood is chosen", { tag: "@desktop" }, async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartBakery");
        await root.evaluate((el) => { (el as HTMLElement).style.width = "1200px"; });
        await settled(page);
        const pane = root.locator("[data-frame-slot='end']");
        await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
        await root.locator("[data-flowchart-node='20']").click();
        await settled(page);
        const portion = pane.locator("[data-flowchart-inspector='state'] [data-field='portion']");
        const chip = pane.locator("[data-inspector-chip][data-state='pending']");
        await expect(chip).toHaveCount(0);
        // The row it keeps for the chip, empty: the bakery's states take edits.
        expect(await slackOf(pane.locator("[data-flowchart-inspector='state'] > :first-child"))).toBeGreaterThan(0);
        const stood = await choicesOf(page, portion);
        expect(Object.keys(stood)).toEqual(["Whole loaf", "Sliced", "By weight"]);
        await pressAt(page, stood["Sliced"], false);
        await expect(chip).toHaveText("Pending");
        expect(await choicesOf(page, portion)).toEqual(stood);
        await pressAt(page, stood["By weight"], false);
        await expect(portion.locator("[data-part=item]", { hasText: "By weight" }).locator("input")).toBeChecked();
    });

    for (const phone of [false, true]) {
        test(`the Record's joinery${phone ? ", in a phone's own Details" : ""}: the hall door's finish pressed Stain draws its Pending chip with every choice where it stood, and Bare pressed where it stood is chosen`, { tag: phone ? "@mobile" : "@desktop" }, async ({ page }) => {
            if (!phone) await page.setViewportSize({ width: 1600, height: 1000 });
            const entry = await visitBuilder(page, "e3/record/record/recordFinishes", "[data-builder-frame]", "light");
            await expect(entry.locator("[data-record] [data-slot=row]").first()).toBeVisible({ timeout: 30_000 });
            await settled(page);
            const frame = entry.locator("[data-builder-frame]").first();
            const pane = frame.locator("[data-frame-slot=end]");
            const room = frame.locator("[data-record] [data-slot=row][data-row-id='J-101'] [data-slot=cell][data-key=room]");
            if (phone) {
                await room.tap();
                await settled(page);
                await frame.locator("[data-pane-tab='end']").tap();
            } else {
                await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
                await room.click();
            }
            await settled(page);
            const details = pane.locator("[data-record-details='row']");
            await expect(details).toHaveAttribute("data-record-entry", "J-101");
            expect(await details.evaluate((el) => el.hasAttribute("data-phone")), "a phone's own Details, or the pane's").toBe(phone);
            const finish = details.locator("[data-field='finish']");
            const chip = details.locator("[data-state='pending']");
            await expect(chip).toHaveCount(0);
            const stood = await choicesOf(page, finish);
            expect(Object.keys(stood).sort()).toEqual(["Bare", "Paint", "Stain"]);
            await pressAt(page, stood["Stain"], phone);
            await expect(chip).toBeVisible();
            expect(await choicesOf(page, finish)).toEqual(stood);
            await pressAt(page, stood["Bare"], phone);
            await expect(finish.locator("[data-part=item]", { hasText: "Bare" }).locator("input")).toBeChecked();
        });
    }

    test("the Schematic's data centre floor: a fibre run's cable pressed Logical draws its Pending chip with every choice where it stood, and Fibre pressed where it stood is chosen", { tag: "@desktop" }, async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 1000 });
        const root = await openSchematic(page, DATA_CENTRE);
        await sizeTo(page, root, 1440);
        await centred(page, root);
        const pane = root.locator("[data-builder-frame] [data-frame-slot=end]");
        await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
        // A03, the third rack of Cage A, by its centre in metres — the floor fitted in view, its frame's start in the
        // window — then the fibre run it is joined to.
        await root.locator("[data-frame-slot='toolbar']").getByRole("button", { name: "Fit" }).click();
        await settled(page);
        await root.evaluate((el) => { el.scrollIntoView({ block: "center", inline: "start" }); });
        await settled(page);
        await pressAt(page, await screenPoint(root, 9.6, 2.9), false);
        await pane.locator(`[data-inspector-join=${JSON.stringify(printedRef("fibre", "u3"))}]`).click();
        await settled(page);
        const link = pane.locator("[data-schematic-inspector='link']");
        const cable = link.locator("[data-field='cable']");
        const chip = link.locator("[data-inspector-marks] > [data-state='pending']");
        await expect(chip).toHaveCount(0);
        await expect(link.locator("[data-inspector-status]")).toHaveCount(0);
        const stood = await choicesOf(page, cable);
        expect(Object.keys(stood)).toEqual(["Fibre", "Logical"]);
        await pressAt(page, stood["Logical"], false);
        await expect(chip).toHaveText("Pending");
        expect(await choicesOf(page, cable)).toEqual(stood);
        await pressAt(page, stood["Fibre"], false);
        await expect(cable.locator("[data-part=item]", { hasText: "Fibre" }).locator("input")).toBeChecked();
    });
});

test.describe("A view no edit reaches keeps no row for a chip (#1584)", () => {
    test("the depot read only through its sources: Held's head ends under its name", { tag: "@desktop" }, async ({ page }) => {
        const { root } = await openFlowchart(page, "flowchartDepotDimmed");
        await root.evaluate((el) => { (el as HTMLElement).style.width = "1200px"; });
        await settled(page);
        const pane = root.locator("[data-frame-slot='end']");
        await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
        await root.locator("[data-flowchart-node='HLD']").click();
        await settled(page);
        expect(await slackOf(pane.locator("[data-flowchart-inspector='state'] > :first-child"))).toBe(0);
    });

    for (const phone of [false, true]) {
        test(`the skills matrix read only${phone ? ", in a phone's own Details" : ""}: a person's head ends under their name`, { tag: phone ? "@mobile" : "@desktop" }, async ({ page }) => {
            if (!phone) await page.setViewportSize({ width: 1600, height: 1000 });
            const entry = await visitBuilder(page, "e3/record/record/recordSkillsReadOnly", "[data-builder-frame]", "light");
            await expect(entry.locator("[data-record] [data-slot=row]").first()).toBeVisible({ timeout: 30_000 });
            await settled(page);
            const frame = entry.locator("[data-builder-frame]").first();
            const pane = frame.locator("[data-frame-slot=end]");
            const role = frame.locator("[data-record] [data-slot=row]").first().locator("[data-slot=cell][data-key=role]");
            if (phone) {
                await role.tap();
                await settled(page);
                await frame.locator("[data-pane-tab='end']").tap();
            } else {
                await expect(pane).toHaveAttribute("data-pane-mode", "pinned");
                await role.click();
            }
            await settled(page);
            const details = pane.locator("[data-record-details='row']");
            await expect(details).toBeVisible();
            expect(await slackOf(details.locator(":scope > :first-child"))).toBe(0);
        });
    }
});
